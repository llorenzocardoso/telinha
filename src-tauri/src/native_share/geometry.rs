//! Pure helpers for the native share pipeline: source ids, encode size and letterboxing.
//! No platform dependencies, so these run (and are tested) everywhere.

/// A capture source picked in the app, as listed by `capture::list_share_sources`
/// (`screen:<HMONITOR>` / `window:<HWND>`; xcap exposes the handle value as a `u32`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceId {
    Screen(u32),
    Window(u32),
}

impl SourceId {
    pub fn parse(id: &str) -> Option<Self> {
        let (kind, value) = id.split_once(':')?;
        let value: u32 = value.parse().ok()?;
        match kind {
            "screen" => Some(Self::Screen(value)),
            "window" => Some(Self::Window(value)),
            _ => None,
        }
    }

    /// The Win32 handle value. Handles are 32-bit significant, so the `u32` is sign-extended.
    pub fn handle(self) -> isize {
        let raw = match self {
            Self::Screen(v) | Self::Window(v) => v,
        };
        raw as i32 as isize
    }
}

const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;

/// Click-through and never-activated windows are overlays (the NVIDIA and Xbox game bars, tooltips
/// and the like), not something a person means to share, and they capture as a black rectangle.
pub fn excluded_by_style(ex_style: u32) -> bool {
    ex_style & (WS_EX_TRANSPARENT | WS_EX_NOACTIVATE) != 0
}

/// Whether a top-level window belongs in the list of things to share. Untitled windows and Telinha
/// itself are left out. A minimized window (a game after alt-tab) stays: Windows reports a tiny
/// stub size for it, so the size only counts while the window is not minimized.
pub fn offer_window(title: &str, app_name: &str, minimized: bool, width: u32, height: u32) -> bool {
    if title.trim().is_empty() {
        return false;
    }
    if format!("{title} {app_name}")
        .to_lowercase()
        .contains("telinha")
    {
        return false;
    }
    minimized || (width >= 40 && height >= 40)
}

/// Rounds down to an even number; H.264 NV12 needs even dimensions.
pub fn even(value: u32) -> u32 {
    value & !1
}

/// Encode size for a source: fit `max_height` (0 = no limit), never upscale, keep the aspect
/// ratio, even dimensions, at least 2x2.
pub fn encode_size(src_w: u32, src_h: u32, max_height: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 {
        return (2, 2);
    }
    let scale = if max_height == 0 {
        1.0
    } else {
        (f64::from(max_height) / f64::from(src_h)).min(1.0)
    };
    let w = even((f64::from(src_w) * scale).round() as u32).max(2);
    let h = even((f64::from(src_h) * scale).round() as u32).max(2);
    (w, h)
}

