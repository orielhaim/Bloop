use std::path::PathBuf;
use std::sync::Arc;

use bloop_core::{
    AppSettings, Engine, EngineEvent, HomeLayout, IslandState, ThemeDocument, data_url,
};
use tauri::{AppHandle, Manager, State};

use crate::windowing;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

pub struct AppState {
    pub engine: Arc<Engine>,
    #[allow(dead_code)]
    pub event_subscription: bloop_core::events::Subscription,
}

fn map_err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
#[specta::specta]
pub fn island_state(state: State<AppState>) -> IslandState {
    state.engine.island_state()
}

#[tauri::command]
#[specta::specta]
pub fn island_open(state: State<AppState>) -> IslandState {
    state.engine.activities.open_home();
    state.engine.island_state()
}

#[tauri::command]
#[specta::specta]
pub fn island_collapse(state: State<AppState>) -> IslandState {
    state.engine.activities.collapse();
    state.engine.island_state()
}

#[tauri::command]
#[specta::specta]
pub fn activity_action(
    state: State<AppState>,
    plugin_id: String,
    action_id: String,
    payload: Option<String>,
) -> Result<(), String> {
    state
        .engine
        .plugins
        .dispatch_action(&plugin_id, &action_id, payload.as_deref().unwrap_or(""))
        .map_err(map_err)
}

#[tauri::command]
#[specta::specta]
pub fn get_settings(state: State<AppState>) -> AppSettings {
    state.engine.settings.get()
}

#[tauri::command]
#[specta::specta]
pub fn set_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    state.engine.settings.replace(settings.clone());
    persist_settings(&app, &settings)?;
    apply_runtime(&app, &settings);
    if let Err(error) = state.engine.themes.apply(&settings.theme_id) {
        tracing::warn!(%error, "theme apply failed");
    }
    for plugin_id in settings.plugin_settings.keys() {
        state.engine.plugins.notify_settings(plugin_id);
    }
    state.engine.events.emit(EngineEvent::SettingsChanged);
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
pub fn set_layout(
    app: AppHandle,
    state: State<AppState>,
    layout: HomeLayout,
) -> Result<HomeLayout, String> {
    let settings = state.engine.settings.update(|current| {
        current.layout = layout.clone();
    });
    persist_settings(&app, &settings)?;
    state.engine.events.emit(EngineEvent::LayoutChanged);
    Ok(settings.layout)
}

#[tauri::command]
#[specta::specta]
pub fn list_plugins(state: State<AppState>) -> Vec<bloop_core::PluginRecord> {
    state.engine.plugins.list()
}

#[tauri::command]
#[specta::specta]
pub fn enable_plugin(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<bloop_core::PluginRecord, String> {
    let record = state.engine.plugins.enable(&id).map_err(map_err)?;
    persist_settings(&app, &state.engine.settings.get())?;
    Ok(record)
}

#[tauri::command]
#[specta::specta]
pub fn disable_plugin(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<bloop_core::PluginRecord, String> {
    let record = state.engine.plugins.disable(&id).map_err(map_err)?;
    persist_settings(&app, &state.engine.settings.get())?;
    Ok(record)
}

#[tauri::command]
#[specta::specta]
pub fn reload_plugin(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<bloop_core::PluginRecord, String> {
    let record = state.engine.plugins.reload(&id).map_err(map_err)?;
    persist_settings(&app, &state.engine.settings.get())?;
    Ok(record)
}

#[tauri::command]
#[specta::specta]
pub fn uninstall_plugin(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    state.engine.plugins.uninstall(&id).map_err(map_err)?;
    persist_settings(&app, &state.engine.settings.get())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn dismiss_activity(state: State<AppState>, activity_id: String) -> IslandState {
    state.engine.activities.dismiss(&activity_id);
    state.engine.island_state()
}

#[tauri::command]
#[specta::specta]
pub fn list_themes(state: State<AppState>) -> Vec<ThemeDocument> {
    state.engine.themes.list()
}

#[tauri::command]
#[specta::specta]
pub fn current_theme(state: State<AppState>) -> ThemeDocument {
    state.engine.themes.current()
}

#[tauri::command]
#[specta::specta]
pub fn apply_theme(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<ThemeDocument, String> {
    let theme = state.engine.themes.apply(&id).map_err(map_err)?;
    let settings = state.engine.settings.update(|current| {
        current.theme_id = id.clone();
    });
    persist_settings(&app, &settings)?;
    state.engine.events.emit(EngineEvent::ThemeChanged {
        id: theme.id.clone(),
    });
    Ok(theme)
}

#[tauri::command]
#[specta::specta]
pub fn media_artwork(state: State<AppState>, session_id: String) -> Option<String> {
    let id = session_id.split("::").next().unwrap_or(session_id.as_str());
    state
        .engine
        .media
        .artwork(id)
        .map(|bytes| data_url("image/jpeg", &bytes))
}

#[tauri::command]
#[specta::specta]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "island window missing".to_string())?;
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| windowing::monitor_id(&monitor));
    let mut monitors = Vec::new();
    for monitor in window.available_monitors().map_err(map_err)? {
        let id = windowing::monitor_id(&monitor);
        monitors.push(MonitorInfo {
            primary: primary.as_ref() == Some(&id),
            name: monitor
                .name()
                .map(ToString::to_string)
                .unwrap_or_else(|| "Display".into()),
            id,
        });
    }
    Ok(monitors)
}

#[tauri::command]
#[specta::specta]
pub fn check_updates() -> UpdateStatus {
    UpdateStatus {
        available: false,
        version: None,
        message: "Updater endpoints are not configured for this build.".into(),
    }
}

#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub primary: bool,
}

pub fn apply_runtime(app: &AppHandle, settings: &AppSettings) {
    let autostart = app.autolaunch();
    let _ = if settings.autostart {
        autostart.enable()
    } else {
        autostart.disable()
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = windowing::apply_monitor(&window, &settings.monitor);
        let _ = if settings.island_enabled {
            window.show()
        } else {
            window.hide()
        };
    }
}

pub fn persist_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store = app.store("bloop.json").map_err(map_err)?;
    store.set("settings", serde_json::to_value(settings).map_err(map_err)?);
    store.save().map_err(map_err)
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    if let Ok(store) = app.store("bloop.json")
        && let Some(value) = store.get("settings")
        && let Ok(settings) = serde_json::from_value(value)
    {
        return settings;
    }
    let Ok(path) = settings_path(app) else {
        return AppSettings::default();
    };
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(map_err)?
        .join("settings.json"))
}

pub fn plugin_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir.join("plugins"));
    }
    if let Ok(dir) = app.path().app_data_dir() {
        roots.push(dir.join("plugins"));
    }
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    roots.push(workspace.join("plugins"));
    roots.push(workspace.join("target/debug/plugins"));
    roots.push(workspace.join("target/release/plugins"));
    roots.retain(|root| root.is_dir());
    roots
}
