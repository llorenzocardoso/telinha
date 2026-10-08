use crate::audio;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ColorType, RgbaImage};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{ipc::Response, AppHandle, Emitter, Manager};
use xcap::{Monitor, Window};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSource {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub thumbnail: String,
    pub pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFrame {
    pub seq: u64,
    pub width: u32,
    pub height: u32,
}

struct CaptureSession {
    stop: std::sync::Arc<AtomicBool>,
}

struct EncodedFrame {
    jpeg: Vec<u8>,
}

static CAPTURE: Mutex<Option<CaptureSession>> = Mutex::new(None);
static LATEST_FRAME: Mutex<Option<EncodedFrame>> = Mutex::new(None);
static FRAME_SEQ: AtomicU64 = AtomicU64::new(1);

fn encode_jpeg_bytes(img: &RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let (width, height) = img.dimensions();
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for pixel in img.pixels() {
        rgb.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
    }
    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode(&rgb, width, height, ColorType::Rgb8.into())
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

fn jpeg_data_url(img: &RgbaImage, quality: u8) -> String {
    encode_jpeg_bytes(img, quality)
        .map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
        .unwrap_or_default()
}

fn fit_width(img: RgbaImage, max_width: u32) -> RgbaImage {
    if img.width() <= max_width || max_width == 0 {
        return img;
    }
    let height = ((img.height() as f32) * (max_width as f32) / (img.width() as f32)).round() as u32;
    image::imageops::resize(&img, max_width, height.max(1), FilterType::Triangle)
}

fn capture_source_image(id: &str) -> Result<RgbaImage, String> {
    if let Some(screen_id) = id.strip_prefix("screen:") {
        let target: u32 = screen_id.parse().map_err(|_| "Tela inválida".to_string())?;
        for monitor in Monitor::all().map_err(|e| e.to_string())? {
            if monitor.id().unwrap_or_default() == target {
                return monitor.capture_image().map_err(|e| e.to_string());
            }
        }
        return Err("Tela não encontrada".into());
    }

    if let Some(window_id) = id.strip_prefix("window:") {
        let target: u32 = window_id
            .parse()
            .map_err(|_| "Janela inválida".to_string())?;
        for window in Window::all().map_err(|e| e.to_string())? {
            if window.id().unwrap_or_default() == target {
                return window.capture_image().map_err(|e| e.to_string());
            }
        }
        return Err("Janela não encontrada".into());
    }

    Err("Fonte inválida".into())
}

fn should_skip_window(window: &Window) -> bool {
    let title = window.title().unwrap_or_default();
    let app_name = window.app_name().unwrap_or_default();
    if title.trim().is_empty() {
        return true;
    }
    if window.is_minimized().unwrap_or(false) {
        return true;
    }
    if window.width().unwrap_or(0) < 40 || window.height().unwrap_or(0) < 40 {
        return true;
    }
    let haystack = format!("{title} {app_name}").to_lowercase();
    haystack.contains("telinha")
}

#[tauri::command]
pub fn list_share_sources() -> Result<Vec<ShareSource>, String> {
    let mut sources = Vec::new();

    for monitor in Monitor::all().map_err(|e| e.to_string())? {
        let id = format!("screen:{}", monitor.id().unwrap_or_default());
        let name = monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| "Tela".into());
        let thumbnail = monitor
            .capture_image()
            .ok()
            .map(|img| jpeg_data_url(&fit_width(img, 560), 70))
            .unwrap_or_default();
        sources.push(ShareSource {
            id,
            name,
            kind: "screen".into(),
            thumbnail,
            pid: None,
        });
    }

    for window in Window::all().map_err(|e| e.to_string())? {
        if should_skip_window(&window) {
            continue;
        }
        let id = format!("window:{}", window.id().unwrap_or_default());
        let title = window.title().unwrap_or_else(|_| "Janela".into());
        let thumbnail = window
            .capture_image()
            .ok()
            .map(|img| jpeg_data_url(&fit_width(img, 560), 70))
            .unwrap_or_default();
        sources.push(ShareSource {
            id,
            name: title,
            kind: "window".into(),
            thumbnail,
            pid: window.pid().ok(),
        });
    }

    Ok(sources)
}

#[tauri::command]
pub fn resolve_share_source(label: String) -> Result<String, String> {
    let needle = normalize_label(&label);
    if !needle.is_empty() {
        if let Ok(windows) = Window::all() {
            let mut best: Option<(usize, String)> = None;
            for window in windows {
                if should_skip_window(&window) {
                    continue;
                }
                let title = window.title().unwrap_or_default();
                let norm = normalize_label(&title);
                if norm.is_empty() {
                    continue;
                }
                let score = if norm == needle {
                    1000usize
                } else if needle.contains(&norm) || norm.contains(&needle) {
                    norm.len().min(needle.len())
                } else {
                    0
                };
                if score > 0
                    && best
                        .as_ref()
                        .map(|(current, _)| score > *current)
                        .unwrap_or(true)
                {
                    if let Ok(id) = window.id() {
                        best = Some((score, format!("window:{id}")));
                    }
                }
            }
            if let Some((_, id)) = best {
                return Ok(id);
            }
        }

        if let Ok(monitors) = Monitor::all() {
            for monitor in monitors {
                let name = monitor
                    .friendly_name()
                    .or_else(|_| monitor.name())
                    .unwrap_or_default();
                let norm = normalize_label(&name);
                if !norm.is_empty()
                    && (norm == needle || needle.contains(&norm) || norm.contains(&needle))
                {
                    return Ok(format!("screen:{}", monitor.id().unwrap_or_default()));
                }
            }
        }
    }

    first_screen_id()
}

fn normalize_label(value: &str) -> String {
    value.trim().to_lowercase()
}

fn first_screen_id() -> Result<String, String> {
    let monitor = Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "Nenhuma tela encontrada".to_string())?;
    Ok(format!("screen:{}", monitor.id().unwrap_or_default()))
}

