use tauri::{
    AppHandle, Manager,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt;

use crate::commands::{AppState, persist_settings};
use crate::settings_window;

pub fn attach(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let enabled = app
        .try_state::<AppState>()
        .map(|state| state.engine.settings.get().island_enabled)
        .unwrap_or(true);
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let toggle =
        CheckMenuItem::with_id(app, "toggle", "Enable Island", true, enabled, None::<&str>)?;
    let start = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        autostart,
        None::<&str>,
    )?;
    let updates = MenuItem::with_id(app, "updates", "Check for Updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &start,
            &updates,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("bloop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_island(app),
            "settings" => settings_window::show(app),
            "toggle" => toggle_island(app),
            "autostart" => toggle_autostart(app),
            "updates" => settings_window::show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                settings_window::show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

fn open_island(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    state.engine.activities.open_home();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
    }
}

fn toggle_island(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let mut settings = state.engine.settings.get();
    settings.island_enabled = !settings.island_enabled;
    state.engine.settings.replace(settings.clone());
    let _ = persist_settings(app, &settings);
    if let Some(window) = app.get_webview_window("main") {
        let _ = if settings.island_enabled {
            window.show()
        } else {
            window.hide()
        };
    }
}

fn toggle_autostart(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let mut settings = state.engine.settings.get();
    settings.autostart = !settings.autostart;
    state.engine.settings.replace(settings.clone());
    let _ = persist_settings(app, &settings);
    let autostart = app.autolaunch();
    let _ = if settings.autostart {
        autostart.enable()
    } else {
        autostart.disable()
    };
}
