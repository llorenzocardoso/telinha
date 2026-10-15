//! Phase 0 sender spike #2: the same WGC -> NV12 -> hardware H.264 pipeline, but the network side
//! is Google's libwebrtc (GoogCC, pacer, NACK, PLI, FEC) through the LiveKit `libwebrtc` crate.
//! Encoded access units are pushed through the pass-through source; libwebrtc tells us the target
//! bitrate and asks for keyframes, and we steer the Media Foundation encoder with those.
//!
//! usage: sender_lk [max_height=1080] [fps=60] [max_mbps=10] [start_mbps=4] [seconds=30] [port=8099]

#[cfg(not(windows))]
fn main() {
    eprintln!("Windows only");
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    imp::main()
}

#[cfg(windows)]
mod imp {
    use anyhow::{anyhow, Result};
    use libwebrtc::peer_connection_factory::native::PeerConnectionFactoryExt;
    use libwebrtc::prelude::*;
    use libwebrtc::video_frame::{EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame};
    use libwebrtc::video_source::native::NativeVideoSource;
    use native_share_spike::pipeline::{self, Control};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    const VIEWER_HTML: &str = include_str!("../../viewer/viewer.html");
    static SENT: AtomicU64 = AtomicU64::new(0);

    pub fn main() -> Result<()> {
        let args: Vec<String> = std::env::args().collect();
        let arg = |i: usize, d: f64| args.get(i).and_then(|v| v.parse().ok()).unwrap_or(d);
        let (max_h, fps) = (arg(1, 1080.0) as u32, arg(2, 60.0) as u32);
        let (max_mbps, start_mbps) = (arg(3, 10.0), arg(4, 4.0));
        let seconds = arg(5, 30.0) as u64;
        let port = arg(6, 8099.0) as u16;
        let width = (max_h * 16 / 9) & !1;
        let resolution = VideoResolution { width, height: max_h };

        let control = Arc::new(Control::default());
        let source = NativeVideoSource::new_encoded(resolution.clone());

        // Encoder thread: every encoded access unit goes straight into libwebrtc.
        {
            let (control, source, resolution) = (control.clone(), source.clone(), resolution.clone());
            std::thread::spawn(move || {
                let opts = pipeline::Options {
                    max_h,
                    fps,
                    bitrate: (start_mbps * 1e6) as u32,
                    seconds: None,
                    out_path: None,
                    verbose: false,
                };
                let result = pipeline::run(opts, control, move |f| {
                    let frame = EncodedVideoFrame {
                        codec: EncodedVideoCodec::H264,
                        payload: &f.data,
                        timestamp_us: 0,
                        frame_type: if f.key { EncodedFrameType::Key } else { EncodedFrameType::Delta },
                        resolution: resolution.clone(),
                        frame_metadata: None,
                    };
                    if source.capture_encoded_frame(&frame) {
                        SENT.fetch_add(1, Ordering::Relaxed);
                    }
                });
                if let Err(e) = result {
                    eprintln!("pipeline stopped: {e:#}");
                    std::process::exit(2);
                }
            });
        }

        // libwebrtc -> encoder: keyframe requests and the rate-control target.
        {
            let (control, source) = (control.clone(), source.clone());
            std::thread::spawn(move || {
                let mut last_print = Instant::now();
                let (mut target, mut applied) = (0u64, 0u64);
                let mut last_sent = 0u64;
                loop {
                    std::thread::sleep(Duration::from_millis(20));
                    if source.take_keyframe_request() {
                        control.keyframe.store(true, Ordering::Relaxed);
                    }
                    if let Some(rc) = source.take_rate_control_request() {
                        target = rc.target_bitrate_bps;
                        let enc = target.clamp(500_000, (max_mbps * 1e6) as u64);
                        if applied == 0 || (enc as f64 - applied as f64).abs() / applied as f64 > 0.04 {
                            control.bitrate.store(enc as u32, Ordering::Relaxed);
                            applied = enc;
                        }
                    }
                    if last_print.elapsed() >= Duration::from_secs(1) {
                        let sent = SENT.load(Ordering::Relaxed);
                        println!(
                            "[rate] libwebrtc target {:6.2} Mbps -> encoder {:6.2} Mbps, {} frames/s into libwebrtc",
                            target as f64 / 1e6,
                            applied as f64 / 1e6,
                            sent - last_sent
                        );
                        last_sent = sent;
                        last_print = Instant::now();
                    }
                }
            });
        }

        // HTTP front: GET / -> viewer page, POST /offer -> answer.
        let (offer_tx, mut offer_rx) =
            tokio::sync::mpsc::channel::<(String, std::sync::mpsc::Sender<String>)>(4);
        std::thread::spawn(move || {
            let server = tiny_http::Server::http(format!("127.0.0.1:{port}")).expect("http bind");
            println!("viewer: http://127.0.0.1:{port}/");
            for mut req in server.incoming_requests() {
                if req.method() == &tiny_http::Method::Post && req.url() == "/offer" {
                    let mut body = String::new();
                    let _ = req.as_reader().read_to_string(&mut body);
                    let (reply_tx, reply_rx) = std::sync::mpsc::channel();
                    let _ = offer_tx.blocking_send((body, reply_tx));
                    let answer = reply_rx.recv_timeout(Duration::from_secs(20)).unwrap_or_default();
                    let _ = req.respond(
                        tiny_http::Response::from_string(answer)
                            .with_header("Content-Type: application/json".parse::<tiny_http::Header>().unwrap()),
                    );
                } else {
                    let _ = req.respond(
                        tiny_http::Response::from_string(VIEWER_HTML)
                            .with_header("Content-Type: text/html".parse::<tiny_http::Header>().unwrap()),
                    );
                }
            }
        });

        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
        let factory = PeerConnectionFactory::default();
        let deadline = Instant::now() + Duration::from_secs(seconds);
        let control_for_loop = control.clone();
        rt.block_on(async move {
            let mut live: Vec<PeerConnection> = Vec::new();
            while Instant::now() < deadline {
                let got = tokio::time::timeout(Duration::from_millis(200), offer_rx.recv()).await;
                let Ok(Some((offer_json, reply))) = got else { continue };
                match serve_offer(&factory, &source, &control_for_loop, offer_json, max_mbps, start_mbps).await {
                    Ok((pc, answer)) => {
                        live.push(pc);
                        let _ = reply.send(answer);
                    }
                    Err(e) => {
                        eprintln!("offer failed: {e:#}");
                        let _ = reply.send(String::new());
                    }
                }
            }
            for pc in live {
                pc.close();
            }
        });
        control.stop.store(true, Ordering::Relaxed);
        Ok(())
    }

