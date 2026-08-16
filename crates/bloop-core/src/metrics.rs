use serde::{Deserialize, Serialize};

pub const ABI_VERSION: &str = "1.0.0";
pub const ENGINE_VERSION: &str = "0.1.0";
pub const PACKAGE_FORMAT: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IslandMetrics {
    pub resting: Size,
    pub peek: Size,
    pub presentation: Size,
    pub expanded: Size,
    pub window: Size,
}

impl IslandMetrics {
    pub fn load() -> Self {
        serde_json::from_str(include_str!("../../../shared/island-metrics.json"))
            .expect("island metrics")
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Presence {
    Resting,
    Peek,
    Presentation,
    Expanded,
}

impl Presence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Resting => "resting",
            Self::Peek => "peek",
            Self::Presentation => "presentation",
            Self::Expanded => "expanded",
        }
    }
}
