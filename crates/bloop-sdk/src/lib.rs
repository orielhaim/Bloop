use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot<'a> {
    pub activity_id: &'a str,
    pub plugin_id: &'a str,
    pub priority: u8,
    pub mode: &'a str,
    pub lifetime_ms: Option<u32>,
    pub interruptible: bool,
    pub compact: Option<serde_json::Value>,
    pub peek: Option<serde_json::Value>,
    pub presentation: Option<serde_json::Value>,
    pub expanded: Option<serde_json::Value>,
    pub preview: Option<serde_json::Value>,
    pub timestamp_ms: u64,
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
