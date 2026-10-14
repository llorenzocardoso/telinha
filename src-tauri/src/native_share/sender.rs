//! The network side of the native share: the hardware-encoded frames from `pipeline` go into
//! libwebrtc through pass-through video sources, one `PeerConnection` per viewer.
//!
//! libwebrtc (the same engine Chrome and Discord use) does the congestion control, pacing,
//! retransmission and keyframe requests. It tells us the bitrate each viewer's path can carry and
//! when a viewer needs a keyframe; this module forwards both to the Media Foundation encoder.
//! Signaling stays in JavaScript: offers and ICE candidates are returned or emitted as events,
//! answers come in as commands.
//!
//! One encoder serves every viewer, so each viewer gets its own pass-through source fed the same
//! frames: that keeps each viewer's rate requests apart and lets the slowest one set the pace.

use super::geometry::SourceId;
use super::pipeline::{self, Control, End};
use super::rates::{combine_targets, viewer_cap};
use super::sdp::enable_opus_stereo;
use super::{IceServerInput, NativeStartInfo, SenderStats};
use crate::audio;
use libwebrtc::audio_frame::AudioFrame;
use libwebrtc::audio_source::native::NativeAudioSource;
use libwebrtc::audio_source::AudioSourceOptions;
use libwebrtc::peer_connection_factory::native::PeerConnectionFactoryExt;
use libwebrtc::prelude::*;
use libwebrtc::stats::{IceCandidateType, RtcStats};
use libwebrtc::video_frame::{EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame};
use libwebrtc::video_source::native::NativeVideoSource;
use libwebrtc::MediaType;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Delivers an event to the app (a Tauri event in production, a channel in tests).
pub type Emit = Arc<dyn Fn(&'static str, serde_json::Value) + Send + Sync>;

fn send_event<T: Serialize>(emit: &Emit, name: &'static str, payload: T) {
    if let Ok(value) = serde_json::to_value(payload) {
        emit(name, value);
    }
}

/// Lowest rate the encoder is steered to, bits per second.
const MIN_BITRATE: u64 = 500_000;
/// Where the estimator starts; it climbs from here (and the first keyframe is sent at this rate).
const START_BITRATE: u64 = 4_000_000;
const START_TIMEOUT: Duration = Duration::from_secs(10);
/// Opus bitrate cap for the desktop audio, bits per second.
const AUDIO_MAX_BITRATE: u64 = 192_000;
/// Buffer of the audio source; a multiple of 10 ms, as libwebrtc requires.
const AUDIO_QUEUE_MS: u32 = 200;
/// How often each viewer's route (direct or relayed) and round trip are sampled.
const ROUTE_POLL: Duration = Duration::from_secs(2);

pub struct StartRequest {
    /// The id as listed (`screen:<n>` / `window:<n>`); the audio capture chooses its target by it.
    pub source_id: String,
    pub source: SourceId,
    pub include_audio: bool,
    /// Process of the shared window, when it is one (audio is then limited to that process tree).
    pub window_pid: Option<u32>,
    pub max_height: u32,
    pub fps: u32,
    pub max_bitrate: u64,
    /// Cap for viewers reached through a TURN relay (the room's `turnMaxBitrateKbps`), bits/s.
    pub relay_cap: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IcePayload {
    peer_id: String,
    candidate: String,
    sdp_mid: String,
    sdp_mline_index: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    peer_id: String,
    state: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewerPayload {
    peer_id: String,
    relay: bool,
    rtt_ms: Option<f64>,
    available_kbps: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioErrorPayload {
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EndedPayload {
    /// `source-closed` (window closed, display gone) or `error`.
    reason: &'static str,
    message: Option<String>,
}

/// One viewer's pass-through source and the rate its congestion controller last asked for.
struct Feed {
    source: NativeVideoSource,
    /// Bits per second; `0` until the viewer's controller has asked for anything.
    target: AtomicU64,
}

type Feeds = Arc<Mutex<HashMap<String, Arc<Feed>>>>;

struct Viewer {
    pc: PeerConnection,
    /// Tells a reconnected viewer's new connection apart from the one being monitored.
    generation: u64,
}

struct Session {
    control: Arc<Control>,
    /// Desktop audio, when the share carries it.
    audio: Option<NativeAudioSource>,
    audio_stop: Arc<AtomicBool>,
    max_bitrate: u64,
    relay_cap: Option<u64>,
    /// Size of every encoded frame.
    size: (u32, u32),
    feeds: Feeds,
    viewers: Mutex<HashMap<String, Viewer>>,
    frames: Arc<AtomicU64>,
    bytes: Arc<AtomicU64>,
    /// What the encoder is currently asked to produce (the slowest viewer's rate).
    target: Arc<AtomicU64>,
    threads: Mutex<Vec<JoinHandle<()>>>,
    last_stats: Mutex<(Instant, u64, u64)>,
}

static SESSION: Mutex<Option<Arc<Session>>> = Mutex::new(None);
static FACTORY: OnceLock<PeerConnectionFactory> = OnceLock::new();
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

fn factory() -> &'static PeerConnectionFactory {
    FACTORY.get_or_init(|| {
        let factory = PeerConnectionFactory::default();
        // Audio comes from the desktop loopback, never from a microphone.
        factory.set_adm_recording_enabled(false);
        factory
    })
}

fn current() -> Result<Arc<Session>, String> {
    SESSION
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Nenhum compartilhamento nativo em andamento".to_string())
}

pub async fn start(emit: Emit, request: StartRequest) -> Result<NativeStartInfo, String> {
    stop().await;

    let control = Arc::new(Control::default());
    let feeds: Feeds = Arc::default();
    let frames = Arc::new(AtomicU64::new(0));
    let bytes = Arc::new(AtomicU64::new(0));
    let started = Arc::new(AtomicBool::new(false));
    let frame_size = Arc::new(Mutex::new((0u32, 0u32)));
    let (started_tx, started_rx) = mpsc::channel::<Result<NativeStartInfo, String>>();

    let initial_bitrate = START_BITRATE.min(request.max_bitrate).max(MIN_BITRATE);
    let pipeline_thread = {
        let (control, feeds, frames, bytes, started, frame_size) = (
            control.clone(),
            feeds.clone(),
            frames.clone(),
            bytes.clone(),
            started.clone(),
            frame_size.clone(),
        );
        let emit = emit.clone();
        std::thread::Builder::new()
            .name("native-share-pipeline".into())
            .spawn(move || {
                let size_for_frames = frame_size.clone();
                let started_for_info = started_tx.clone();
                let result = pipeline::run(
                    pipeline::Options {
                        source: request.source,
                        max_height: request.max_height,
                        fps: request.fps,
                        bitrate: initial_bitrate as u32,
                    },
                    control,
                    |info| {
                        *frame_size.lock().unwrap() = (info.width, info.height);
                        started.store(true, Ordering::Relaxed);
                        let _ = started_for_info.send(Ok(NativeStartInfo {
                            width: info.width,
                            height: info.height,
                            encoder: info.encoder,
                        }));
                    },
                    |frame| {
                        // Every viewer has its own source; all of them get the same access unit.
                        let targets: Vec<Arc<Feed>> =
                            feeds.lock().unwrap().values().cloned().collect();
                        if targets.is_empty() {
                            return;
                        }
                        let (width, height) = *size_for_frames.lock().unwrap();
                        let encoded = EncodedVideoFrame {
                            codec: EncodedVideoCodec::H264,
                            payload: &frame.data,
                            timestamp_us: 0,
                            frame_type: if frame.key {
                                EncodedFrameType::Key
                            } else {
                                EncodedFrameType::Delta
                            },
                            resolution: VideoResolution { width, height },
                            frame_metadata: None,
                        };
                        let mut delivered = false;
                        for feed in &targets {
                            delivered |= feed.source.capture_encoded_frame(&encoded);
                        }
                        if delivered {
                            frames.fetch_add(1, Ordering::Relaxed);
                            bytes.fetch_add(frame.data.len() as u64, Ordering::Relaxed);
                        }
                    },
                );
                match result {
                    Err(message) if !started.load(Ordering::Relaxed) => {
                        let _ = started_tx.send(Err(message));
                    }
                    Err(message) => {
                        send_event(
                            &emit,
                            "native-share-ended",
                            EndedPayload {
                                reason: "error",
                                message: Some(message),
                            },
                        );
                    }
                    Ok(End::SourceClosed) => {
                        send_event(
                            &emit,
                            "native-share-ended",
                            EndedPayload {
                                reason: "source-closed",
                                message: None,
                            },
                        );
                    }
                    Ok(End::Stopped) => {}
                }
            })
            .map_err(|e| e.to_string())?
    };

    let wait = tauri::async_runtime::spawn_blocking(move || started_rx.recv_timeout(START_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?;
    let info = match wait {
        Ok(Ok(info)) => info,
        Ok(Err(message)) => {
            let _ = pipeline_thread.join();
            return Err(message);
        }
        Err(_) => {
            control.stop.store(true, Ordering::Relaxed);
            let _ = pipeline_thread.join();
            return Err("A captura não iniciou a tempo".into());
        }
    };

    let audio_stop = Arc::new(AtomicBool::new(false));
    let mut threads = vec![pipeline_thread];
    let audio = if request.include_audio {
        let source = NativeAudioSource::new(
            AudioSourceOptions::default(),
            audio::TAP_SAMPLE_RATE,
            audio::TAP_CHANNELS,
            AUDIO_QUEUE_MS,
        );
        let sink = source.clone();
        let error_emit = emit.clone();
        threads.push(audio::start_audio_tap(
            request.source_id.clone(),
            request.window_pid,
            audio_stop.clone(),
            move |bytes| {
                let frame = AudioFrame {
                    data: audio::f32_bytes_to_i16(&bytes).into(),
                    sample_rate: audio::TAP_SAMPLE_RATE,
                    num_channels: audio::TAP_CHANNELS,
                    samples_per_channel: audio::TAP_FRAMES,
                };
                // Paces itself on the source's queue; a closed track just drops the block.
                let _ = tauri::async_runtime::block_on(sink.capture_frame(&frame));
            },
            move |message| {
                send_event(
                    &error_emit,
                    "native-share-audio-error",
                    AudioErrorPayload { message },
                );
            },
        ));
        Some(source)
    } else {
        None
    };

    let target = Arc::new(AtomicU64::new(initial_bitrate));
    let session = Arc::new(Session {
        control: control.clone(),
        audio,
        audio_stop,
        max_bitrate: request.max_bitrate.max(MIN_BITRATE),
        relay_cap: request.relay_cap,
        size: (info.width, info.height),
        feeds,
        viewers: Mutex::new(HashMap::new()),
        frames,
        bytes,
        target: target.clone(),
        threads: Mutex::new(threads),
        last_stats: Mutex::new((Instant::now(), 0, 0)),
    });

    // libwebrtc -> encoder: keyframe requests, and the rate the slowest viewer's path can carry.
    let steering = {
        let session = session.clone();
        std::thread::Builder::new()
            .name("native-share-steering".into())
            .spawn(move || {
                while !session.control.stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(20));
                    let feeds: Vec<Arc<Feed>> =
                        session.feeds.lock().unwrap().values().cloned().collect();
                    for feed in &feeds {
                        if feed.source.take_keyframe_request() {
                            session.control.keyframe.store(true, Ordering::Relaxed);
                        }
                        if let Some(rate) = feed.source.take_rate_control_request() {
                            feed.target
                                .store(rate.target_bitrate_bps, Ordering::Relaxed);
                        }
                    }
                    let asked: Vec<u64> = feeds
                        .iter()
                        .map(|feed| feed.target.load(Ordering::Relaxed))
                        .collect();
                    if let Some(wanted) = combine_targets(&asked, MIN_BITRATE, session.max_bitrate)
                    {
                        if wanted != session.target.load(Ordering::Relaxed) {
                            session.target.store(wanted, Ordering::Relaxed);
                            session
                                .control
                                .bitrate
                                .store(wanted as u32, Ordering::Relaxed);
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?
    };
    session.threads.lock().unwrap().push(steering);

    *SESSION.lock().unwrap() = Some(session);
    Ok(info)
}

fn peer_configuration(servers: &[IceServerInput], relay_only: bool) -> RtcConfiguration {
    let mut config = RtcConfiguration::default();
    config.ice_servers = servers
        .iter()
        .map(|server| IceServer {
            urls: server.urls(),
            username: server.username.clone().unwrap_or_default(),
            password: server.credential.clone().unwrap_or_default(),
        })
        .collect();
    if relay_only {
        config.ice_transport_type = IceTransportsType::Relay;
    }
    config
}

/// Creates the connection for one viewer and returns the offer SDP. Candidates follow as
/// `native-share-ice` events; connection changes as `native-share-state`.
pub async fn offer(
    emit: Emit,
    peer_id: String,
    servers: Vec<IceServerInput>,
    relay_only: bool,
) -> Result<String, String> {
    let session = current()?;
    // A viewer asking again (reconnect) replaces its previous connection and source.
    if let Some(old) = session.viewers.lock().unwrap().remove(&peer_id) {
        old.pc.close();
    }
    session.feeds.lock().unwrap().remove(&peer_id);

    let pc = factory()
        .create_peer_connection(peer_configuration(&servers, relay_only))
        .map_err(|e| e.message)?;
    let start = START_BITRATE.min(session.max_bitrate).max(MIN_BITRATE);
    // A relay-only connection is relayed by definition: hold it to the relay cap from the start.
    let initial_cap = viewer_cap(
        session.max_bitrate,
        session.relay_cap,
        relay_only,
        MIN_BITRATE,
    );
    pc.set_bitrate(BitrateSettings {
        min_bitrate_bps: Some(MIN_BITRATE),
        start_bitrate_bps: Some(start.min(initial_cap)),
        max_bitrate_bps: Some(initial_cap),
    })
    .map_err(|e| e.message)?;

    {
        let (emit, peer_id) = (emit.clone(), peer_id.clone());
        pc.on_ice_candidate(Some(Box::new(move |candidate| {
            send_event(
                &emit,
                "native-share-ice",
                IcePayload {
                    peer_id: peer_id.clone(),
                    candidate: candidate.candidate(),
                    sdp_mid: candidate.sdp_mid(),
                    sdp_mline_index: candidate.sdp_mline_index(),
                },
            );
        })));
    }
    {
        let (emit, peer_id, control) = (emit.clone(), peer_id.clone(), session.control.clone());
        pc.on_connection_state_change(Some(Box::new(move |state| {
            if state == PeerConnectionState::Connected {
                // A new viewer needs a picture right away, not at the next scheduled keyframe.
                control.keyframe.store(true, Ordering::Relaxed);
            }
            send_event(
                &emit,
                "native-share-state",
                StatePayload {
                    peer_id: peer_id.clone(),
                    state: format!("{state:?}").to_lowercase(),
                },
            );
        })));
    }

    let feed = Arc::new(Feed {
        source: NativeVideoSource::new_encoded(VideoResolution {
            width: session.size.0,
            height: session.size.1,
        }),
        target: AtomicU64::new(0),
    });
    let track = factory().create_video_track("telinha-screen", feed.source.clone());
    let transceiver = pc
        .add_transceiver(
            MediaStreamTrack::Video(track),
            RtpTransceiverInit {
                direction: RtpTransceiverDirection::SendOnly,
                stream_ids: vec!["telinha-share".into()],
                send_encodings: vec![],
            },
        )
        .map_err(|e| e.message)?;
    let sender = transceiver.sender();
    sender.set_video_encoder_backend(VideoEncoderBackend::PreEncoded);

    // The encoder produces H.264; offer nothing else.
    let h264: Vec<_> = factory()
        .get_rtp_sender_capabilities(MediaType::Video)
        .codecs
        .into_iter()
        .filter(|codec| codec.mime_type.eq_ignore_ascii_case("video/H264"))
        .collect();
    if h264.is_empty() {
        pc.close();
        return Err("O libwebrtc não oferece H.264 neste computador".into());
    }
    transceiver
        .set_codec_preferences(h264)
        .map_err(|e| e.message)?;

    let mut parameters = sender.parameters();
    if let Some(encoding) = parameters.encodings.first_mut() {
        encoding.max_bitrate = Some(initial_cap);
    }
    let _ = sender.set_parameters(parameters);

    if let Some(audio) = &session.audio {
        let track = factory().create_audio_track("telinha-audio", audio.clone());
        let audio_transceiver = pc
            .add_transceiver(
                MediaStreamTrack::Audio(track),
                RtpTransceiverInit {
                    direction: RtpTransceiverDirection::SendOnly,
                    // Same stream as the video, so the viewer plays one MediaStream.
                    stream_ids: vec!["telinha-share".into()],
                    send_encodings: vec![],
                },
            )
            .map_err(|e| e.message)?;
        let audio_sender = audio_transceiver.sender();
        let mut parameters = audio_sender.parameters();
        if let Some(encoding) = parameters.encodings.first_mut() {
            encoding.max_bitrate = Some(AUDIO_MAX_BITRATE);
        }
        let _ = audio_sender.set_parameters(parameters);
    }

    let mut description = pc
        .create_offer(OfferOptions::default())
        .await
        .map_err(|e| e.message)?;
    if session.audio.is_some() {
        let stereo = enable_opus_stereo(&description.to_string());
        description =
            SessionDescription::parse(&stereo, SdpType::Offer).map_err(|e| e.to_string())?;
    }
    pc.set_local_description(description.clone())
        .await
        .map_err(|e| e.message)?;

    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    session.feeds.lock().unwrap().insert(peer_id.clone(), feed);
    session.viewers.lock().unwrap().insert(
        peer_id.clone(),
        Viewer {
            pc: pc.clone(),
            generation,
        },
    );
    watch_route(session, emit, peer_id, pc, generation, relay_only);
    Ok(description.to_string())
}

/// What the viewer's selected network path looks like.
#[derive(Debug, PartialEq)]
struct Route {
    relay: bool,
    rtt_ms: Option<f64>,
    available_kbps: Option<f64>,
}

/// The route the connection settled on, from its stats: the nominated candidate pair (or, failing
/// that, the pair that has carried the most data) and whether either end of it is a relay.
fn selected_route(stats: &[RtcStats]) -> Option<Route> {
    let pairs = stats.iter().filter_map(|stat| match stat {
        RtcStats::CandidatePair(pair) => Some(&pair.candidate_pair),
        _ => None,
    });
    let nominated = pairs
        .clone()
        .filter(|pair| pair.nominated)
        .max_by_key(|pair| pair.bytes_sent);
    let pair = nominated.or_else(|| {
        pairs
            .filter(|pair| pair.bytes_sent > 0)
            .max_by_key(|pair| pair.bytes_sent)
    })?;

    let candidate_type = |id: &str| {
        stats.iter().find_map(|stat| match stat {
            RtcStats::LocalCandidate(c) if c.rtc.id == id => c.local_candidate.candidate_type,
            RtcStats::RemoteCandidate(c) if c.rtc.id == id => c.remote_candidate.candidate_type,
            _ => None,
        })
    };
    let relay = candidate_type(&pair.local_candidate_id) == Some(IceCandidateType::Relay)
        || candidate_type(&pair.remote_candidate_id) == Some(IceCandidateType::Relay);
    let positive = |value: f64| (value > 0.0).then_some(value);
    Some(Route {
        relay,
        rtt_ms: positive(pair.current_round_trip_time).map(|seconds| seconds * 1000.0),
        available_kbps: positive(pair.available_outgoing_bitrate).map(|bits| bits / 1000.0),
    })
}

/// Samples one viewer's route until it is replaced or the share ends. When the route turns out to
/// be relayed, the viewer is held to the room's relay cap; if it later goes direct, the cap lifts.
fn watch_route(
    session: Arc<Session>,
    emit: Emit,
    peer_id: String,
    pc: PeerConnection,
    generation: u64,
    relay_only: bool,
) {
    let _ = std::thread::Builder::new()
        .name("native-share-route".into())
        .spawn(move || {
            let mut applied_relay = relay_only;
            'watch: loop {
                // Sleep in short slices so the thread ends soon after the viewer or share does.
                let wake = Instant::now() + ROUTE_POLL;
                while Instant::now() < wake {
                    std::thread::sleep(Duration::from_millis(100));
                    let alive = !session.control.stop.load(Ordering::Relaxed)
                        && session
                            .viewers
                            .lock()
                            .unwrap()
                            .get(&peer_id)
                            .is_some_and(|viewer| viewer.generation == generation);
                    if !alive {
                        break 'watch;
                    }
                }
                let Ok(stats) = tauri::async_runtime::block_on(pc.get_stats()) else {
                    continue;
                };
                let Some(route) = selected_route(&stats) else {
                    continue;
                };
                // A connection forced through the relay keeps the cap even if stats lag behind.
                let relay = route.relay || relay_only;
                if relay != applied_relay {
                    applied_relay = relay;
                    let cap =
                        viewer_cap(session.max_bitrate, session.relay_cap, relay, MIN_BITRATE);
                    let _ = pc.set_bitrate(BitrateSettings {
                        min_bitrate_bps: Some(MIN_BITRATE),
                        start_bitrate_bps: None,
                        max_bitrate_bps: Some(cap),
                    });
                }
                send_event(
                    &emit,
                    "native-share-viewer",
                    ViewerPayload {
                        peer_id: peer_id.clone(),
                        relay,
                        rtt_ms: route.rtt_ms,
                        available_kbps: route.available_kbps,
                    },
                );
            }
        });
}

fn viewer(peer_id: &str) -> Result<PeerConnection, String> {
    current()?
        .viewers
        .lock()
        .unwrap()
        .get(peer_id)
        .map(|viewer| viewer.pc.clone())
        .ok_or_else(|| "Espectador desconhecido".to_string())
}

pub async fn answer(peer_id: &str, sdp: &str) -> Result<(), String> {
    let pc = viewer(peer_id)?;
    let description = SessionDescription::parse(sdp, SdpType::Answer).map_err(|e| e.to_string())?;
    pc.set_remote_description(description)
        .await
        .map_err(|e| e.message)
}

pub async fn add_ice(
    peer_id: &str,
    candidate: &str,
    sdp_mid: &str,
    sdp_mline_index: i32,
) -> Result<(), String> {
    let pc = viewer(peer_id)?;
    let candidate =
        IceCandidate::parse(sdp_mid, sdp_mline_index, candidate).map_err(|e| e.to_string())?;
    pc.add_ice_candidate(candidate).await.map_err(|e| e.message)
}

pub fn stop_viewer(peer_id: &str) {
    if let Ok(session) = current() {
        session.feeds.lock().unwrap().remove(peer_id);
        if let Some(old) = session.viewers.lock().unwrap().remove(peer_id) {
            old.pc.close();
        }
    }
}

pub fn stats() -> Result<SenderStats, String> {
    let session = current()?;
    let frames = session.frames.load(Ordering::Relaxed);
    let bytes = session.bytes.load(Ordering::Relaxed);
    let mut last = session.last_stats.lock().unwrap();
    let seconds = last.0.elapsed().as_secs_f64().max(0.001);
    let result = SenderStats {
        viewers: session.viewers.lock().unwrap().len(),
        target_kbps: session.target.load(Ordering::Relaxed) / 1000,
        frames_per_second: (frames - last.1) as f64 / seconds,
        sent_kbps: (bytes - last.2) as f64 * 8.0 / 1000.0 / seconds,
    };
    *last = (Instant::now(), frames, bytes);
    Ok(result)
}

/// Stops capture, closes every viewer connection and waits for the worker threads.
pub async fn stop() {
    let session = SESSION.lock().unwrap().take();
    let Some(session) = session else {
        return;
    };
    session.control.stop.store(true, Ordering::Relaxed);
    session.audio_stop.store(true, Ordering::Relaxed);
    session.feeds.lock().unwrap().clear();
    for (_, viewer) in session.viewers.lock().unwrap().drain() {
        viewer.pc.close();
    }
    let threads: Vec<_> = session.threads.lock().unwrap().drain(..).collect();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        for thread in threads {
            let _ = thread.join();
        }
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use libwebrtc::stats::{
        dictionaries, CandidatePairStats, LocalCandidateStats, RemoteCandidateStats,
    };

    fn local(id: &str, kind: IceCandidateType) -> RtcStats {
        RtcStats::LocalCandidate(LocalCandidateStats {
            rtc: dictionaries::RtcStats {
                id: id.into(),
                timestamp: 0,
            },
            local_candidate: dictionaries::IceCandidateStats {
                candidate_type: Some(kind),
                ..Default::default()
            },
        })
    }

    fn remote(id: &str, kind: IceCandidateType) -> RtcStats {
        RtcStats::RemoteCandidate(RemoteCandidateStats {
            rtc: dictionaries::RtcStats {
                id: id.into(),
                timestamp: 0,
            },
            remote_candidate: dictionaries::IceCandidateStats {
                candidate_type: Some(kind),
                ..Default::default()
            },
        })
    }

    fn pair(local_id: &str, remote_id: &str, nominated: bool, bytes_sent: u64) -> RtcStats {
        RtcStats::CandidatePair(CandidatePairStats {
            rtc: dictionaries::RtcStats {
                id: format!("{local_id}-{remote_id}"),
                timestamp: 0,
            },
            candidate_pair: dictionaries::CandidatePairStats {
                local_candidate_id: local_id.into(),
                remote_candidate_id: remote_id.into(),
                nominated,
                bytes_sent,
                current_round_trip_time: 0.025,
                available_outgoing_bitrate: 8_000_000.0,
                ..Default::default()
            },
        })
    }

    #[test]
    fn a_direct_route_is_not_relayed() {
        let stats = vec![
            local("l1", IceCandidateType::Host),
            remote("r1", IceCandidateType::Srflx),
            pair("l1", "r1", true, 5_000),
        ];
        assert_eq!(
            selected_route(&stats),
            Some(Route {
                relay: false,
                rtt_ms: Some(25.0),
                available_kbps: Some(8_000.0),
            })
        );
    }

    #[test]
    fn a_relay_on_either_end_counts_as_relayed() {
        let local_relay = vec![
            local("l1", IceCandidateType::Relay),
            remote("r1", IceCandidateType::Host),
            pair("l1", "r1", true, 10),
        ];
        assert!(selected_route(&local_relay).unwrap().relay);
        let remote_relay = vec![
            local("l1", IceCandidateType::Host),
            remote("r1", IceCandidateType::Relay),
            pair("l1", "r1", true, 10),
        ];
        assert!(selected_route(&remote_relay).unwrap().relay);
    }

    #[test]
    fn only_the_nominated_pair_decides_the_route() {
        // A relayed pair that carried more data but was not chosen must not count.
        let stats = vec![
            local("direct", IceCandidateType::Host),
            local("relayed", IceCandidateType::Relay),
            remote("r1", IceCandidateType::Host),
            pair("relayed", "r1", false, 900_000),
            pair("direct", "r1", true, 1_000),
        ];
        assert!(!selected_route(&stats).unwrap().relay);
    }

    #[test]
    fn without_a_nominated_pair_the_busiest_one_stands_in() {
        let stats = vec![
            local("l1", IceCandidateType::Relay),
            local("l2", IceCandidateType::Host),
            remote("r1", IceCandidateType::Host),
            pair("l1", "r1", false, 50_000),
            pair("l2", "r1", false, 10),
        ];
        assert!(selected_route(&stats).unwrap().relay);
    }

    #[test]
    fn no_traffic_means_no_route_yet() {
        let stats = vec![
            local("l1", IceCandidateType::Host),
            remote("r1", IceCandidateType::Host),
            pair("l1", "r1", false, 0),
        ];
        assert_eq!(selected_route(&stats), None);
        assert_eq!(selected_route(&[]), None);
    }
}
