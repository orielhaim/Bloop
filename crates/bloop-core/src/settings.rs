use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub enabled_plugins: std::collections::BTreeMap<String, bool>,
    pub layout: HomeLayout,
    pub plugin_settings: std::collections::BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub idle_provider: IdleProvider,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
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
        match value {
            serde_json::Value::String(text) => Some(text.clone()),
            other => Some(other.to_string()),
        }
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
