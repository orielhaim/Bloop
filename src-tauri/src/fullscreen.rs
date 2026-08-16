use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;

static HIDDEN: AtomicBool = AtomicBool::new(false);

pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("bloop-fullscreen".into())
        .spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(400));
                let Some(state) = app.try_state::<AppState>() else {
                    continue;
                };
                if !state.engine.settings.get().hide_on_fullscreen {
                    reveal(&app);
                    continue;
                }
                let fullscreen = is_foreground_fullscreen();
                let was_hidden = HIDDEN.load(Ordering::Relaxed);
                if fullscreen && !was_hidden {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    HIDDEN.store(true, Ordering::Relaxed);
                    let _ = app.emit(
                        "engine-event",
                        serde_json::json!({"type":"fullscreenChanged","hidden":true}),
                    );
                } else if !fullscreen && was_hidden {
                    if state.engine.settings.get().island_enabled {
                        reveal(&app);
                    }
                }
            }
        })
        .ok();
}

fn reveal(app: &AppHandle) {
    if !HIDDEN.swap(false, Ordering::Relaxed) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
    }
}

fn is_foreground_fullscreen() -> bool {
    #[cfg(windows)]
    {
        native::foreground_is_fullscreen()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
mod native {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetForegroundWindow, GetWindowLongW, GetWindowRect, WS_CAPTION, WS_THICKFRAME,
    };

    pub fn foreground_is_fullscreen() -> bool {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return false;
            }
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            if style & (WS_CAPTION.0 | WS_THICKFRAME.0) != 0 {
                return false;
            }
            let mut window = RECT::default();
            if GetWindowRect(hwnd, &mut window).is_err() {
                return false;
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return false;
            }
            window.left <= info.rcMonitor.left
                && window.top <= info.rcMonitor.top
                && window.right >= info.rcMonitor.right
                && window.bottom >= info.rcMonitor.bottom
        }
    }
}
