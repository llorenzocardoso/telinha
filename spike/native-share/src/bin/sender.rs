//! Phase 0 sender spike: WGC -> NV12 -> hardware H.264 -> webrtc-rs (GCC + pacer + NACK/PLI)
//! -> a Chromium viewer page. The viewer posts an offer to /offer and receives the answer.
//!
//! usage: sender [max_height=1080] [fps=60] [max_mbps=10] [start_mbps=4] [seconds=30] [port=8099]

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
    use native_share_spike::pipeline::{self, Control, Frame};
    use rtc::interceptor::{
        Attribute, BandwidthEstimator, EstimatorStats, Gcc, Interceptor, Packet, PacketReport,
        Registry, Slot, StreamInfo, TaggedPacket,
    };
    use rtc::media::Sample;
    use rtc::media_stream::MediaStreamTrack;
    use rtc::peer_connection::configuration::interceptor_registry::{
        configure_congestion_control, register_default_interceptors, CongestionFeedback,
    };
    use rtc::peer_connection::configuration::media_engine::{MediaEngine, MIME_TYPE_H264};
    use rtc::peer_connection::configuration::RTCConfigurationBuilder;
    use rtc::peer_connection::sdp::RTCSessionDescription;
    use rtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
    use rtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
    use rtc::rtp_transceiver::rtp_sender::{
        RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters,
        RtpCodecKind,
    };
    use rtc::rtp_transceiver::SSRC;
    use rtc::sansio::Protocol;
    use rtc::shared::error::Error;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample;
    use webrtc::media_stream::track_local::{TrackLocal, TrackLocalEvent};
    use webrtc::peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCIceGatheringState,
        RTCPeerConnectionState,
    };
    use webrtc::runtime::{channel, default_runtime, Receiver, Runtime, Sender};

    const VIEWER_HTML: &str = include_str!("../../viewer/viewer.html");
    const MIN_BITRATE: f64 = 500_000.0;
    static QUEUE_DROPS: AtomicU64 = AtomicU64::new(0);

    // ---- RTCP forwarder: hands PLI/FIR to the application (copied from the webrtc-rs example) ----

    #[derive(Default)]
    struct RtcpForwarder {
        read_queue: VecDeque<TaggedPacket>,
        write_queue: VecDeque<TaggedPacket>,
    }

    fn is_keyframe_request(packet: &Box<dyn rtc::rtcp::Packet>) -> bool {
        let p = packet.as_any();
        p.is::<PictureLossIndication>() || p.is::<FullIntraRequest>()
    }

    impl Protocol<TaggedPacket, TaggedPacket, ()> for RtcpForwarder {
        type Rout = TaggedPacket;
        type Wout = TaggedPacket;
        type Eout = ();
        type Error = Error;
        type Time = Instant;

        fn handle_read(&mut self, mut msg: TaggedPacket) -> Result<(), Self::Error> {
            if let Packet::Rtcp(packets) = &msg.message.packet {
                let requests: Vec<Box<dyn rtc::rtcp::Packet>> =
                    packets.iter().filter(|p| is_keyframe_request(p)).cloned().collect();
                if requests.is_empty() {
                    return Ok(());
                }
                msg.message.packet = Packet::Rtcp(requests);
                msg.message.add(Attribute::DeliverToApplication);
            }
            self.read_queue.push_back(msg);
            Ok(())
        }
        fn poll_read(&mut self) -> Option<Self::Rout> {
            self.read_queue.pop_front()
        }
        fn handle_write(&mut self, msg: TaggedPacket) -> Result<(), Self::Error> {
            self.write_queue.push_back(msg);
            Ok(())
        }
        fn poll_write(&mut self) -> Option<Self::Wout> {
            self.write_queue.pop_front()
        }
    }

    impl Interceptor for RtcpForwarder {
        fn bind_local_stream(&mut self, _info: &StreamInfo) {}
        fn unbind_local_stream(&mut self, _info: &StreamInfo) {}
        fn bind_remote_stream(&mut self, _info: &StreamInfo) {}
        fn unbind_remote_stream(&mut self, _info: &StreamInfo) {}
    }

    // ---- estimator wrapper that publishes the GCC target ----------------------------------------

    struct Reporting<E: BandwidthEstimator> {
        inner: E,
        target: Arc<AtomicU64>,
    }

    impl<E: BandwidthEstimator> Reporting<E> {
        fn publish(&self) {
            self.target.store(self.inner.target_bitrate().to_bits(), Ordering::Relaxed);
        }
    }

    impl<E: BandwidthEstimator> BandwidthEstimator for Reporting<E> {
        fn on_reports(&mut self, now: Instant, reports: &[PacketReport]) {
            self.inner.on_reports(now, reports);
            self.publish();
        }
        fn target_bitrate(&self) -> f64 {
            self.inner.target_bitrate()
        }
        fn handle_timeout(&mut self, now: Instant) {
            self.inner.handle_timeout(now);
            self.publish();
        }
        fn poll_timeout(&self) -> Option<Instant> {
            self.inner.poll_timeout()
        }
        fn stats(&self) -> EstimatorStats {
            self.inner.stats()
        }
    }

    // ---- peer connection events -----------------------------------------------------------------

    #[derive(Clone)]
    struct Handler {
        gather_tx: Sender<()>,
        connected_tx: Sender<()>,
    }

    #[async_trait::async_trait]
    impl PeerConnectionEventHandler for Handler {
        async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
            if state == RTCIceGatheringState::Complete {
                let _ = self.gather_tx.try_send(());
            }
        }
        async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
            println!("[pc] state {state}");
            if state == RTCPeerConnectionState::Connected {
                let _ = self.connected_tx.try_send(());
            }
        }
    }

    struct Config {
        max_bitrate: f64,
        start_bitrate: f64,
        fps: u32,
    }

    /// Frames from the encoder thread to whichever session is live (at most one).
    type FrameSlot = Arc<Mutex<Option<Sender<Frame>>>>;

    fn local_ip() -> String {
        std::net::UdpSocket::bind("0.0.0.0:0")
            .and_then(|s| s.connect("8.8.8.8:80").map(|_| s))
            .and_then(|s| s.local_addr())
            .map(|a| a.ip().to_string())
            .unwrap_or_else(|_| "127.0.0.1".into())
    }

    fn h264(profile: &str, pt: u8) -> RTCRtpCodecParameters {
        RTCRtpCodecParameters {
            rtp_codec: RTCRtpCodec {
                mime_type: MIME_TYPE_H264.to_owned(),
                clock_rate: 90000,
                channels: 0,
                sdp_fmtp_line: format!(
                    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id={profile}"
                ),
                rtcp_feedback: vec![],
            },
            payload_type: pt,
        }
    }

    async fn serve_offer(
        rt: Arc<dyn Runtime>,
        offer_json: String,
        cfg: &Config,
        control: Arc<Control>,
        slot: FrameSlot,
    ) -> Result<String> {
        let offer: RTCSessionDescription = serde_json::from_str(&offer_json)?;

        let mut me = MediaEngine::default();
        let codecs = [
            h264("42e01f", 102),
            h264("4d001f", 104),
            h264("640c1f", 106),
            h264("64001f", 108),
            h264("640032", 110),
        ];
        for c in &codecs {
            me.register_codec(c.clone(), RtpCodecKind::Video)?;
        }

        let target = Arc::new(AtomicU64::new(cfg.start_bitrate.to_bits()));
        let estimator = Reporting {
            inner: Gcc::new(cfg.start_bitrate, MIN_BITRATE, cfg.max_bitrate),
            target: target.clone(),
        };
        let registry =
            configure_congestion_control(Registry::new(), estimator, CongestionFeedback::Twcc, &mut me)?;
        let registry = register_default_interceptors(registry, &mut me)?;
        let registry = registry.with(Slot::from(14_000), RtcpForwarder::default());

        let (gather_tx, mut gather_rx) = channel::<()>(1);
        let (connected_tx, mut connected_rx) = channel::<()>(1);
        let pc = PeerConnectionBuilder::new()
            .with_configuration(RTCConfigurationBuilder::new().build())
            .with_media_engine(me)
            .with_interceptor_registry(registry)
            .with_handler(Arc::new(Handler { gather_tx, connected_tx }))
            .with_runtime(rt.clone())
            .with_udp_addrs(vec![format!("{}:0", local_ip())])
            .build()
            .await?;

        let ssrc: SSRC = rand::random::<u32>();
        let track = Arc::new(TrackLocalStaticSample::new(
            Instant::now(),
            MediaStreamTrack::new(
                "telinha-native".to_owned(),
                "telinha-native-video".to_owned(),
                "screen".to_owned(),
                RtpCodecKind::Video,
                vec![RTCRtpEncodingParameters {
                    rtp_coding_parameters: RTCRtpCodingParameters {
                        ssrc: Some(ssrc),
                        ..Default::default()
                    },
                    codec: codecs[0].rtp_codec.clone(),
                    ..Default::default()
                }],
            ),
        )?);
        let sender = pc.add_track(track.clone() as Arc<dyn TrackLocal>).await?;

        pc.set_remote_description(offer).await?;
        let answer = pc.create_answer(None).await?;
        pc.set_local_description(answer).await?;
        let _ = gather_rx.recv().await;
        let local = pc
            .local_description()
            .await
            .ok_or_else(|| anyhow!("no local description"))?;
        let answer_json = serde_json::to_string(&local)?;

        let negotiated = sender
            .get_parameters()
            .await?
            .rtp_parameters
            .codecs
            .first()
            .map(|c| (c.payload_type, c.rtp_codec.sdp_fmtp_line.clone()))
            .ok_or_else(|| anyhow!("no negotiated codec"))?;
        println!("[pc] negotiated pt {} fmtp {}", negotiated.0, negotiated.1);
        let payload_type = negotiated.0;

        // Everything after the answer runs in the background.
        let (frame_tx, mut frame_rx): (Sender<Frame>, Receiver<Frame>) = channel(32);
        let (fps, max_bitrate) = (cfg.fps, cfg.max_bitrate);
        rt.spawn(Box::pin({
            let (rt2, control, track) = (rt.clone(), control.clone(), track.clone());
            async move {
                let _keep_alive = pc; // dropping the connection would tear the session down
                let _ = connected_rx.recv().await;
                println!("[pc] connected, streaming");
                *slot.lock().unwrap() = Some(frame_tx);
                control.keyframe.store(true, Ordering::Relaxed);

                // PLI/FIR -> force an IDR.
                rt2.spawn(Box::pin({
                    let (control, track) = (control.clone(), track.clone());
                    async move {
                        while let Some(ev) = track.poll().await {
                            let TrackLocalEvent::OnRtcpPacket(p) = ev else { continue };
                            if p.iter().any(is_keyframe_request) {
                                control.keyframe.store(true, Ordering::Relaxed);
                            }
                        }
                    }
                }));

                // GCC target -> encoder bitrate, once per 100 ms; a status line every second.
                rt2.spawn(Box::pin({
                    let (rt3, control) = (rt2.clone(), control.clone());
                    async move {
                        let mut last = 0u32;
                        let mut ticks = 0u32;
                        loop {
                            rt3.sleep(Duration::from_millis(100)).await;
                            let gcc = f64::from_bits(target.load(Ordering::Relaxed));
                            let enc = (gcc * 0.95).clamp(MIN_BITRATE, max_bitrate) as u32;
                            if last == 0 || (enc as f64 - last as f64).abs() / last as f64 > 0.04 {
                                control.bitrate.store(enc, Ordering::Relaxed);
                                last = enc;
                            }
                            ticks += 1;
                            if ticks % 10 == 0 {
                                println!(
                                    "[rate] gcc {:6.2} Mbps -> encoder {:6.2} Mbps",
                                    gcc / 1e6,
                                    last as f64 / 1e6
                                );
                            }
                        }
                    }
                }));

                let (mut frames, mut bytes, mut since) = (0u64, 0u64, Instant::now());
                let dur = Duration::from_micros(1_000_000 / fps as u64);
                while let Some(frame) = frame_rx.recv().await {
                    let len = frame.data.len() as u64;
                    let sample = Sample {
                        data: bytes::Bytes::from(frame.data),
                        duration: dur,
                        ..Sample::new(Instant::now())
                    };
                    if let Err(e) = track.sample_writer(ssrc, payload_type).write_sample(&sample).await {
                        println!("[send] write failed: {e}");
                        break;
                    }
                    frames += 1;
                    bytes += len;
                    if since.elapsed() >= Duration::from_secs(1) {
                        let s = since.elapsed().as_secs_f64();
                        println!(
                            "[send] {:5.1} fps {:6.2} Mbps queue-drops {}",
                            frames as f64 / s,
                            bytes as f64 * 8.0 / s / 1e6,
                            QUEUE_DROPS.load(Ordering::Relaxed)
                        );
                        frames = 0;
                        bytes = 0;
                        since = Instant::now();
                    }
                }
                *slot.lock().unwrap() = None;
            }
        }));

        Ok(answer_json)
    }

    pub fn main() -> Result<()> {
        let args: Vec<String> = std::env::args().collect();
        let arg = |i: usize, d: f64| args.get(i).and_then(|v| v.parse().ok()).unwrap_or(d);
        let (max_h, fps) = (arg(1, 1080.0) as u32, arg(2, 60.0) as u32);
        let max_mbps = arg(3, 10.0);
        let start_mbps = arg(4, 4.0);
        let seconds = arg(5, 30.0) as u64;
        let port = arg(6, 8099.0) as u16;

        let control = Arc::new(Control::default());
        let slot: FrameSlot = Arc::new(Mutex::new(None));

        // Encoder thread: runs for the whole process, frames go to the live session if any.
        {
            let (control, slot) = (control.clone(), slot.clone());
            std::thread::spawn(move || {
                let opts = pipeline::Options {
                    max_h,
                    fps,
                    bitrate: (start_mbps * 1e6) as u32,
                    seconds: None,
                    out_path: None,
                    verbose: false,
                };
                let ctl = control.clone();
                let result = pipeline::run(opts, control, move |f| {
                    if let Some(tx) = slot.lock().unwrap().as_ref() {
                        if tx.try_send(f).is_err() {
                            // A dropped delta frame breaks the stream until the next IDR.
                            QUEUE_DROPS.fetch_add(1, Ordering::Relaxed);
                            ctl.keyframe.store(true, Ordering::Relaxed);
                        }
                    }
                });
                if let Err(e) = result {
                    eprintln!("pipeline stopped: {e:#}");
                    std::process::exit(2);
                }
            });
        }

        // HTTP front: GET / -> viewer page, POST /offer -> answer.
        let (offer_tx, mut offer_rx) = channel::<(String, std::sync::mpsc::Sender<String>)>(4);
        std::thread::spawn(move || {
            let server = tiny_http::Server::http(format!("127.0.0.1:{port}")).expect("http bind");
            println!("viewer: http://127.0.0.1:{port}/");
            for mut req in server.incoming_requests() {
                if req.method() == &tiny_http::Method::Post && req.url() == "/offer" {
                    let mut body = String::new();
                    let _ = req.as_reader().read_to_string(&mut body);
                    let (reply_tx, reply_rx) = std::sync::mpsc::channel();
                    let _ = offer_tx.try_send((body, reply_tx));
                    let answer = reply_rx.recv_timeout(Duration::from_secs(20)).unwrap_or_default();
                    let _ = req.respond(
                        tiny_http::Response::from_string(answer).with_header(
                            "Content-Type: application/json".parse::<tiny_http::Header>().unwrap(),
                        ),
                    );
                } else {
                    let _ = req.respond(
                        tiny_http::Response::from_string(VIEWER_HTML).with_header(
                            "Content-Type: text/html".parse::<tiny_http::Header>().unwrap(),
                        ),
                    );
                }
            }
        });

        let rt = default_runtime().ok_or_else(|| anyhow!("no runtime"))?;
        let cfg = Config { max_bitrate: max_mbps * 1e6, start_bitrate: start_mbps * 1e6, fps };
        let rt2 = rt.clone();
        let deadline = Instant::now() + Duration::from_secs(seconds);
        rt.block_on(Box::pin(async move {
            while Instant::now() < deadline {
                let next = rt2.sleep(Duration::from_millis(200));
                // Poll for an offer without blocking the deadline check.
                let got = futures::future::select(Box::pin(offer_rx.recv()), next).await;
                if let futures::future::Either::Left((Some((offer, reply)), _)) = got {
                    match serve_offer(rt2.clone(), offer, &cfg, control.clone(), slot.clone()).await {
                        Ok(answer) => {
                            let _ = reply.send(answer);
                        }
                        Err(e) => {
                            eprintln!("offer failed: {e:#}");
                            let _ = reply.send(String::new());
                        }
                    }
                }
            }
            control.stop.store(true, Ordering::Relaxed);
        }));
        Ok(())
    }
}
