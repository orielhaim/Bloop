use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use tauri::{Emitter, WebviewWindow};

use crate::metrics::{RESTING_HEIGHT, RESTING_WIDTH};

#[derive(Clone, Debug)]
struct PresenceHit {
    mode: String,
    width: f64,
    height: f64,
}

static PRESENCE: OnceLock<Arc<Mutex<PresenceHit>>> = OnceLock::new();

fn presence_state() -> Arc<Mutex<PresenceHit>> {
    PRESENCE
        .get_or_init(|| {
            Arc::new(Mutex::new(PresenceHit {
                mode: "resting".into(),
                width: RESTING_WIDTH,
                height: RESTING_HEIGHT,
            }))
        })
        .clone()
}

#[tauri::command]
#[specta::specta]
pub fn set_island_presence(mode: String, width: f64, height: f64) -> Result<(), String> {
    let state = presence_state();
    let mut current = state.lock().map_err(|_| "presence lock failed")?;
    current.mode = mode;
    current.width = width;
    current.height = height;
    Ok(())
}

pub fn start(window: WebviewWindow) {
    let _ = window.set_ignore_cursor_events(true);

    thread::spawn(move || {
        let mut hovering = false;
        let mut dragging = false;
        let mut left_was_down = false;
        let mut escape_was_down = false;

        loop {
            thread::sleep(Duration::from_millis(8));

            let snapshot = presence_state()
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or(PresenceHit {
                    mode: "resting".into(),
                    width: RESTING_WIDTH,
                    height: RESTING_HEIGHT,
                });

            let hit = cursor_in_hit(&window, snapshot.width, snapshot.height);

            #[cfg(windows)]
            let left_down = native::key_down(native::VK_LEFT_BUTTON);
            #[cfg(not(windows))]
            let left_down = false;

            if (!left_down) {
                dragging = false;
            } else if (hit || dragging) {
                dragging = true;
            }

            let _ = window.set_ignore_cursor_events(!(hit || dragging));

            if hit != hovering {
                hovering = hit;
                let _ = window.emit("island-pointer", hovering);
            }

            #[cfg(windows)]
            {
                let escape_down = native::key_down(native::VK_ESCAPE_KEY);
                let dismissable = snapshot.mode == "expanded" || snapshot.mode == "presentation";

                if left_down && !left_was_down && !hit && dismissable && !dragging {
                    let _ = window.emit("island-dismiss", ());
                }
                if escape_down && !escape_was_down && snapshot.mode != "resting" && !left_down {
                    let _ = window.emit("island-dismiss", ());
                }

                left_was_down = left_down;
                escape_was_down = escape_down;
            }
        }
    });
}

fn cursor_in_hit(window: &WebviewWindow, width: f64, height: f64) -> bool {
    #[cfg(windows)]
    {
        native::is_inside(window, width, height)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, width, height);
        false
    }
}

#[cfg(windows)]
mod native {
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetCursorPos};

    use crate::metrics::{WINDOW_HEIGHT, WINDOW_WIDTH};

    pub const VK_LEFT_BUTTON: i32 = VK_LBUTTON.0 as i32;
    pub const VK_ESCAPE_KEY: i32 = VK_ESCAPE.0 as i32;

    pub fn key_down(code: i32) -> bool {
        unsafe { GetAsyncKeyState(code) as u16 & 0x8000 != 0 }
    }

    pub fn is_inside(window: &WebviewWindow, hit_width: f64, hit_height: f64) -> bool {
        let Ok(raw) = window.hwnd() else {
            return false;
        };
        let hwnd = HWND(raw.0);
        let mut cursor = POINT::default();
        let mut client = RECT::default();
        let mut origin = POINT { x: 0, y: 0 };

        unsafe {
            if GetCursorPos(&mut cursor).is_err() {
                return false;
            }
            if GetClientRect(hwnd, &mut client).is_err() {
                return false;
            }
            if !ClientToScreen(hwnd, &mut origin).as_bool() {
                return false;
            }
        }

        let client_width = f64::from(client.right - client.left);
        let client_height = f64::from(client.bottom - client.top);
        let width = (client_width * hit_width / WINDOW_WIDTH).round() as i32;
        let height = (client_height * hit_height / WINDOW_HEIGHT).round() as i32;
        let offset_x = (client.right - client.left - width) / 2;
        let left = origin.x + offset_x;
        let top = origin.y;

        cursor.x >= left && cursor.x < left + width && cursor.y >= top && cursor.y < top + height
    }
}
