//! Phase 0 bench: can WGC capture + GPU NV12 conversion + Media Foundation hardware H.264
//! sustain 1080p60 / 1440p60? Prints fps, bitrate and capture->encoded latency per second.
//!
//! usage: native-share-spike [max_height=1080] [fps=60] [mbps=10] [seconds=15] [out.h264]
//! Something must be moving on the primary monitor, since WGC only delivers changed frames.

#[cfg(not(windows))]
fn main() {
    eprintln!("Windows only");
}

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use native_share_spike::pipeline::{run, Control, Options};
    use std::sync::Arc;

    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize, default: u32| args.get(i).and_then(|v| v.parse().ok()).unwrap_or(default);
    let opts = Options {
        max_h: arg(1, 1080),
        fps: arg(2, 60),
        bitrate: arg(3, 10) * 1_000_000,
        seconds: Some(arg(4, 15) as u64),
        out_path: args.get(5).cloned(),
        verbose: true,
    };
    run(opts, Arc::new(Control::default()), |_| {})
}
