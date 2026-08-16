use bloop_core::MonitorPreference;
use tauri::{LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::hover;
use crate::metrics::{WINDOW_HEIGHT, WINDOW_WIDTH};

pub fn configure_island_window(
    window: &WebviewWindow,
    preference: &MonitorPreference,
) -> tauri::Result<()> {
    let _ = window.set_shadow(false);
    let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    window.set_size(LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT))?;

    #[cfg(windows)]
    windows_overlay::prepare(window);

    apply_monitor(window, preference)?;
    window.set_always_on_top(true)?;
    window.show()?;

    hover::start(window.clone());

    Ok(())
}

pub fn monitor_id(monitor: &Monitor) -> String {
    let name = monitor.name().map_or("display", |value| value.as_str());
    let size = monitor.size();
    format!("{name}:{}x{}", size.width, size.height)
}

fn monitor_matches(monitor: &Monitor, id: &str) -> bool {
    monitor_id(monitor) == id || format!("{}x{}", monitor.position().x, monitor.position().y) == id
}

pub fn apply_monitor(window: &WebviewWindow, preference: &MonitorPreference) -> tauri::Result<()> {
    let monitors = window.available_monitors()?;
    let selected = match preference {
        MonitorPreference::Primary => window.primary_monitor()?.or(window.current_monitor()?),
        MonitorPreference::Selected { id } => monitors
            .into_iter()
            .find(|monitor| monitor_matches(monitor, id))
            .or(window.primary_monitor()?)
            .or(window.current_monitor()?),
    }
    .ok_or_else(|| tauri::Error::WindowNotFound)?;

    snap_to_monitor_top(window, selected.position(), selected.size())?;

    #[cfg(windows)]
    windows_overlay::snap_client_flush(window, selected.position(), selected.size());
    #[cfg(windows)]
    windows_overlay::assert_topmost(window);
    Ok(())
}

fn snap_to_monitor_top(
    window: &WebviewWindow,
    monitor_pos: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> tauri::Result<()> {
    let inner_size = window.inner_size()?;
    let x = monitor_pos.x + (monitor_size.width as i32 - inner_size.width as i32) / 2;
    window.set_position(PhysicalPosition::new(x, monitor_pos.y))?;
    Ok(())
}

pub fn main_window(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    app.get_webview_window("main")
        .ok_or_else(|| tauri::Error::WindowNotFound)
}

#[cfg(windows)]
mod windows_overlay {
    use std::mem::size_of_val;
    use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Dwm::{
        DWMWA_TRANSITIONS_FORCEDISABLED, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute,
    };
    use windows::Win32::Graphics::Gdi::{ClientToScreen, SetWindowRgn};
    use windows::Win32::UI::Controls::MARGINS;
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetWindowLongPtrW, GetWindowRect, HWND_TOPMOST, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SetWindowLongPtrW, SetWindowPos,
        WS_CAPTION, WS_THICKFRAME,
    };

    fn hwnd(window: &WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|handle| HWND(handle.0))
    }

    pub fn prepare(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else {
            return;
        };
        let disable_transitions = 1i32;
        let corner = DWMWCP_DONOTROUND;
        let margins = MARGINS {
            cxLeftWidth: 0,
            cxRightWidth: 0,
            cyTopHeight: 0,
            cyBottomHeight: 0,
        };

        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            let _ = SetWindowLongPtrW(
                hwnd,
                GWL_STYLE,
                style & !(WS_CAPTION.0 as isize | WS_THICKFRAME.0 as isize),
            );
            let _ = SetWindowRgn(HWND(hwnd.0), None, true);
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                std::ptr::from_ref(&corner).cast(),
                size_of_val(&corner) as u32,
            );
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                std::ptr::from_ref(&disable_transitions).cast(),
                size_of_val(&disable_transitions) as u32,
            );
            let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            );
        }
    }

    pub fn snap_client_flush(
        window: &WebviewWindow,
        monitor_pos: &PhysicalPosition<i32>,
        monitor_size: &PhysicalSize<u32>,
    ) {
        let Some(hwnd) = hwnd(window) else {
            return;
        };
        let Ok(inner_size) = window.inner_size() else {
            return;
        };

        for _ in 0..6 {
            let mut window_rect = RECT::default();
            let mut client_origin = POINT { x: 0, y: 0 };

            unsafe {
                if GetWindowRect(hwnd, &mut window_rect).is_err() {
                    return;
                }
                if !ClientToScreen(hwnd, &mut client_origin).as_bool() {
                    return;
                }
            }

            let target_x =
                monitor_pos.x + (monitor_size.width as i32 - inner_size.width as i32) / 2;
            let dx = client_origin.x - target_x;
            let dy = client_origin.y - monitor_pos.y;

            if dx == 0 && dy == 0 {
                break;
            }

            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    window_rect.left - dx,
                    window_rect.top - dy,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    }

    pub fn assert_topmost(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else {
            return;
        };
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
}
