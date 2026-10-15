//! Native screen share (experimental): Windows Graphics Capture + hardware H.264 encode in Rust,
//! so the app can offer its own source picker instead of the WebView2 one.
//!
//! Phase 1 covers capture, the encoder and the source list. Nothing here sends media yet; the
//! frontend keeps using `getDisplayMedia` unless the experimental flag is on (see
//! `src/media/nativeShare.ts`).

mod geometry;
#[cfg(windows)]
mod icons;
#[cfg(windows)]
mod pipeline;
#[cfg(windows)]
mod preview;
mod rates;
mod sdp;
#[cfg(windows)]
mod sender;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use xcap::{Monitor, Window};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSource {
    /// `screen:<HMONITOR>` or `window:<HWND>`, the same ids as `capture::list_share_sources`.
    pub id: String,
    pub kind: &'static str,
    pub name: String,
    pub app: Option<String>,
    pub pid: Option<u32>,
    pub width: u32,
    pub height: u32,
    /// Minimized (a game after alt-tab): there is no picture to show until it is opened again.
    pub minimized: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapability {
    pub available: bool,
    pub vendor: String,
    pub encoder: String,
    pub reason: Option<String>,
}

/// An ICE server as the browser's `RTCIceServer` describes it (`urls` is a string or a list).
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IceServerInput {
    urls: UrlList,
    pub username: Option<String>,
    pub credential: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(untagged)]
enum UrlList {
    One(String),
    Many(Vec<String>),
}

impl IceServerInput {
    pub fn urls(&self) -> Vec<String> {
        match &self.urls {
            UrlList::One(url) => vec![url.clone()],
            UrlList::Many(urls) => urls.clone(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStartInfo {
    /// Fixed size of every encoded frame.
    pub width: u32,
    pub height: u32,
    pub encoder: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderStats {
    pub viewers: usize,
    /// What libwebrtc currently asks the encoder to produce, kbit/s.
    pub target_kbps: u64,
    pub frames_per_second: f64,
    pub sent_kbps: f64,
}

#[cfg(windows)]
fn app_emitter(app: AppHandle) -> sender::Emit {
    std::sync::Arc::new(move |name, payload| {
        let _ = app.emit(name, payload);
    })
}

#[cfg(not(windows))]
const UNSUPPORTED: &str = "Disponível apenas no Windows";

fn list_sources() -> Result<Vec<NativeSource>, String> {
    let mut sources = Vec::new();

    let mut monitors = Monitor::all().map_err(|e| e.to_string())?;
    monitors.sort_by_key(|monitor| !monitor.is_primary().unwrap_or(false));
    for (index, monitor) in monitors.iter().enumerate() {
        let name = monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| format!("Tela {}", index + 1));
        sources.push(NativeSource {
            id: format!("screen:{}", monitor.id().unwrap_or_default()),
            kind: "screen",
            name,
            app: None,
            pid: None,
            width: monitor.width().unwrap_or(0),
            height: monitor.height().unwrap_or(0),
            minimized: false,
        });
    }

    for window in Window::all().map_err(|e| e.to_string())? {
        let handle = window.id().unwrap_or(0);
        if skip_window(&window) || is_overlay(handle) {
            continue;
        }
        // A minimized window (a game after alt-tab) is listed with the size it will have restored.
        let minimized = window.is_minimized().unwrap_or(false);
        let (width, height) = if minimized {
            match restored_size(handle) {
                Some(size) => size,
                None => continue,
            }
        } else {
            (window.width().unwrap_or(0), window.height().unwrap_or(0))
        };
        sources.push(NativeSource {
            id: format!("window:{handle}"),
            kind: "window",
            name: window.title().unwrap_or_default(),
            app: window.app_name().ok().filter(|name| !name.is_empty()),
            pid: window.pid().ok(),
            width,
            height,
            minimized,
        });
    }
    Ok(sources)
}

/// Unlike the legacy list, this keeps minimized windows (alt-tabbed games).
fn skip_window(window: &Window) -> bool {
    !geometry::offer_window(
        &window.title().unwrap_or_default(),
        &window.app_name().unwrap_or_default(),
        window.is_minimized().unwrap_or(false),
        window.width().unwrap_or(0),
        window.height().unwrap_or(0),
    )
}

#[cfg(windows)]
fn restored_size(handle: u32) -> Option<(u32, u32)> {
    pipeline::restored_size_if_minimized(geometry::SourceId::Window(handle))
}

#[cfg(not(windows))]
fn restored_size(_handle: u32) -> Option<(u32, u32)> {
    None
}

/// Whether the window is a click-through or never-activated overlay.
#[cfg(windows)]
fn is_overlay(handle: u32) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, GWL_EXSTYLE};
    let window = HWND(geometry::SourceId::Window(handle).handle() as *mut _);
    let style = unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) };
    geometry::excluded_by_style(style as u32)
}

#[cfg(not(windows))]
fn is_overlay(_handle: u32) -> bool {
    false
}

#[tauri::command]
pub async fn native_share_sources() -> Result<Vec<NativeSource>, String> {
    tauri::async_runtime::spawn_blocking(list_sources)
        .await
        .map_err(|e| e.to_string())?
}

/// A small JPEG preview of one source, as a data URL. Separate from the list so the picker can
/// open at once and fill the previews in as they arrive.
#[tauri::command]
pub async fn native_share_thumbnail(id: String, width: Option<u32>) -> Result<String, String> {
    // The picker asks for the default; the live preview of one's own share asks for a larger one.
    let width = width.unwrap_or(480).clamp(160, 1280);
    tauri::async_runtime::spawn_blocking(move || {
        let image = crate::capture::capture_source_image(&id)?;
        Ok(crate::capture::jpeg_data_url(
            &crate::capture::fit_width(image, width),
            if width > 480 { 80 } else { 70 },
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The icon of the application behind a window source, as a PNG data URL (`None` for screens and
/// for programs without an icon).
#[tauri::command]
pub async fn native_share_icon(id: String) -> Option<String> {
    #[cfg(windows)]
    {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let geometry::SourceId::Window(handle) = geometry::SourceId::parse(&id)? else {
            return None;
        };
        tauri::async_runtime::spawn_blocking(move || {
            let pid = window_pid(handle)?;
            let png = icons::icon_png(pid).ok()?;
            Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
        })
        .await
        .ok()?
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        None
    }
}

#[tauri::command]
pub async fn native_share_capability() -> NativeCapability {
    tauri::async_runtime::spawn_blocking(capability)
        .await
        .unwrap_or_else(|e| NativeCapability {
            available: false,
            vendor: "none".into(),
            encoder: String::new(),
            reason: Some(e.to_string()),
        })
}

fn capability() -> NativeCapability {
    static CACHE: std::sync::OnceLock<NativeCapability> = std::sync::OnceLock::new();
    CACHE.get_or_init(probe_capability).clone()
}

#[cfg(windows)]
fn probe_capability() -> NativeCapability {
    match pipeline::probe() {
        Ok(probe) => NativeCapability {
            available: true,
            vendor: probe.vendor,
            encoder: probe.name,
            reason: None,
        },
        Err(reason) => NativeCapability {
            available: false,
            vendor: "none".into(),
            encoder: String::new(),
            reason: Some(reason),
        },
    }
}

#[cfg(not(windows))]
fn probe_capability() -> NativeCapability {
    NativeCapability {
        available: false,
        vendor: "none".into(),
        encoder: String::new(),
        reason: Some("Disponível apenas no Windows".into()),
    }
}

/// Starts capturing and encoding `id`. Nothing is sent until a viewer is offered.
#[tauri::command]
pub async fn native_share_start(
    app: AppHandle,
    id: String,
    max_height: u32,
    fps: u32,
    max_mbps: u32,
    include_audio: bool,
    relay_cap_kbps: Option<u32>,
) -> Result<NativeStartInfo, String> {
    #[cfg(windows)]
    {
        let source = geometry::SourceId::parse(&id).ok_or("Fonte inválida")?;
        let window_pid = match source {
            geometry::SourceId::Window(handle) => window_pid(handle),
            geometry::SourceId::Screen(_) => None,
        };
        sender::start(
            app_emitter(app),
            sender::StartRequest {
                source_id: id,
                include_audio,
                window_pid,
                source,
                max_height,
                fps: fps.clamp(1, 120),
                max_bitrate: u64::from(max_mbps.clamp(1, 50)) * 1_000_000,
                relay_cap: relay_cap_kbps.map(|kbps| u64::from(kbps) * 1000),
            },
        )
        .await
    }
    #[cfg(not(windows))]
    {
        let _ = (
            app,
            id,
            max_height,
            fps,
            max_mbps,
            include_audio,
            relay_cap_kbps,
        );
        Err(UNSUPPORTED.into())
    }
}

/// Moves a running native share to another source without ending it or touching the viewers.
#[tauri::command]
pub async fn native_share_switch(id: String) -> Result<NativeStartInfo, String> {
    #[cfg(windows)]
    {
        let source = geometry::SourceId::parse(&id).ok_or("Fonte inválida")?;
        let window_pid = match source {
            geometry::SourceId::Window(handle) => window_pid(handle),
            geometry::SourceId::Screen(_) => None,
        };
        sender::switch_source(sender::SwitchRequest {
            source_id: id,
            source,
            window_pid,
        })
        .await
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        Err(UNSUPPORTED.into())
    }
}

/// The process that owns a window, for per-application audio.
#[cfg(windows)]
fn window_pid(handle: u32) -> Option<u32> {
    Window::all()
        .ok()?
        .into_iter()
        .find(|window| window.id().ok() == Some(handle))
        .and_then(|window| window.pid().ok())
}

/// Opens the connection for one viewer and returns the offer SDP.
#[tauri::command]
pub async fn native_share_offer(
    app: AppHandle,
    peer_id: String,
    ice_servers: Vec<IceServerInput>,
    relay_only: bool,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        sender::offer(app_emitter(app), peer_id, ice_servers, relay_only).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, peer_id, ice_servers, relay_only);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub async fn native_share_answer(peer_id: String, sdp: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        sender::answer(&peer_id, &sdp).await
    }
    #[cfg(not(windows))]
    {
        let _ = (peer_id, sdp);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub async fn native_share_ice(
    peer_id: String,
    candidate: String,
    sdp_mid: Option<String>,
    sdp_mline_index: Option<i32>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        sender::add_ice(
            &peer_id,
            &candidate,
            sdp_mid.as_deref().unwrap_or("0"),
            sdp_mline_index.unwrap_or(0),
        )
        .await
    }
    #[cfg(not(windows))]
    {
        let _ = (peer_id, candidate, sdp_mid, sdp_mline_index);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub fn native_share_viewer_stop(peer_id: String) {
    #[cfg(windows)]
    sender::stop_viewer(&peer_id);
    #[cfg(not(windows))]
    let _ = peer_id;
}

#[tauri::command]
pub async fn native_share_stop() {
    #[cfg(windows)]
    sender::stop().await;
}

/// The sharer's own preview (see `sender::preview`); `None` while there is no picture yet.
#[tauri::command]
pub fn native_share_preview() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        sender::preview()
    }
    #[cfg(not(windows))]
    {
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub fn native_share_stats() -> Result<SenderStats, String> {
    #[cfg(windows)]
    {
        sender::stats()
    }
    #[cfg(not(windows))]
    {
        Err(UNSUPPORTED.into())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSummary {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub encoder: String,
    pub frames: u64,
    pub keyframes: u64,
    pub bytes: u64,
    pub avg_latency_ms: f64,
    pub ended: &'static str,
}

/// Development check: capture the chosen source through the real pipeline for a few seconds and
/// write the raw H.264 to the temp folder. Proves selection -> capture -> encode without a network.
#[tauri::command]
pub async fn native_share_dev_record(
    id: String,
    seconds: u32,
    max_height: u32,
    fps: u32,
    mbps: u32,
) -> Result<RecordSummary, String> {
    if !cfg!(debug_assertions) {
        return Err("Disponível apenas em desenvolvimento".into());
    }
    tauri::async_runtime::spawn_blocking(move || record(&id, seconds, max_height, fps, mbps))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn record(
    id: &str,
    seconds: u32,
    max_height: u32,
    fps: u32,
    mbps: u32,
) -> Result<RecordSummary, String> {
    use std::io::Write;
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    let source = geometry::SourceId::parse(id).ok_or("Fonte inválida")?;
    let path = std::env::temp_dir().join("telinha-native-share-test.h264");
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;

    let control = Arc::new(pipeline::Control::default());
    let stopper = control.clone();
    let seconds = seconds.clamp(1, 60);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(u64::from(seconds)));
        stopper.stop.store(true, Ordering::Relaxed);
    });

    let started = Mutex::new((0u32, 0u32, String::new()));
    let (mut frames, mut keyframes, mut bytes, mut latency) = (0u64, 0u64, 0u64, 0f64);
    let mut sizes: Vec<usize> = Vec::new();
    let end = pipeline::run(
        pipeline::Options {
            source,
            max_height,
            fps,
            bitrate: mbps.clamp(1, 50) * 1_000_000,
        },
        control,
        |info| *started.lock().unwrap() = (info.width, info.height, info.encoder),
        |frame| {
            frames += 1;
            keyframes += u64::from(frame.key);
            bytes += frame.data.len() as u64;
            sizes.push(frame.data.len());
            latency += frame.latency_ms;
            let _ = file.write_all(&frame.data);
        },
    )?;
    let (width, height, encoder) = started.into_inner().unwrap();
    // Frame boundaries and key flags next to the stream, so tooling can decode it frame by frame.
    let _ = std::fs::write(
        path.with_extension("h264.json"),
        format!("{{\"width\":{width},\"height\":{height},\"sizes\":{sizes:?}}}"),
    );
    Ok(RecordSummary {
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        encoder,
        frames,
        keyframes,
        bytes,
        avg_latency_ms: if frames > 0 {
            latency / frames as f64
        } else {
            0.0
        },
        ended: match end {
            pipeline::End::Stopped => "stopped",
            pipeline::End::SourceClosed => "source-closed",
        },
    })
}

#[cfg(not(windows))]
fn record(
    _id: &str,
    _seconds: u32,
    _max_height: u32,
    _fps: u32,
    _mbps: u32,
) -> Result<RecordSummary, String> {
    Err("Disponível apenas no Windows".into())
}

#[cfg(test)]
mod wire_tests {
    //! The shapes the frontend sends over IPC. (The commands themselves cannot run under Tauri's
    //! mock runtime on Windows without a common-controls manifest, so what can go wrong in the
    //! translation is checked directly.)
    use super::*;
    use serde_json::json;

    #[test]
    fn ice_servers_accept_the_browsers_rtc_ice_server_shapes() {
        let servers: Vec<IceServerInput> = serde_json::from_value(json!([
            { "urls": "stun:stun.example.test:3478" },
            {
                "urls": ["turn:turn.example.test:3478", "turns:turn.example.test:5349"],
                "username": "u",
                "credential": "c"
            }
        ]))
        .expect("RTCIceServer list");
        assert_eq!(servers[0].urls(), vec!["stun:stun.example.test:3478"]);
        assert_eq!(servers[0].username, None);
        assert_eq!(
            servers[1].urls(),
            vec![
                "turn:turn.example.test:3478",
                "turns:turn.example.test:5349"
            ]
        );
        assert_eq!(servers[1].username.as_deref(), Some("u"));
        assert_eq!(servers[1].credential.as_deref(), Some("c"));
    }

    #[test]
    fn ice_servers_without_urls_are_rejected() {
        assert!(serde_json::from_value::<IceServerInput>(json!({ "username": "u" })).is_err());
    }

    #[test]
    fn results_use_camel_case_keys_for_the_frontend() {
        let info = serde_json::to_value(NativeStartInfo {
            width: 1920,
            height: 1080,
            encoder: "NVENC".into(),
        })
        .unwrap();
        assert_eq!(
            info,
            json!({ "width": 1920, "height": 1080, "encoder": "NVENC" })
        );

        let stats = serde_json::to_value(SenderStats {
            viewers: 2,
            target_kbps: 8000,
            frames_per_second: 59.5,
            sent_kbps: 7900.0,
        })
        .unwrap();
        assert_eq!(
            stats,
            json!({ "viewers": 2, "targetKbps": 8000, "framesPerSecond": 59.5, "sentKbps": 7900.0 })
        );
    }
}

#[cfg(all(test, windows))]
mod test_window;

#[cfg(all(test, windows))]
mod hardware_tests {
    //! These need a real GPU and a desktop session, so they are ignored by default.
    //! Run them locally with `cargo test -- --ignored`. The window tests open a small window of
    //! their own for a few seconds and never touch the user's programs.
    use super::test_window::TestWindow;
    use super::*;

    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn probes_a_hardware_encoder() {
        let probe = pipeline::probe().expect("hardware H.264 encoder");
        assert!(!probe.name.is_empty());
    }

    /// Starting and stopping a share repeatedly in one process must be safe (a regression test:
    /// shutting Media Foundation down after each run used to crash the next run).
    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn restarting_the_pipeline_is_safe() {
        let monitor = list_sources()
            .unwrap()
            .into_iter()
            .find(|source| source.kind == "screen")
            .expect("a monitor");
        for round in 0..4 {
            let summary = record(&monitor.id, 1, 720, 30, 4).expect("recording");
            assert!(summary.frames > 0, "round {round}");
        }
    }

    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn records_the_primary_monitor() {
        let monitor = list_sources()
            .unwrap()
            .into_iter()
            .find(|source| source.kind == "screen")
            .expect("a monitor");
        let summary = record(&monitor.id, 3, 720, 30, 4).expect("recording");
        assert!(summary.frames > 0, "{}", summary.ended);
        assert!(summary.keyframes >= 1);
        assert_eq!(summary.height % 2, 0);
    }

    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn records_a_window_and_ends_when_it_closes() {
        let window = TestWindow::open(800, 600);
        let remote = window.remote();
        let closer = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            remote.close();
        });
        let summary = record(&window.id(), 15, 720, 30, 4).expect("recording");
        closer.join().unwrap();
        assert!(summary.frames > 0);
        assert_eq!(summary.ended, "source-closed");
        assert_eq!((summary.width % 2, summary.height % 2), (0, 0));
    }

    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn window_resize_keeps_streaming_letterboxed() {
        let window = TestWindow::open(900, 600);
        let remote = window.remote();
        let resizer = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            remote.resize(500, 800);
            std::thread::sleep(std::time::Duration::from_secs(2));
            remote.resize(1000, 400);
        });
        let summary = record(&window.id(), 6, 720, 30, 4).expect("recording");
        resizer.join().unwrap();
        assert!(summary.frames > 30, "{} frames", summary.frames);
        assert_eq!(summary.ended, "stopped");
    }

    /// Prints what the list offers on this desktop (read only). Run with `--nocapture` to see why a
    /// window is or is not there.
    #[test]
    #[ignore = "reads the real desktop"]
    fn prints_the_sources_on_this_desktop() {
        for source in list_sources().expect("sources") {
            println!(
                "{} | {} | {}x{} | {} | {}",
                source.id,
                source.kind,
                source.width,
                source.height,
                source.app.unwrap_or_default(),
                source.name
            );
        }
    }

    /// The sharer's own preview is the picture the encoder gets: letterboxed at the encode size,
    /// colors right, and it keeps the last frame while the window is minimized (where a fresh
    /// capture of the window would only return its 160x28 title bar).
    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn the_preview_is_what_the_encoder_gets_and_survives_minimizing() {
        use std::sync::atomic::Ordering;
        use std::sync::Arc;

        let window = TestWindow::open(900, 600);
        let remote = window.remote();
        let control = Arc::new(pipeline::Control::default());
        control.preview_wanted.store(true, Ordering::Relaxed);
        let stopper = control.clone();
        let minimizer = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            remote.minimize();
            std::thread::sleep(std::time::Duration::from_secs(2));
            stopper.stop.store(true, Ordering::Relaxed);
        });
        let mut size = (0, 0);
        pipeline::run(
            pipeline::Options {
                source: geometry::SourceId::parse(&window.id()).unwrap(),
                max_height: 720,
                fps: 30,
                bitrate: 4_000_000,
            },
            control.clone(),
            |info| size = (info.width, info.height),
            |_| {},
        )
        .expect("pipeline");
        minimizer.join().unwrap();

        let url = control
            .preview
            .lock()
            .unwrap()
            .clone()
            .expect("a preview was produced");
        let jpeg = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            url.strip_prefix("data:image/jpeg;base64,")
                .expect("a JPEG data URL"),
        )
        .expect("base64");
        let image = image::load_from_memory(&jpeg)
            .expect("a decodable JPEG")
            .to_rgba8();
        // Same picture as the encoder: the encode frame, not the 160x28 stub of a minimized window.
        assert_eq!(image.dimensions(), size);
        let bright = image
            .pixels()
            .filter(|p| p[0] as u32 + p[1] as u32 + p[2] as u32 > 60)
            .count();
        assert!(
            bright * 4 > image.pixels().len(),
            "the preview is mostly black"
        );
        let _ = std::fs::write(
            std::env::temp_dir().join("telinha-native-share-preview.jpg"),
            &jpeg,
        );
    }

    /// A game that is alt-tabbed out of fullscreen is minimized and people still want to share it.
    /// Sharing it must encode at the size it has when restored (not at the 160x28 stub Windows
    /// reports while minimized), and frames must flow once the window comes back.
    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn a_minimized_window_is_shared_at_its_restored_size() {
        let window = TestWindow::open(900, 600);
        let remote = window.remote();
        remote.minimize();
        std::thread::sleep(std::time::Duration::from_millis(600));

        let restorer = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            remote.restore();
        });
        let summary = record(&window.id(), 7, 1080, 30, 4).expect("recording");
        restorer.join().unwrap();
        assert!(
            summary.width >= 400 && summary.height >= 300,
            "encoded at {}x{}",
            summary.width,
            summary.height
        );
        assert!(
            summary.frames > 20,
            "only {} frames after the window was restored",
            summary.frames
        );
    }

