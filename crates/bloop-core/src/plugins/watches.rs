use std::collections::HashMap;

use parking_lot::Mutex;

/// The native capabilities a plugin can subscribe to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    Media,
    Audio,
    Devices,
}

impl Capability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Media => "media",
            Self::Audio => "audio",
            Self::Devices => "devices",
        }
    }
}

/// Generic capability event subscriptions.
///
/// Plugins subscribe to a capability with an optional filter string. The
/// runtime routes typed native capability events to every plugin watching that
/// capability. A single generic mechanism replaces per-capability watch maps so
/// new capabilities do not require new plumbing.
#[derive(Default)]
pub struct WatchRegistry {
    inner: Mutex<HashMap<String, HashMap<Capability, String>>>,
}

impl WatchRegistry {
    pub fn subscribe(&self, plugin_id: &str, capability: Capability, filter: &str) {
        self.inner
            .lock()
            .entry(plugin_id.to_string())
            .or_default()
            .insert(capability, filter.to_string());
    }

    pub fn unsubscribe(&self, plugin_id: &str, capability: Capability) {
        if let Some(capabilities) = self.inner.lock().get_mut(plugin_id) {
            capabilities.remove(&capability);
        }
    }

    /// All (plugin id, filter) pairs currently watching `capability`.
    pub fn subscribers(&self, capability: Capability) -> Vec<(String, String)> {
        self.inner
            .lock()
            .iter()
            .filter_map(|(plugin_id, capabilities)| {
                capabilities
                    .get(&capability)
                    .map(|filter| (plugin_id.clone(), filter.clone()))
            })
            .collect()
    }

    pub fn drop_plugin(&self, plugin_id: &str) {
        self.inner.lock().remove(plugin_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscriptions_are_per_plugin_per_capability() {
        let registry = WatchRegistry::default();
        registry.subscribe("plugin-a", Capability::Audio, "");
        registry.subscribe("plugin-a", Capability::Media, "spotify");
        registry.subscribe("plugin-b", Capability::Audio, "");

        let audio = registry.subscribers(Capability::Audio);
        assert_eq!(audio.len(), 2);
        let media = registry.subscribers(Capability::Media);
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].1, "spotify");

        registry.unsubscribe("plugin-a", Capability::Audio);
        assert_eq!(registry.subscribers(Capability::Audio).len(), 1);

        registry.drop_plugin("plugin-b");
        assert!(registry.subscribers(Capability::Audio).is_empty());
    }

    #[test]
    fn unknown_capability_has_no_subscribers() {
        let registry = WatchRegistry::default();
        assert!(registry.subscribers(Capability::Devices).is_empty());
    }
}
