use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDocument {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub tokens: ThemeTokens,
    #[serde(default)]
    pub motion: MotionTokens,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeTokens {
    pub shell: String,
    pub foreground: String,
    pub muted: String,
    pub accent: String,
    pub surface: String,
    #[serde(default = "one")]
    pub opacity: f32,
    #[serde(default)]
    pub blur: f32,
    #[serde(default)]
    pub border: String,
    #[serde(default)]
    pub shadow: String,
    #[serde(default = "radius")]
    pub radius: f32,
}

fn one() -> f32 {
    1.0
}
fn radius() -> f32 {
    28.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct MotionTokens {
    pub peek: Spring,
    pub expand: Spring,
    pub collapse: Spring,
    pub content_enter_ms: u32,
    pub content_exit_ms: u32,
    pub page: Spring,
    pub drag: Spring,
    pub activity_switch: Spring,
}

impl Default for MotionTokens {
    fn default() -> Self {
        Self {
            peek: Spring {
                stiffness: 680.0,
                damping: 38.0,
                mass: 0.55,
            },
            expand: Spring {
                stiffness: 420.0,
                damping: 30.0,
                mass: 0.72,
            },
            collapse: Spring {
                stiffness: 580.0,
                damping: 40.0,
                mass: 0.52,
            },
            content_enter_ms: 160,
            content_exit_ms: 120,
            page: Spring {
                stiffness: 380.0,
                damping: 36.0,
                mass: 0.7,
            },
            drag: Spring {
                stiffness: 500.0,
                damping: 32.0,
                mass: 0.6,
            },
            activity_switch: Spring {
                stiffness: 460.0,
                damping: 34.0,
                mass: 0.62,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct Spring {
    pub stiffness: f32,
    pub damping: f32,
    pub mass: f32,
}

impl ThemeDocument {
    pub fn parse(source: &str) -> Result<Self, String> {
        toml::from_str(source).map_err(|error| error.to_string())
    }

    pub fn obsidian() -> Self {
        Self::parse(include_str!(
            "../../../plugins/themes/obsidian/theme/theme.toml"
        ))
        .unwrap_or_else(|_| Self {
            id: "bloop.theme.obsidian".into(),
            name: "Obsidian".into(),
            description: Some("Built-in dark glass.".into()),
            tokens: ThemeTokens {
                shell: "#0a0a0a".into(),
                foreground: "#f4f4f5".into(),
                muted: "#a1a1aa".into(),
                accent: "#5eead4".into(),
                surface: "#18181b".into(),
                opacity: 1.0,
                blur: 0.0,
                border: "transparent".into(),
                shadow: "0 18px 40px rgb(0 0 0 / 35%)".into(),
                radius: 28.0,
            },
            motion: MotionTokens::default(),
        })
    }
}

pub struct ThemeService {
    inner: parking_lot::Mutex<ThemeDocument>,
    available: parking_lot::Mutex<Vec<ThemeDocument>>,
}

impl ThemeService {
    pub fn new() -> Self {
        let builtin = ThemeDocument::obsidian();
        Self {
            inner: parking_lot::Mutex::new(builtin.clone()),
            available: parking_lot::Mutex::new(vec![builtin]),
        }
    }

    pub fn current(&self) -> ThemeDocument {
        self.inner.lock().clone()
    }

    pub fn list(&self) -> Vec<ThemeDocument> {
        self.available.lock().clone()
    }

    pub fn unregister(&self, id: &str) {
        if id == "bloop.theme.obsidian" {
            return;
        }
        self.available.lock().retain(|item| item.id != id);
        let mut current = self.inner.lock();
        if current.id == id {
            *current = ThemeDocument::obsidian();
        }
    }

    pub fn register(&self, theme: ThemeDocument) {
        let mut available = self.available.lock();
        available.retain(|item| item.id != theme.id);
        available.push(theme);
    }

    pub fn apply(&self, id: &str) -> Result<ThemeDocument, String> {
        let theme = self
            .list()
            .into_iter()
            .find(|theme| theme.id == id)
            .ok_or_else(|| "theme not found".to_string())?;
        *self.inner.lock() = theme.clone();
        Ok(theme)
    }
}

impl Default for ThemeService {
    fn default() -> Self {
        Self::new()
    }
}