    /// The whole sending path against a real libwebrtc viewer in the same process: capture a
    /// window, encode on the GPU, negotiate offer/answer/ICE like the JS layer does, and check
    /// the viewer decodes video at the encode size.
    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn streams_h264_to_a_libwebrtc_viewer() {
        use super::sender;
        use libwebrtc::prelude::*;
        use libwebrtc::stats::RtcStats;
        use std::sync::{mpsc, Arc};
        use std::time::{Duration, Instant};

        let window = TestWindow::open(900, 600);
        let (event_tx, event_rx) = mpsc::channel::<(String, serde_json::Value)>();
        let emit: sender::Emit = Arc::new(move |name, value| {
            let _ = event_tx.send((name.to_string(), value));
        });

        tauri::async_runtime::block_on(async {
            let info = sender::start(
                emit.clone(),
                sender::StartRequest {
                    source_id: window.id(),
                    source: geometry::SourceId::parse(&window.id()).unwrap(),
                    include_audio: true,
                    // The window belongs to this test process, so its audio tree is ours.
                    window_pid: Some(std::process::id()),
                    max_height: 720,
                    fps: 30,
                    max_bitrate: 6_000_000,
                    relay_cap: None,
                },
            )
            .await
            .expect("start");

            let viewer = PeerConnectionFactory::default()
                .create_peer_connection(RtcConfiguration::default())
                .expect("viewer connection");
            let (viewer_ice_tx, viewer_ice_rx) = mpsc::channel::<(String, String, i32)>();
            viewer.on_ice_candidate(Some(Box::new(move |c| {
                let _ = viewer_ice_tx.send((c.candidate(), c.sdp_mid(), c.sdp_mline_index()));
            })));

            let offer = sender::offer(emit.clone(), "viewer".into(), vec![], false)
                .await
                .expect("offer");
            assert!(offer.contains("H264"), "offer must be H.264: {offer}");
            assert!(
                offer.contains("opus/48000"),
                "offer must carry Opus: {offer}"
            );
            assert!(
                offer.contains("sprop-stereo=1"),
                "Opus must be offered as stereo"
            );
            viewer
                .set_remote_description(SessionDescription::parse(&offer, SdpType::Offer).unwrap())
                .await
                .expect("viewer remote description");
            let answer = viewer
                .create_answer(AnswerOptions::default())
                .await
                .expect("answer");
            viewer
                .set_local_description(answer.clone())
                .await
                .expect("viewer local");
            sender::answer("viewer", &answer.to_string())
                .await
                .expect("sender answer");

            let started = Instant::now();
            let mut connected = false;
            let mut best: Option<(u32, u32, u32, u64)> = None;
            let mut audio_packets = 0u64;
            while started.elapsed() < Duration::from_secs(20) {
                // Relay the candidates in both directions, as the signaling server would.
                while let Ok((name, value)) = event_rx.try_recv() {
                    match name.as_str() {
                        "native-share-ice" => {
                            let candidate = IceCandidate::parse(
                                value["sdpMid"].as_str().unwrap_or("0"),
                                value["sdpMlineIndex"].as_i64().unwrap_or(0) as i32,
                                value["candidate"].as_str().unwrap_or_default(),
                            )
                            .expect("candidate");
                            viewer
                                .add_ice_candidate(candidate)
                                .await
                                .expect("viewer ice");
                        }
                        "native-share-state" => connected |= value["state"] == "connected",
                        _ => {}
                    }
                }
                while let Ok((candidate, mid, index)) = viewer_ice_rx.try_recv() {
                    sender::add_ice("viewer", &candidate, &mid, index)
                        .await
                        .expect("sender ice");
                }
                for stat in viewer.get_stats().await.unwrap_or_default() {
                    if let RtcStats::InboundRtp(inbound) = stat {
                        if inbound.stream.kind == "video" {
                            best = Some((
                                inbound.inbound.frames_decoded,
                                inbound.inbound.frame_width,
                                inbound.inbound.frame_height,
                                inbound.received.packets_received,
                            ));
                        } else if inbound.stream.kind == "audio" {
                            audio_packets = inbound.received.packets_received;
                        }
                    }
                }
                if matches!(best, Some((decoded, ..)) if decoded >= 30) && audio_packets >= 25 {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }

            let stats = sender::stats().expect("stats");
            viewer.close();
            sender::stop().await;

            let (decoded, width, height, packets) = best.expect("the viewer received no video");
            eprintln!(
                "viewer: {decoded} frames decoded, {width}x{height}, {packets} packets, {audio_packets} audio packets; sender target {} kbit/s, {:.1} fps in, connected={connected}",
                stats.target_kbps, stats.frames_per_second
            );
            assert!(connected, "the sender never reported a connected state");
            assert!(
                decoded >= 30,
                "only {decoded} frames decoded ({packets} packets)"
            );
            assert_eq!((width, height), (info.width, info.height));
            assert!(stats.target_kbps > 0);
            assert!(
                audio_packets >= 25,
                "only {audio_packets} audio packets arrived"
            );
        });
    }

    /// Two viewers from one encoder: each has its own source and congestion controller, both must
    /// decode, and one leaving must not interrupt the other.
    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn serves_two_viewers_from_one_encoder() {
        use super::sender;
        use libwebrtc::prelude::*;
        use libwebrtc::stats::RtcStats;
        use std::sync::{mpsc, Arc};
        use std::time::{Duration, Instant};

        struct Viewer {
            id: &'static str,
            pc: PeerConnection,
            ice: mpsc::Receiver<(String, String, i32)>,
        }

        let window = TestWindow::open(900, 600);
        let (event_tx, event_rx) = mpsc::channel::<(String, serde_json::Value)>();
        let emit: sender::Emit = Arc::new(move |name, value| {
            let _ = event_tx.send((name.to_string(), value));
        });

        tauri::async_runtime::block_on(async {
            sender::start(
                emit.clone(),
                sender::StartRequest {
                    source_id: window.id(),
                    source: geometry::SourceId::parse(&window.id()).unwrap(),
                    include_audio: false,
                    window_pid: None,
                    max_height: 720,
                    fps: 30,
                    max_bitrate: 6_000_000,
                    relay_cap: Some(2_000_000),
                },
            )
            .await
            .expect("start");

            let mut viewers = Vec::new();
            for id in ["viewer-a", "viewer-b"] {
                let pc = PeerConnectionFactory::default()
                    .create_peer_connection(RtcConfiguration::default())
                    .expect("viewer connection");
                let (ice_tx, ice) = mpsc::channel();
                pc.on_ice_candidate(Some(Box::new(move |c| {
                    let _ = ice_tx.send((c.candidate(), c.sdp_mid(), c.sdp_mline_index()));
                })));
                let offer = sender::offer(emit.clone(), id.into(), vec![], false)
                    .await
                    .expect("offer");
                pc.set_remote_description(
                    SessionDescription::parse(&offer, SdpType::Offer).unwrap(),
                )
                .await
                .expect("remote description");
                let answer = pc
                    .create_answer(AnswerOptions::default())
                    .await
                    .expect("answer");
                pc.set_local_description(answer.clone())
                    .await
                    .expect("local");
                sender::answer(id, &answer.to_string())
                    .await
                    .expect("answer");
                viewers.push(Viewer { id, pc, ice });
            }

            let decoded = |viewer: &Viewer| {
                let pc = viewer.pc.clone();
                async move {
                    for stat in pc.get_stats().await.unwrap_or_default() {
                        if let RtcStats::InboundRtp(inbound) = stat {
                            if inbound.stream.kind == "video" {
                                return inbound.inbound.frames_decoded;
                            }
                        }
                    }
                    0
                }
            };
            let pump = |viewers: &[Viewer]| {
                while let Ok((name, value)) = event_rx.try_recv() {
                    if name != "native-share-ice" {
                        continue;
                    }
                    let peer = value["peerId"].as_str().unwrap_or_default().to_string();
                    let Some(target) = viewers.iter().find(|v| v.id == peer) else {
                        continue;
                    };
                    let candidate = IceCandidate::parse(
                        value["sdpMid"].as_str().unwrap_or("0"),
                        value["sdpMlineIndex"].as_i64().unwrap_or(0) as i32,
                        value["candidate"].as_str().unwrap_or_default(),
                    )
                    .expect("candidate");
                    let pc = target.pc.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = pc.add_ice_candidate(candidate).await;
                    });
                }
                for viewer in viewers {
                    while let Ok((candidate, mid, index)) = viewer.ice.try_recv() {
                        let id = viewer.id;
                        tauri::async_runtime::spawn(async move {
                            let _ = sender::add_ice(id, &candidate, &mid, index).await;
                        });
                    }
                }
            };

            let started = Instant::now();
            let mut counts = vec![0u32; viewers.len()];
            while started.elapsed() < Duration::from_secs(25) {
                pump(&viewers);
                for (index, viewer) in viewers.iter().enumerate() {
                    counts[index] = decoded(viewer).await;
                }
                if counts.iter().all(|count| *count >= 20) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(
                counts.iter().all(|count| *count >= 20),
                "both viewers must decode: {counts:?}"
            );
            assert_eq!(sender::stats().expect("stats").viewers, 2);

            // One viewer leaves; the other keeps getting frames.
            sender::stop_viewer("viewer-a");
            let before = decoded(&viewers[1]).await;
            let waited = Instant::now();
            let mut after = before;
            while waited.elapsed() < Duration::from_secs(10) && after < before + 20 {
                pump(&viewers[1..]);
                std::thread::sleep(Duration::from_millis(100));
                after = decoded(&viewers[1]).await;
            }
            assert!(
                after >= before + 20,
                "the remaining viewer stalled: {before} -> {after}"
            );
            assert_eq!(sender::stats().expect("stats").viewers, 1);

            for viewer in &viewers {
                viewer.pc.close();
            }
            sender::stop().await;
        });
    }