/// Where the content lands inside the fixed encode frame: scaled to fit, centered, with even
/// offsets and sizes. Returns `(x, y, width, height)`.
pub fn letterbox(content_w: u32, content_h: u32, dst_w: u32, dst_h: u32) -> (u32, u32, u32, u32) {
    if content_w == 0 || content_h == 0 || dst_w == 0 || dst_h == 0 {
        return (0, 0, dst_w, dst_h);
    }
    let scale =
        (f64::from(dst_w) / f64::from(content_w)).min(f64::from(dst_h) / f64::from(content_h));
    let w = even((f64::from(content_w) * scale).round() as u32)
        .clamp(2, dst_w)
        .max(2);
    let h = even((f64::from(content_h) * scale).round() as u32)
        .clamp(2, dst_h)
        .max(2);
    (even((dst_w - w) / 2), even((dst_h - h) / 2), w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_screen_and_window_ids() {
        assert_eq!(
            SourceId::parse("screen:65537"),
            Some(SourceId::Screen(65537))
        );
        assert_eq!(
            SourceId::parse("window:329498"),
            Some(SourceId::Window(329498))
        );
    }

    #[test]
    fn rejects_malformed_ids() {
        for bad in [
            "",
            "screen",
            "screen:",
            "screen:abc",
            "tab:1",
            "window:-5",
            ":1",
        ] {
            assert_eq!(SourceId::parse(bad), None, "{bad}");
        }
        // The legacy fixed id used by the WebView2 picker is not a native source.
        assert_eq!(SourceId::parse("screen:windows-picker"), None);
    }

    #[test]
    fn handle_sign_extends_32_bit_values() {
        assert_eq!(SourceId::Screen(65537).handle(), 65537);
        assert_eq!(SourceId::Window(0xFFFF_FFFE).handle(), -2);
    }

    #[test]
    fn overlay_styles_are_excluded_and_normal_windows_are_not() {
        // WS_EX_APPWINDOW | WS_EX_WINDOWEDGE: a regular top-level window.
        assert!(!excluded_by_style(0x0004_0100));
        // WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST: a click-through overlay.
        assert!(excluded_by_style(0x0008_0000 | 0x20 | 0x8));
        // WS_EX_NOACTIVATE alone (tooltips, some floating bars).
        assert!(excluded_by_style(0x0800_0000));
        // A tool window is still shareable (picture-in-picture windows use it).
        assert!(!excluded_by_style(0x0000_0080));
    }

    #[test]
    fn minimized_windows_are_offered_but_junk_is_not() {
        // A game after alt-tab: minimized, 160x28 stub (the real values for VALORANT).
        assert!(offer_window(
            "VALORANT  ",
            "VALORANT-Win64-Shipping.exe",
            true,
            160,
            28
        ));
        assert!(offer_window("Notas", "notepad.exe", false, 800, 600));
        // Not minimized and tiny: a helper window.
        assert!(!offer_window("Bar", "x.exe", false, 30, 20));
        assert!(!offer_window("  ", "x.exe", true, 800, 600));
        assert!(!offer_window("", "x.exe", false, 800, 600));
        // Telinha never offers itself, minimized or not.
        assert!(!offer_window("Telinha", "telinha.exe", true, 160, 28));
        assert!(!offer_window("Sala", "Telinha.exe", false, 800, 600));
    }

    #[test]
    fn encode_size_never_upscales_and_stays_even() {
        assert_eq!(encode_size(1920, 1080, 1080), (1920, 1080));
        assert_eq!(encode_size(1920, 1080, 720), (1280, 720));
        assert_eq!(encode_size(1280, 720, 1440), (1280, 720));
        assert_eq!(encode_size(2560, 1440, 0), (2560, 1440));
        // 1366x768 -> 720 high: width rounds to an even number.
        let (w, h) = encode_size(1366, 768, 720);
        assert_eq!((w % 2, h % 2), (0, 0));
        assert_eq!(h, 720);
    }

    #[test]
    fn encode_size_handles_degenerate_input() {
        assert_eq!(encode_size(0, 0, 1080), (2, 2));
        assert_eq!(encode_size(1, 1, 1080), (2, 2));
    }

    #[test]
    fn letterbox_fills_when_aspect_matches() {
        assert_eq!(letterbox(1920, 1080, 1280, 720), (0, 0, 1280, 720));
    }

    #[test]
    fn letterbox_centers_narrower_content() {
        // A 4:3 window inside a 16:9 frame gets pillar bars.
        let (x, y, w, h) = letterbox(800, 600, 1280, 720);
        assert_eq!((y, h), (0, 720));
        assert_eq!(w, 960);
        assert_eq!(x, 160);
    }

    #[test]
    fn letterbox_centers_shorter_content() {
        let (x, y, w, h) = letterbox(1000, 200, 1280, 720);
        assert_eq!((x, w), (0, 1280));
        assert!(y > 0 && y % 2 == 0 && y + h <= 720);
    }

    #[test]
    fn letterbox_never_leaves_the_frame() {
        for (cw, ch) in [(1, 1), (3000, 100), (100, 3000), (1281, 721)] {
            let (x, y, w, h) = letterbox(cw, ch, 1280, 720);
            assert!(x + w <= 1280 && y + h <= 720, "{cw}x{ch}");
            assert!(w >= 2 && h >= 2, "{cw}x{ch}");
        }
    }
}
