//! A tiny window owned by the test itself, so capture tests never touch the user's programs.
//! It repaints a moving color so Windows Graphics Capture keeps delivering frames.

use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, InvalidateRect, PAINTSTRUCT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW, MoveWindow,
    PostMessageW, PostQuitMessage, RegisterClassW, SetTimer, ShowWindow, TranslateMessage,
    CS_HREDRAW, CS_VREDRAW, MSG, SW_MINIMIZE, SW_RESTORE, SW_SHOWNOACTIVATE, WM_CLOSE, WM_DESTROY,
    WM_PAINT, WM_TIMER, WNDCLASSW, WS_OVERLAPPEDWINDOW,
};

pub struct TestWindow {
    raw: isize,
    thread: Option<JoinHandle<()>>,
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_TIMER => {
            let _ = unsafe { InvalidateRect(Some(hwnd), None, false) };
            LRESULT(0)
        }
        WM_PAINT => {
            let millis = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u32);
            let color = COLORREF(
                (millis / 8 % 256) | ((millis / 13 % 256) << 8) | ((millis / 21 % 256) << 16),
            );
            let mut paint = PAINTSTRUCT::default();
            let hdc = unsafe { BeginPaint(hwnd, &mut paint) };
            let mut rect = RECT::default();
            let _ = unsafe { GetClientRect(hwnd, &mut rect) };
            let brush = unsafe { CreateSolidBrush(color) };
            unsafe {
                FillRect(hdc, &rect, brush);
                let _ = DeleteObject(brush.into());
                let _ = EndPaint(hwnd, &paint);
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

impl TestWindow {
    pub fn open(width: i32, height: i32) -> Self {
        let (sender, receiver) = mpsc::channel::<isize>();
        let thread = std::thread::spawn(move || unsafe {
            let instance = GetModuleHandleW(None).expect("module handle");
            let class = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(window_proc),
                hInstance: instance.into(),
                lpszClassName: w!("NativeShareTestWindow"),
                ..Default::default()
            };
            // Already registered by an earlier test in this process: fine.
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                Default::default(),
                w!("NativeShareTestWindow"),
                PCWSTR(w!("Native share test window").as_ptr()),
                WS_OVERLAPPEDWINDOW,
                120,
                120,
                width,
                height,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .expect("test window");
            SetTimer(Some(hwnd), 1, 30, None);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            sender.send(hwnd.0 as isize).expect("hwnd");
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        });
        let raw = receiver.recv().expect("window handle");
        // Give the compositor a moment to show it before capture starts.
        std::thread::sleep(std::time::Duration::from_millis(400));
        Self {
            raw,
            thread: Some(thread),
        }
    }

    /// `window:<HWND>`, the same id format the app lists.
    pub fn id(&self) -> String {
        format!("window:{}", self.raw as usize as u32)
    }

    /// A handle that can be used from another thread to resize or close the window.
    pub fn remote(&self) -> Remote {
        Remote(self.raw)
    }
}

#[derive(Clone, Copy)]
pub struct Remote(isize);

impl Remote {
    fn hwnd(self) -> HWND {
        HWND(self.0 as *mut _)
    }

    pub fn resize(self, width: i32, height: i32) {
        let _ = unsafe { MoveWindow(self.hwnd(), 120, 120, width, height, true) };
    }

    /// Minimizes it the way alt-tabbing out of a fullscreen game does.
    pub fn minimize(self) {
        let _ = unsafe { ShowWindow(self.hwnd(), SW_MINIMIZE) };
    }

    pub fn restore(self) {
        let _ = unsafe { ShowWindow(self.hwnd(), SW_RESTORE) };
    }

    pub fn close(self) {
        let _ = unsafe { PostMessageW(Some(self.hwnd()), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    }
}

impl Drop for TestWindow {
    fn drop(&mut self) {
        self.remote().close();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
