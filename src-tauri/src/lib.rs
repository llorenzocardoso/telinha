mod audio;
mod capture;
mod discord;
mod gpu;

#[cfg(windows)]
mod webview_permissions;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[tauri::command]
fn copy_to_clipboard(text: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    capture::stop_share_capture();
    app.exit(0);
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum TrayEntry {
    StartLive,
    StopLive,
    CopyLink,
    CopyCode,
    Separator,
    Show,
    Quit,
}

impl TrayEntry {
    fn id_and_label(self) -> Option<(&'static str, &'static str)> {
        match self {
            TrayEntry::StartLive => Some(("start-live", "Iniciar live")),
            TrayEntry::StopLive => Some(("stop-live", "Parar live")),
            TrayEntry::CopyLink => Some(("copy-link", "Copiar link")),
            TrayEntry::CopyCode => Some(("copy-code", "Copiar código")),
            TrayEntry::Show => Some(("show", "Mostrar Telinha")),
            TrayEntry::Quit => Some(("quit", "Sair")),
            TrayEntry::Separator => None,
        }
    }
}

fn tray_layout(room_active: bool, sharing: bool) -> Vec<TrayEntry> {
    let mut entries = vec![if sharing {
        TrayEntry::StopLive
    } else {
        TrayEntry::StartLive
    }];
    if room_active || sharing {
        entries.push(TrayEntry::CopyLink);
        entries.push(TrayEntry::CopyCode);
    }
    entries.extend([TrayEntry::Separator, TrayEntry::Show, TrayEntry::Quit]);
    entries
}

fn build_tray_menu(
    app: &tauri::AppHandle,
    room_active: bool,
    sharing: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for entry in tray_layout(room_active, sharing) {
        match entry.id_and_label() {
            Some((id, label)) => {
                menu.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?
            }
            None => menu.append(&PredefinedMenuItem::separator(app)?)?,
        }
    }
    Ok(menu)
}

#[tauri::command]
fn set_tray_state(app: tauri::AppHandle, room_active: bool, sharing: bool) -> Result<(), String> {
    let menu = build_tray_menu(&app, room_active, sharing).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("telinha") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let urls: Vec<String> = argv
                .into_iter()
                .filter(|arg| arg.starts_with("telinha:"))
                .collect();
            if !urls.is_empty() {
                let _ = app.emit("telinha-open-url", urls);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("toggle-share", ());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            copy_to_clipboard,
            set_tray_state,
            show_main_window,
            hide_main_window,
            quit_app,
            discord::set_discord_presence,
            capture::list_share_sources,
            capture::resolve_share_source,
            gpu::gpu_encode_info,
            capture::start_share_capture,
            capture::read_share_frame,
            audio::read_share_audio,
            capture::stop_share_capture,
            capture::set_window_layout
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("window-close-requested", ());
            }
        })
        .setup(|app| {
            let menu = build_tray_menu(app.handle(), false, false)?;

            let _tray = TrayIconBuilder::with_id("telinha")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Telinha")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = app.emit("app-quit-requested", ());
                    }
                    "start-live" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray-start-live", ());
                    }
                    "stop-live" => {
                        let _ = app.emit("tray-stop-live", ());
                    }
                    "copy-link" => {
                        let _ = app.emit("tray-copy-link", ());
                    }
                    "copy-code" => {
                        let _ = app.emit("tray-copy-code", ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);
            let _ = app.global_shortcut().register(shortcut);

            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> =
                        event.urls().iter().map(|url| url.to_string()).collect();
                    let _ = handle.emit("telinha-open-url", urls);
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
                #[cfg(debug_assertions)]
                {
                    let _ = app.deep_link().register_all();
                }
            }

            discord::start_presence_loop();

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                {
                    let _ = window.with_webview(|webview| {
                        webview_permissions::allow_media_capture(&webview);
                    });
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use TrayEntry::*;

    #[test]
    fn menu_without_room_has_only_start_live() {
        assert_eq!(
            tray_layout(false, false),
            vec![StartLive, Separator, Show, Quit]
        );
    }

    #[test]
    fn menu_with_room_offers_start_and_copy() {
        assert_eq!(
            tray_layout(true, false),
            vec![StartLive, CopyLink, CopyCode, Separator, Show, Quit]
        );
    }

    #[test]
    fn menu_while_sharing_offers_stop_instead_of_start() {
        assert_eq!(
            tray_layout(true, true),
            vec![StopLive, CopyLink, CopyCode, Separator, Show, Quit]
        );
    }
}
