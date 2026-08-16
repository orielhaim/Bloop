use std::collections::HashMap;

use parking_lot::Mutex;

/// Generic capability event subscriptions.
///
/// Plugins subscribe to a topic (media, audio, devices) with an optional filter
/// string. The runtime routes native capability events to every plugin watching
/// that topic. A single generic mechanism replaces per-capability watch maps so
/// new capabilities do not require new plumbing.
#[derive(Default)]
pub struct WatchRegistry {
    inner: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl WatchRegistry {
    pub fn subscribe(&self, plugin_id: &str, topic: &str, filter: &str) {
        self.inner
            .lock()
            .entry(plugin_id.to_string())
            .or_default()
            .insert(topic.to_string(), filter.to_string());
    }

    pub fn unsubscribe(&self, plugin_id: &str, topic: &str) {
        if let Some(topics) = self.inner.lock().get_mut(plugin_id) {
            topics.remove(topic);
        }
    }

    /// All (plugin id, filter) pairs currently watching `topic`.
    pub fn subscribers(&self, topic: &str) -> Vec<(String, String)> {
        self.inner
            .lock()
            .iter()
            .filter_map(|(plugin_id, topics)| {
                topics
                    .get(topic)
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
    fn subscriptions_are_per_plugin_per_topic() {
        let registry = WatchRegistry::default();
        registry.subscribe("plugin-a", "audio", "");
        registry.subscribe("plugin-a", "media", "spotify");
        registry.subscribe("plugin-b", "audio", "");

        let audio = registry.subscribers("audio");
        assert_eq!(audio.len(), 2);
        let media = registry.subscribers("media");
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].1, "spotify");

        registry.unsubscribe("plugin-a", "audio");
        assert_eq!(registry.subscribers("audio").len(), 1);

        registry.drop_plugin("plugin-b");
        assert!(registry.subscribers("audio").is_empty());
    }

    #[test]
    fn unknown_topic_has_no_subscribers() {
        let registry = WatchRegistry::default();
        assert!(registry.subscribers("devices").is_empty());
    }
}