#[tauri::command]
pub fn start_share_capture(
    app: AppHandle,
    id: String,
    fps: u32,
    max_width: u32,
    include_audio: Option<bool>,
    include_video: Option<bool>,
) -> Result<(), String> {
    stop_share_capture();

    let stop = std::sync::Arc::new(AtomicBool::new(false));
    let source_id = id.clone();

    if include_video.unwrap_or(true) {
        let stop_flag = stop.clone();
        let frame_interval = Duration::from_millis((1000 / fps.clamp(5, 60)) as u64);
        let video_app = app.clone();
        thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                let started = Instant::now();
                match capture_source_image(&source_id) {
                    Ok(image) => {
                        let fitted = if max_width == 0 {
                            image
                        } else {
                            fit_width(image, max_width)
                        };
                        let width = fitted.width();
                        let height = fitted.height();
                        if let Ok(jpeg) = encode_jpeg_bytes(&fitted, 80) {
                            let seq = FRAME_SEQ.fetch_add(1, Ordering::Relaxed);
                            if let Ok(mut slot) = LATEST_FRAME.lock() {
                                *slot = Some(EncodedFrame { jpeg });
                            }
                            let _ =
                                video_app.emit("share-frame", ShareFrame { seq, width, height });
                        }
                    }
                    Err(_) => {
                        thread::sleep(Duration::from_millis(120));
                        continue;
                    }
                }
                if let Some(wait) = frame_interval.checked_sub(started.elapsed()) {
                    thread::sleep(wait);
                }
            }
        });
    }

    if include_audio.unwrap_or(true) {
        audio::start_share_audio(app, id.clone(), resolve_window_pid(&id), stop.clone());
    }

    *CAPTURE.lock().map_err(|e| e.to_string())? = Some(CaptureSession { stop });
    Ok(())
}

fn resolve_window_pid(id: &str) -> Option<u32> {
    let window_id = id.strip_prefix("window:")?;
    let target: u32 = window_id.parse().ok()?;
    for window in Window::all().ok()? {
        if window.id().unwrap_or_default() == target {
            return window.pid().ok();
        }
    }
    None
}

#[tauri::command]
pub fn read_share_frame() -> Result<Response, String> {
    let frame = LATEST_FRAME
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or_else(|| "Nenhum quadro disponível".to_string())?;
    Ok(Response::new(frame.jpeg))
}

#[tauri::command]
pub fn stop_share_capture() {
    if let Ok(mut guard) = CAPTURE.lock() {
        if let Some(session) = guard.take() {
            session.stop.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut frame) = LATEST_FRAME.lock() {
        *frame = None;
    }
    audio::clear_share_audio();
}

#[tauri::command]
pub fn set_window_layout(app: AppHandle, layout: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada".to_string())?;

    match layout.as_str() {
        "watch" => {
            let _ = window.set_always_on_top(false);
            window
                .set_min_size(Some(tauri::LogicalSize::new(800.0, 500.0)))
                .map_err(|e| e.to_string())?;
            window.set_fullscreen(true).map_err(|e| e.to_string())?;
        }
        "watch-window" => {
            let _ = window.set_always_on_top(false);
            apply_window_size(&window, 720.0, 480.0, 1100.0, 700.0)?;
        }
        "watch-dual" => {
            let _ = window.set_always_on_top(false);
            apply_window_size(&window, 960.0, 540.0, 1440.0, 810.0)?;
        }
        "lobby-cameras" => {
            apply_window_size(&window, 640.0, 500.0, 980.0, 700.0)?;
        }
        _ => {
            apply_window_size(&window, 640.0, 500.0, 720.0, 580.0)?;
        }
    }
    Ok(())
}

fn apply_window_size(
    window: &tauri::WebviewWindow,
    min_w: f64,
    min_h: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    let _ = window.unmaximize();
    window
        .set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn encode_jpeg_bytes_writes_soi_marker() {
        let image = RgbaImage::from_pixel(8, 8, Rgba([12, 34, 56, 255]));
        let bytes = encode_jpeg_bytes(&image, 80).expect("jpeg");
        assert!(bytes.len() > 16);
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }
}
