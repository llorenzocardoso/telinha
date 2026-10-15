//! Application icons for the source picker (Windows only).
//!
//! The icon is the executable's, drawn at 32x32 over the picker card's background color, so the
//! result is a plain opaque PNG and needs no alpha handling.

use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};
use std::ffi::c_void;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON};

const SIZE: i32 = 32;
/// The picker card's background (`--surface-2`), as RGB.
const BACKGROUND: [u8; 3] = [0x1a, 0x1a, 0x1d];

/// The full path of the executable behind a process, as a NUL-terminated UTF-16 string.
fn executable_path(pid: u32) -> Result<Vec<u16>, String> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .map_err(|e| e.to_string())?;
    let mut buffer = vec![0u16; 1024];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    result.map_err(|e| e.to_string())?;
    buffer.truncate(length as usize);
    buffer.push(0);
    Ok(buffer)
}

/// Draws an icon onto the card background and returns the RGBA pixels (always opaque).
fn render(icon: HICON) -> Result<Vec<u8>, String> {
    unsafe {
        let dc = CreateCompatibleDC(None);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIZE,
                // Negative: rows run top to bottom.
                biHeight: -SIZE,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let bitmap = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => bitmap,
            Err(error) => {
                let _ = DeleteDC(dc);
                return Err(error.to_string());
            }
        };
        let previous = SelectObject(dc, bitmap.into());
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, (SIZE * SIZE * 4) as usize);
        for pixel in pixels.as_chunks_mut::<4>().0 {
            *pixel = [BACKGROUND[2], BACKGROUND[1], BACKGROUND[0], 0xff];
        }
        let drawn = DrawIconEx(dc, 0, 0, icon, SIZE, SIZE, 0, None, DI_NORMAL);
        let rgba = pixels
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|bgra| [bgra[2], bgra[1], bgra[0], 0xff])
            .collect();
        SelectObject(dc, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(dc);
        drawn.map_err(|e| e.to_string())?;
        Ok(rgba)
    }
}

/// A PNG of the icon of the program that owns `pid`.
pub fn icon_png(pid: u32) -> Result<Vec<u8>, String> {
    let path = executable_path(pid)?;
    let mut info = SHFILEINFOW::default();
    let found = unsafe {
        SHGetFileInfoW(
            PCWSTR(path.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if found == 0 || info.hIcon.is_invalid() {
        return Err("O programa não tem ícone".into());
    }
    let rgba = render(info.hIcon);
    let _ = unsafe { DestroyIcon(info.hIcon) };

    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(&rgba?, SIZE as u32, SIZE as u32, ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(png)
}