    /// Switching the source mid-share: the viewer keeps decoding on the same connection, the
    /// picture changes to the new source's size, and a bad target leaves the old source running.
    #[test]
    #[ignore = "needs a GPU and an interactive desktop"]
    fn switching_the_source_keeps_the_viewer_connected() {
        use super::sender;
        use libwebrtc::prelude::*;
        use libwebrtc::stats::RtcStats;
        use std::sync::{mpsc, Arc};
        use std::time::{Duration, Instant};

        let first = TestWindow::open(900, 600);
        let second = TestWindow::open(640, 360);
        let (event_tx, event_rx) = mpsc::channel::<(String, serde_json::Value)>();
        let emit: sender::Emit = Arc::new(move |name, value| {
            let _ = event_tx.send((name.to_string(), value));
        });

        tauri::async_runtime::block_on(async {
            let started = sender::start(
                emit.clone(),
                sender::StartRequest {
                    source_id: first.id(),
                    source: geometry::SourceId::parse(&first.id()).unwrap(),
                    include_audio: false,
                    window_pid: None,
                    max_height: 720,
                    fps: 30,
                    max_bitrate: 6_000_000,
                    relay_cap: None,
                },
            )
            .await
            .expect("start");
            let first_size = (started.width, started.height);

            let pc = PeerConnectionFactory::default()
                .create_peer_connection(RtcConfiguration::default())
                .expect("viewer connection");
            let (ice_tx, ice) = mpsc::channel();
            pc.on_ice_candidate(Some(Box::new(move |c| {
                let _ = ice_tx.send((c.candidate(), c.sdp_mid(), c.sdp_mline_index()));
            })));
            let offer = sender::offer(emit.clone(), "viewer".into(), vec![], false)
                .await
                .expect("offer");
            pc.set_remote_description(SessionDescription::parse(&offer, SdpType::Offer).unwrap())
                .await
                .expect("remote description");
            let answer = pc
                .create_answer(AnswerOptions::default())
                .await
                .expect("answer");
            pc.set_local_description(answer.clone())
                .await
                .expect("local");
            sender::answer("viewer", &answer.to_string())
                .await
                .expect("answer");

            let video = || {
                let pc = pc.clone();
                async move {
                    for stat in pc.get_stats().await.unwrap_or_default() {
                        if let RtcStats::InboundRtp(inbound) = stat {
                            if inbound.stream.kind == "video" {
                                return (
                                    inbound.inbound.frames_decoded,
                                    inbound.inbound.frame_width,
                                    inbound.inbound.frame_height,
                                );
                            }
                        }
                    }
                    (0, 0, 0)
                }
            };
            let pump = || {
                while let Ok((name, value)) = event_rx.try_recv() {
                    if name != "native-share-ice" {
                        continue;
                    }
                    let candidate = IceCandidate::parse(
                        value["sdpMid"].as_str().unwrap_or("0"),
                        value["sdpMlineIndex"].as_i64().unwrap_or(0) as i32,
                        value["candidate"].as_str().unwrap_or_default(),
                    )
                    .expect("candidate");
                    let pc = pc.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = pc.add_ice_candidate(candidate).await;
                    });
                }
                while let Ok((candidate, mid, index)) = ice.try_recv() {
                    tauri::async_runtime::spawn(async move {
                        let _ = sender::add_ice("viewer", &candidate, &mid, index).await;
                    });
                }
            };
            // Waits until `done` accepts what the viewer has decoded so far.
            let wait_for = |done: Box<dyn Fn((u32, u32, u32)) -> bool>, what: &'static str| {
                let video = &video;
                let pump = &pump;
                async move {
                    let began = Instant::now();
                    loop {
                        pump();
                        let seen = video().await;
                        if done(seen) {
                            return seen;
                        }
                        assert!(
                            began.elapsed() < Duration::from_secs(25),
                            "{what}: {seen:?}"
                        );
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            };

            let (before, ..) =
                wait_for(Box::new(|(frames, ..)| frames >= 20), "first source").await;

            // A target that does not exist: the switch fails and the first source keeps going.
            let failed = sender::switch_source(sender::SwitchRequest {
                source_id: "window:1".into(),
                source: geometry::SourceId::Window(1),
                window_pid: None,
            })
            .await;
            assert!(failed.is_err(), "a missing window must not be switched to");
            let (resumed, ..) = wait_for(
                Box::new(move |(frames, ..)| frames >= before + 20),
                "after a failed switch",
            )
            .await;

            let info = sender::switch_source(sender::SwitchRequest {
                source_id: second.id(),
                source: geometry::SourceId::parse(&second.id()).unwrap(),
                window_pid: None,
            })
            .await
            .expect("switch");
            let second_size = (info.width, info.height);
            assert_ne!(second_size, first_size, "the new source has its own size");
            let (_, width, height) = wait_for(
                Box::new(move |(frames, w, h)| frames >= resumed + 20 && (w, h) == second_size),
                "after switching",
            )
            .await;
            assert_eq!((width, height), second_size);
            assert_eq!(sender::stats().expect("stats").viewers, 1);

            pc.close();
            sender::stop().await;
        });
    }

    #[test]
    #[ignore = "needs an interactive desktop"]
    fn extracts_the_icon_of_a_running_program() {
        // The test process itself is a running program with an executable on disk.
        let png = super::icons::icon_png(std::process::id()).expect("icon");
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
        assert!(png.len() > 200, "{} bytes", png.len());
    }
}
