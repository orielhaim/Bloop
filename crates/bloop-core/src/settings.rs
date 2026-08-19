use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

/// An arbitrary JSON value with a TS-safe number representation (f64). Used for
/// plugin settings so the typed bridge exports `Record<string, JsonValue>`
/// instead of BigInt-incompatible `serde_json::Value`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

impl JsonValue {
    /// Render a setting for `get_setting` the way serde_json::Value did:
    /// strings return their raw text, scalars their display form, and composite
    /// values their compact JSON.
    pub fn setting_string(&self) -> String {
        match self {
            Self::Null => "null".into(),
            Self::Bool(value) => value.to_string(),
            Self::Number(value) => value.to_string(),
            Self::String(value) => value.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub enum CompositionPreference {
    /// The engine decides how much information to show automatically.
    #[default]
    Auto,
    /// Prefer less information: strong width pressure, few segments.
    Minimal,
    /// Prefer more information: relaxed width pressure, richer variants.
    Rich,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub island_enabled: bool,
    pub autostart: bool,
    pub monitor: MonitorPreference,
    pub hide_on_fullscreen: bool,
    pub theme_id: String,
    pub hover_open_ms: u32,
    pub hover_close_ms: u32,
    pub reduced_motion: Option<bool>,
    pub enabled_plugins: BTreeMap<String, bool>,
    pub layout: HomeLayout,
    pub plugin_settings: BTreeMap<String, BTreeMap<String, JsonValue>>,
    #[serde(default)]
    pub idle_provider: IdleProvider,
    #[serde(default)]
    pub composition: CompositionPreference,
    #[serde(default)]
    pub clock: ClockSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum MonitorPreference {
    Primary,
    Selected { id: String },
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            island_enabled: true,
            autostart: false,
            monitor: MonitorPreference::Primary,
            hide_on_fullscreen: true,
            theme_id: "bloop.theme.obsidian".into(),
            hover_open_ms: 100,
            hover_close_ms: 240,
            reduced_motion: None,
            enabled_plugins: std::collections::BTreeMap::new(),
            layout: HomeLayout::default(),
            plugin_settings: std::collections::BTreeMap::new(),
            idle_provider: IdleProvider::default(),
            composition: CompositionPreference::default(),
            clock: ClockSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum ClockMotion {
    Tick,
    Smooth,
}

impl Default for ClockMotion {
    fn default() -> Self {
        Self::Tick
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClockSettings {
    #[serde(default = "clock_seconds_default")]
    pub show_seconds: bool,
    #[serde(default)]
    pub motion: ClockMotion,
}

fn clock_seconds_default() -> bool {
    true
}

impl Default for ClockSettings {
    fn default() -> Self {
        Self {
            show_seconds: true,
            motion: ClockMotion::Tick,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IdleProvider {
    Clock,
    None,
    Media,
    Plugin { id: String },
}

impl Default for IdleProvider {
    fn default() -> Self {
        Self::Clock
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub struct HomeLayout {
    pub items: Vec<String>,
}

pub struct SettingsService {
    inner: parking_lot::Mutex<AppSettings>,
}

impl SettingsService {
    pub fn new(settings: AppSettings) -> Self {
        Self {
            inner: parking_lot::Mutex::new(settings),
        }
    }

    pub fn get(&self) -> AppSettings {
        self.inner.lock().clone()
    }

    pub fn replace(&self, settings: AppSettings) {
        *self.inner.lock() = settings;
    }

    pub fn update(&self, mutate: impl FnOnce(&mut AppSettings)) -> AppSettings {
        let mut guard = self.inner.lock();
        mutate(&mut guard);
        guard.clone()
    }

    pub fn plugin_setting(&self, plugin_id: &str, key: &str) -> Option<String> {
        let settings = self.inner.lock();
        let value = settings.plugin_settings.get(plugin_id)?.get(key)?;
        Some(value.setting_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, IdleProvider};

    #[test]
    fn idle_provider_defaults_when_missing() {
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value.as_object_mut().unwrap().remove("idleProvider");
        let settings: AppSettings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.idle_provider, IdleProvider::Clock);
    }
}
