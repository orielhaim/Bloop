use serde::{Deserialize, Serialize};

use super::ui::UiNode;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    Background = 0,
    Ambient = 20,
    Standard = 40,
    Attention = 70,
    Critical = 90,
}

impl Default for Priority {
    fn default() -> Self {
        Self::Standard
    }
}

impl Priority {
    pub fn from_u8(value: u8) -> Self {
        match value {
            0..=19 => Self::Background,
            20..=39 => Self::Ambient,
            40..=69 => Self::Standard,
            70..=89 => Self::Attention,
            _ => Self::Critical,
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PresentationMode {
    Compact,
    Peek,
    Presentation,
    Expanded,
}

/// How wide the island should prefer to be for this activity. The renderer
/// stays authoritative over final geometry; plugins only describe intent.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PreferredSize {
    /// Content-driven within the standard face bounds.
    #[default]
    Auto,
    /// Small, clock-like surfaces.
    Compact,
    /// Medium-wide surfaces such as level meters.
    Medium,
    /// Wide surfaces such as player chrome.
    Wide,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub activity_id: String,
    pub plugin_id: String,
    pub priority: u8,
    pub mode: PresentationMode,
    pub lifetime_ms: Option<u32>,
    pub interruptible: bool,
    pub compact: Option<UiNode>,
    pub peek: Option<UiNode>,
    pub presentation: Option<UiNode>,
    pub expanded: Option<UiNode>,
    #[serde(default)]
    pub preview: Option<UiNode>,
    #[serde(default)]
    pub timestamp_ms: u64,
    /// Updates sharing a coalescing key replace one presentation instead of
    /// being queued. Generic; a transient surface (for example a system volume
    /// or device change) keeps one live presentation across many updates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coalescing_key: Option<String>,
    /// Preferred presentation width intent. Generic sizing hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_size: Option<PreferredSize>,
}

impl ActivitySnapshot {
    pub fn parse_json(plugin_id: &str, json: &str) -> Result<Self, String> {
        let mut snapshot: ActivitySnapshot =
            serde_json::from_str(json).map_err(|error| error.to_string())?;
        snapshot.plugin_id = plugin_id.to_string();
        if snapshot.activity_id.trim().is_empty() {
            return Err("activity id is required".into());
        }
        if !snapshot.activity_id.starts_with(plugin_id) {
            snapshot.activity_id = format!("{plugin_id}.{}", snapshot.activity_id);
        }
        Ok(snapshot)
    }

    pub fn same_face(&self, other: &Self) -> bool {
        let mut left = self.clone();
        let mut right = other.clone();
        left.timestamp_ms = 0;
        right.timestamp_ms = 0;
        left == right
    }

    pub fn priority_band(&self) -> Priority {
        Priority::from_u8(self.priority)
    }
}
