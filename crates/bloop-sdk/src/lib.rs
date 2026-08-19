use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot<'a> {
    pub activity_id: &'a str,
    pub plugin_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attention: Option<Attention>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifetime_ms: Option<u32>,
    pub variants: Vec<PresentationVariant<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<serde_json::Value>,
    pub timestamp_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attention {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub importance: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub urgency: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub urgency_window_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persistence: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruptible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub takeover_suitable: Option<bool>,
}

impl Default for Attention {
    fn default() -> Self {
        Self {
            importance: None,
            urgency: None,
            freshness_ms: None,
            urgency_window_ms: None,
            persistence: None,
            interruptible: None,
            takeover_suitable: None,
        }
    }
}

impl Attention {
    pub fn with(self, importance: f32, urgency: f32, freshness_ms: Option<u32>) -> Self {
        Self {
            importance: Some(importance),
            urgency: Some(urgency),
            freshness_ms,
            ..self
        }
    }

    /// Mark this Activity as suitable to take over the whole island
    /// temporarily (transients like volume, device changes, timer completion).
    pub fn takeover(self, suitable: bool) -> Self {
        Self {
            takeover_suitable: Some(suitable),
            ..self
        }
    }

    pub fn deadline(self, window_ms: u32) -> Self {
        Self {
            urgency_window_ms: Some(window_ms),
            ..self
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationVariant<'a> {
    pub density: &'a str,
    pub node: serde_json::Value,
    pub min_width: u16,
    pub preferred_width: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_width: Option<u16>,
    pub utility: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_readable_ms: Option<u32>,
    pub coexist: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<&'a str>,
}

pub fn ui_text(text: &str, variant: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "text", "text": text, "variant": variant })
}

pub fn ui_secondary(text: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "secondaryText", "text": text })
}

pub fn ui_artwork(src: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "artwork", "src": src, "alt": "Artwork" })
}

pub fn ui_icon_button(id: &str, icon: &str, label: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "iconButton", "id": id, "icon": icon, "label": label })
}

pub fn ui_button(id: &str, label: &str, icon: Option<&str>) -> serde_json::Value {
    let mut node = serde_json::json!({ "kind": "button", "id": id, "label": label });
    if let Some(icon) = icon {
        node["icon"] = serde_json::Value::String(icon.to_string());
    }
    node
}

pub fn ui_icon_button_lg(id: &str, icon: &str, label: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "iconButton",
        "id": id,
        "icon": icon,
        "label": label,
        "size": "lg"
    })
}

pub fn ui_seek(position_ms: u64, duration_ms: u64) -> serde_json::Value {
    serde_json::json!({
        "kind": "seekBar",
        "positionMs": position_ms,
        "durationMs": duration_ms,
        "action": "seek"
    })
}

/// Declarative countdown node. The frontend interpolates locally between the
/// authoritative wall-clock deadline and its own clock; plugins do not need to
/// republish every tick.
pub fn ui_countdown(
    deadline_ms: u64,
    running: bool,
    paused_remaining_ms: Option<u64>,
    total_ms: Option<u64>,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "countdown",
        "deadlineMs": deadline_ms,
        "running": running,
        "pausedRemainingMs": paused_remaining_ms,
        "totalMs": total_ms,
    })
}

/// Declarative duration ruler used by countdown configuration surfaces.
pub fn ui_ruler(
    value_ms: u64,
    min_ms: u64,
    max_ms: u64,
    snap_ms: Option<u64>,
    action: &str,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "ruler",
        "valueMs": value_ms,
        "minMs": min_ms,
        "maxMs": max_ms,
        "snapMs": snap_ms,
        "action": action,
    })
}

pub fn ui_row(children: Vec<serde_json::Value>, gap: u16) -> serde_json::Value {
    serde_json::json!({ "kind": "row", "children": children, "gap": gap, "align": "center" })
}

pub fn ui_column(children: Vec<serde_json::Value>, gap: u16) -> serde_json::Value {
    serde_json::json!({ "kind": "column", "children": children, "gap": gap })
}

pub fn ui_badge(text: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "badge", "text": text })
}

pub fn ui_grow() -> serde_json::Value {
    serde_json::json!({ "kind": "spacer", "size": 0, "grow": true })
}

pub fn ui_waveform(active: bool) -> serde_json::Value {
    serde_json::json!({ "kind": "waveform", "active": active })
}

pub fn ui_icon(name: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "icon", "name": name })
}

pub fn ui_progress(value: f64, max: f64) -> serde_json::Value {
    serde_json::json!({ "kind": "progress", "value": value, "max": max })
}