    async fn serve_offer(
        factory: &PeerConnectionFactory,
        source: &NativeVideoSource,
        control: &Arc<Control>,
        offer_json: String,
        max_mbps: f64,
        start_mbps: f64,
    ) -> Result<(PeerConnection, String)> {
        #[derive(serde::Deserialize)]
        struct Desc {
            sdp: String,
        }
        let offer: Desc = serde_json::from_str(&offer_json)?;

        let mut cfg = RtcConfiguration::default();
        cfg.continual_gathering_policy = ContinualGatheringPolicy::GatherOnce;
        let pc = factory.create_peer_connection(cfg)?;
        pc.set_bitrate(BitrateSettings {
            min_bitrate_bps: Some(500_000),
            start_bitrate_bps: Some((start_mbps * 1e6) as u64),
            max_bitrate_bps: Some((max_mbps * 1e6) as u64),
        })?;

        let (gather_tx, mut gather_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        pc.on_ice_gathering_state_change(Some(Box::new(move |s| {
            if s == IceGatheringState::Complete {
                let _ = gather_tx.send(());
            }
        })));
        let ctl = control.clone();
        pc.on_connection_state_change(Some(Box::new(move |s| {
            println!("[pc] state {s:?}");
            if s == PeerConnectionState::Connected {
                ctl.keyframe.store(true, Ordering::Relaxed);
            }
        })));

        let track = factory.create_video_track("telinha-screen", source.clone());
        let sender = pc.add_track(MediaStreamTrack::Video(track), &["telinha-native"])?;
        sender.set_video_encoder_backend(VideoEncoderBackend::PreEncoded);
        let mut params = sender.parameters();
        if let Some(enc) = params.encodings.first_mut() {
            enc.max_bitrate = Some((max_mbps * 1e6) as u64);
        }
        let _ = sender.set_parameters(params);

        pc.set_remote_description(SessionDescription::parse(&offer.sdp, SdpType::Offer)?).await?;
        let answer = pc.create_answer(AnswerOptions::default()).await?;
        pc.set_local_description(answer).await?;
        tokio::time::timeout(Duration::from_secs(10), gather_rx.recv())
            .await
            .map_err(|_| anyhow!("ice gathering timed out"))?;
        let local = pc
            .current_local_description()
            .ok_or_else(|| anyhow!("no local description"))?;
        let sdp = local.to_string();
        println!(
            "[pc] answer video codecs: {}",
            sdp.lines().filter(|l| l.starts_with("a=rtpmap") && l.contains("H264")).count()
        );
        Ok((pc, serde_json::json!({ "type": "answer", "sdp": sdp }).to_string()))
    }
}
