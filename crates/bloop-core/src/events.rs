use serde::{Deserialize, Serialize};

use crate::activity::ActivitySnapshot;
use crate::plugins::PluginRecord;

pub mod signal;
pub use signal::{Signal, Subscription};

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

/// The engine-wide event bus, backed by [`Signal`].
#[derive(Default)]
pub struct EventBus {
    signal: Signal<EngineEvent>,
}

impl EventBus {
    /// Subscribe to engine events. The returned subscription unsubscribes on
    /// drop; hold it for as long as the listener should receive events.
    pub fn subscribe(
        &self,
        listener: impl Fn(&EngineEvent) + Send + Sync + 'static,
    ) -> Subscription {
        self.signal.subscribe(listener)
    }

    pub fn emit(&self, event: EngineEvent) {
        self.signal.emit(&event);
    }
}
