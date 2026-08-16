use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?surface=settings".into()),
    )
    .title("bloop")
    .inner_size(820.0, 620.0)
    .resizable(true)
    .maximizable(true)
    .decorations(true)
    .transparent(false)
    .skip_taskbar(false)
    .visible(true)
    .build();
}
