//! The sharer's own preview comes from the frame the encoder is given (letterboxed NV12, the same
//! picture viewers get), not from a second capture of the window. Converting it for the screen is
//! plain arithmetic, so it lives here where it can be tested without a GPU.

use image::{Rgba, RgbaImage};

/// BT.709, limited range: what the video processor writes for the encoder.
fn to_rgb(y: f32, u: f32, v: f32) -> [u8; 3] {
    let c = 1.164 * (y - 16.0);
    let (d, e) = (u - 128.0, v - 128.0);
    let channel = |value: f32| value.round().clamp(0.0, 255.0) as u8;
    [
        channel(c + 1.793 * e),
        channel(c - 0.213 * d - 0.533 * e),
        channel(c + 2.112 * d),
    ]
}

/// Converts an NV12 frame to RGBA no wider than `max_width`, averaging whole blocks of luma (so
/// small text stays readable instead of aliasing). `data` is the luma plane (`height` rows of
/// `pitch` bytes) followed by the interleaved UV plane (`height / 2` rows of `pitch` bytes).
pub fn nv12_to_rgba(
    data: &[u8],
    pitch: usize,
    width: u32,
    height: u32,
    max_width: u32,
) -> RgbaImage {
    let (width, height) = (width as usize, height as usize);
    let step = width.div_ceil(max_width.max(1) as usize).max(1);
    let (out_w, out_h) = ((width / step).max(1), (height / step).max(1));
    let uv_plane = pitch * height;
    let mut image = RgbaImage::new(out_w as u32, out_h as u32);
    for oy in 0..out_h {
        for ox in 0..out_w {
            let (x0, y0) = (ox * step, oy * step);
            let (mut sum, mut count) = (0u32, 0u32);
            for y in y0..(y0 + step).min(height) {
                for x in x0..(x0 + step).min(width) {
                    sum += u32::from(data[y * pitch + x]);
                    count += 1;
                }
            }
            let luma = sum as f32 / count.max(1) as f32;
            // Chroma is shared by 2x2 pixels; take it from the middle of the block.
            let (cx, cy) = (
                ((x0 + step / 2).min(width - 1)) / 2,
                ((y0 + step / 2).min(height - 1)) / 2,
            );
            let at = uv_plane + cy * pitch + cx * 2;
            let (u, v) = (f32::from(data[at]), f32::from(data[at + 1]));
            let [r, g, b] = to_rgb(luma, u, v);
            image.put_pixel(ox as u32, oy as u32, Rgba([r, g, b, 255]));
        }
    }
    image
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4x4 frame of one flat color: luma `y` everywhere, chroma (`u`, `v`).
    fn flat(y: u8, u: u8, v: u8) -> Vec<u8> {
        let mut data = vec![y; 4 * 4];
        for _ in 0..2 * 2 {
            data.extend_from_slice(&[u, v]);
        }
        data
    }

    #[test]
    fn limited_range_black_and_white() {
        let black = nv12_to_rgba(&flat(16, 128, 128), 4, 4, 4, 960);
        assert_eq!(black.get_pixel(0, 0).0, [0, 0, 0, 255]);
        let white = nv12_to_rgba(&flat(235, 128, 128), 4, 4, 4, 960);
        assert_eq!(white.get_pixel(3, 3).0, [255, 255, 255, 255]);
    }

    #[test]
    fn chroma_gives_the_right_hue() {
        // BT.709 limited-range red and blue.
        let red = nv12_to_rgba(&flat(63, 102, 240), 4, 4, 4, 960);
        let [r, g, b, _] = red.get_pixel(1, 1).0;
        assert!(r > 240 && g < 20 && b < 20, "red came out {r},{g},{b}");
        let blue = nv12_to_rgba(&flat(32, 240, 118), 4, 4, 4, 960);
        let [r, g, b, _] = blue.get_pixel(2, 2).0;
        assert!(b > 240 && r < 20 && g < 40, "blue came out {r},{g},{b}");
    }

    #[test]
    fn shrinks_by_whole_steps_to_fit_the_width() {
        // 8 wide with a 4 limit -> step 2 -> 4x2 (height 4).
        let mut data = vec![128u8; 8 * 4];
        data.extend(std::iter::repeat_n(128u8, 8 * 2));
        let image = nv12_to_rgba(&data, 8, 8, 4, 4);
        assert_eq!(image.dimensions(), (4, 2));
    }

    #[test]
    fn a_pitch_wider_than_the_frame_is_skipped_over() {
        // Width 2, pitch 4: the two padding bytes per row must not leak into the picture.
        let mut data = vec![0u8; 4 * 2];
        data[0] = 235;
        data[1] = 235;
        data[4] = 235;
        data[5] = 235;
        data[2] = 16;
        data[3] = 16;
        data.extend_from_slice(&[128, 128, 0, 0]);
        let image = nv12_to_rgba(&data, 4, 2, 2, 960);
        assert_eq!(image.dimensions(), (2, 2));
        assert_eq!(image.get_pixel(1, 0).0, [255, 255, 255, 255]);
    }

    #[test]
    fn averages_luma_inside_a_block() {
        // Step 2: pixels 16 and 235 average to ~126, not either extreme.
        let mut data = vec![16u8, 235, 16, 235, 16, 235, 16, 235];
        data.extend_from_slice(&[128, 128, 128, 128]);
        let image = nv12_to_rgba(&data, 4, 4, 2, 2);
        assert_eq!(image.dimensions(), (2, 1));
        let [r, ..] = image.get_pixel(0, 0).0;
        assert!((110..150).contains(&r), "got {r}");
    }
}
