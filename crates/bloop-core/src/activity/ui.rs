use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiNode {
    Text {
        text: String,
        #[serde(default)]
        variant: TextVariant,
    },
    SecondaryText {
        text: String,
    },
    Icon {
        name: String,
    },
    Image {
        src: String,
        #[serde(default)]
        alt: String,
    },
    Artwork {
        src: String,
        #[serde(default)]
        alt: String,
    },
    Button {
        id: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        icon: Option<String>,
    },
    IconButton {
        id: String,
        icon: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        size: Option<String>,
    },
    Progress {
        value: f64,
        #[serde(default = "one")]
        max: f64,
    },
    SeekBar {
        #[specta(type = f64)]
        position_ms: u64,
        #[specta(type = f64)]
        duration_ms: u64,
        action: String,
    },
    Toggle {
        id: String,
        on: bool,
        #[serde(default)]
        label: String,
    },
    Badge {
        text: String,
    },
    Separator,
    Spacer {
        #[serde(default = "spacer_size")]
        size: u16,
        #[serde(default)]
        grow: bool,
    },
    Waveform {
        #[serde(default)]
        active: bool,
    },
    Row {
        #[serde(default)]
        children: Vec<UiNode>,
        #[serde(default = "gap")]
        gap: u16,
        #[serde(default)]
        align: Align,
    },
    Column {
        #[serde(default)]
        children: Vec<UiNode>,
        #[serde(default = "gap")]
        gap: u16,
    },
    Stack {
        #[serde(default)]
        children: Vec<UiNode>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub enum TextVariant {
    #[default]
    Body,
    Title,
    Kicker,
    Numeric,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    #[default]
    Center,
    Start,
    End,
    Stretch,
}

fn one() -> f64 {
    1.0
}
fn gap() -> u16 {
    8
}
fn spacer_size() -> u16 {
    8
}

pub fn parse_ui(json: &str) -> Result<UiNode, String> {
    serde_json::from_str(json).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_kind() {
        let error = parse_ui(r#"{"kind":"iframe"}"#).unwrap_err();
        assert!(error.contains("unknown variant") || error.contains("did not match"));
    }

    #[test]
    fn parses_nested_row() {
        let node = parse_ui(
            r#"{"kind":"row","children":[{"kind":"text","text":"Hello"},{"kind":"badge","text":"Live"}]}"#,
        )
        .unwrap();
        match node {
            UiNode::Row { children, .. } => assert_eq!(children.len(), 2),
            _ => panic!("expected row"),
        }
    }

    #[test]
    fn parses_seek_bar_camel_case() {
        let node = parse_ui(
            r#"{"kind":"seekBar","positionMs":12000,"durationMs":240000,"action":"seek"}"#,
        )
        .unwrap();
        match node {
            UiNode::SeekBar {
                position_ms,
                duration_ms,
                action,
            } => {
                assert_eq!(position_ms, 12_000);
                assert_eq!(duration_ms, 240_000);
                assert_eq!(action, "seek");
            }
            _ => panic!("expected seek bar"),
        }
    }

    #[test]
    fn parses_waveform() {
        let node = parse_ui(r#"{"kind":"waveform","active":true}"#).unwrap();
        match node {
            UiNode::Waveform { active } => assert!(active),
            _ => panic!("expected waveform"),
        }
    }
}
