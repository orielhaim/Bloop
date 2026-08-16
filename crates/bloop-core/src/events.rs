use serde::{Deserialize, Serialize};

use crate::activity::ActivitySnapshot;
use crate::plugins::PluginRecord;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    PluginLoaded { plugin: PluginRecord },
    PluginUnloaded { id: String },
    PluginError { id: String, message: String },
    ActivityPublished { snapshot: ActivitySnapshot },
    ActivityUpdated { snapshot: ActivitySnapshot },
    ActivityDismissed { activity_id: String },
    ThemeChanged { id: String },
    SettingsChanged,
    DisplayChanged,
    FullscreenChanged { hidden: bool },
    LayoutChanged,
    PresenceChanged,
}

#[derive(Default)]
pub struct EventBus {
    listeners: parking_lot::RwLock<Vec<Box<dyn Fn(EngineEvent) + Send + Sync>>>,
}

impl EventBus {
    pub fn subscribe(&self, listener: impl Fn(EngineEvent) + Send + Sync + 'static) {
        self.listeners.write().push(Box::new(listener));
    }

    pub fn emit(&self, event: EngineEvent) {
        for listener in self.listeners.read().iter() {
            listener(event.clone());
        }
    }
}
