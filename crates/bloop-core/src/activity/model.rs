use serde::{Deserialize, Serialize};
use specta::Type;

use super::ui::UiNode;

/// The generic lifecycle an Activity represents. Plugins describe what kind of
/// information they carry through this semantic metadata; the engine never
/// matches on plugin ids.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityLifecycle {
    /// A short-lived one-shot event (volume change, device connect).
    Momentary,
    /// Persistent state that stays relevant until dismissed (now playing,
    /// idle clock).
    #[default]
    Ongoing,
    /// An operation that advances over time (transfer, install).
    Progress,
    /// A deadline / countdown whose urgency rises as it approaches.
    Countdown,
    /// A result that finished (timer completed, screenshot saved).
    Completion,
    /// Something that needs attention now (alarm, alert).
    Alert,
}

fn half() -> f32 {
    0.5
}
fn third() -> f32 {
    0.33
}
fn default_true() -> bool {
    true
}

/// Generic attention characteristics. These are distinct semantic dimensions,
/// not one priority integer: a volume bump is high-urgency / low-persistence,
/// a timer is moderate-urgency / high-persistence, now playing is
/// low-urgency / high-context.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct Attention {
    /// Base importance 0..1.
    #[serde(default = "half")]
    pub importance: f32,
    /// Base urgency 0..1 at publish time.
    #[serde(default = "third")]
    pub urgency: f32,
    /// How long (ms) the Activity stays relevant after its last update.
    /// `None` means it is resident and never freshness-expires on its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freshness_ms: Option<u32>,
    /// Window (ms) before `deadline_ms` during which urgency ramps from
    /// `urgency` toward 1.0. Generic: only meaningful when a deadline exists.
    /// The plugin expresses its own semantic progression; the engine derives
    /// the curve from these generic fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urgency_window_ms: Option<u32>,
    /// Long-term value 0..1 — how worth keeping resident this information is.
    #[serde(default = "half")]
    pub persistence: f32,
    /// Whether the Activity can be removed from the composition cheaply.
    #[serde(default = "default_true")]
    pub interruptible: bool,
    /// Whether the Activity is suitable to take over the whole island
    /// temporarily (transients like volume, timer completion).
    #[serde(default)]
    pub takeover_suitable: bool,
}

impl Default for Attention {
    fn default() -> Self {
        Self {
            importance: half(),
            urgency: third(),
            freshness_ms: None,
            urgency_window_ms: None,
            persistence: half(),
            interruptible: true,
            takeover_suitable: false,
        }
    }
}

/// Semantic presentation density. Names are not pixel widths; they are
/// information-density levels the engine trades off against space.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, PartialOrd, Ord, Type)]
#[serde(rename_all = "camelCase")]
pub enum Density {
    /// A single indicator (icon, dot).
    Micro,
    /// One compact datum (a short number or name).
    Small,
    /// A small composed unit (icon + datum).
    #[default]
    Compact,
    /// A richer unit (icon + label + secondary detail).
    RichCompact,
    /// The expanded face.
    Expanded,
}

/// One presentation variant of an Activity: a declarative UI node plus the
/// metadata the composition engine needs to reason about its cost and value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct PresentationVariant {
    pub density: Density,
    #[serde(default)]
    pub node: Option<UiNode>,
    #[serde(default)]
    pub min_width: u16,
    pub preferred_width: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<u16>,
    /// Information utility 0..1 for this density.
    #[serde(default = "half")]
    pub utility: f32,
    /// How long this variant must stay readable before it may swap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_readable_ms: Option<u32>,
    /// Whether this variant may sit next to other segments. `false` means it
    /// must be the only thing on the face.
    #[serde(default = "default_true")]
    pub coexist: bool,
    /// Optional human label for diagnostics only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// The semantic descriptor of one Activity. Activities *exist* here regardless
/// of whether they are currently drawn; presentation is decided downstream by
/// the composition engine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    /// Stable identity across updates.
    pub activity_id: String,
    /// Source plugin.
    pub plugin_id: String,
    /// Optional stable identity per logical instance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// Group / coalescing identity: updates in the same group replace one slot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default)]
    pub lifecycle: ActivityLifecycle,
    #[serde(default)]
    pub attention: Attention,
    /// Absolute wall-clock deadline (ms since epoch). Lets the engine derive
    /// dynamic urgency for countdowns generically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = f64)]
    pub deadline_ms: Option<u64>,
    /// Transient window: how long a transient presentation stays relevant after
    /// its last update. `None` means the Activity is resident and persists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifetime_ms: Option<u32>,
    /// The compact presentation variants the engine may choose from.
    #[serde(default)]
    pub variants: Vec<PresentationVariant>,
    /// The expanded face shown when the island is opened.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expanded: Option<UiNode>,
    /// Small widget preview for the home customization surface.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<UiNode>,
    #[serde(default)]
    #[specta(type = f64)]
    pub timestamp_ms: u64,
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
        if snapshot.instance_id.is_none() {
            snapshot.instance_id = Some(snapshot.activity_id.clone());
        }
        Ok(snapshot)
    }

    /// Whether two snapshots describe the same content (ignoring timestamps).
    pub fn same_content(&self, other: &Self) -> bool {
        let mut left = self.clone();
        let mut right = other.clone();
        left.timestamp_ms = 0;
        right.timestamp_ms = 0;
        left == right
    }

    /// Whether this Activity is a transient (has a freshness window).
    pub fn is_transient(&self) -> bool {
        self.attention.freshness_ms.is_some() || self.lifetime_ms.is_some()
    }
}
