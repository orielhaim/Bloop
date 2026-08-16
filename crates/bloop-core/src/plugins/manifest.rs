use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{EngineError, EngineResult};
use crate::metrics::{ABI_VERSION, ENGINE_VERSION, PACKAGE_FORMAT};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, Type)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default = "default_api")]
    pub api_version: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub minimum_engine_version: Option<String>,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub enabled_by_default: bool,
    pub provides: Provides,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub settings_schema: Vec<SettingField>,
}

fn default_api() -> String {
    "1".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema, Type)]
pub struct Provides {
    #[serde(default)]
    pub activity: bool,
    #[serde(default)]
    pub theme: bool,
    #[serde(default)]
    pub app: bool,
    /// Activity plugins can be "utilities": they only present transiently and
    /// never occupy a home widget slot.
    #[serde(default = "default_widget")]
    pub widget: bool,
}

impl Default for Provides {
    fn default() -> Self {
        Self {
            activity: false,
            theme: false,
            app: false,
            widget: true,
        }
    }
}

fn default_widget() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default, JsonSchema, Type)]
pub struct Permissions {
    #[serde(default)]
    pub network: Vec<String>,
    #[serde(default)]
    pub storage: bool,
    #[serde(default)]
    pub media: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    pub devices: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SettingField {
    Boolean {
        key: String,
        label: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        default: bool,
    },
    String {
        key: String,
        label: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        default: Option<String>,
        #[serde(default)]
        secret: bool,
    },
    Number {
        key: String,
        label: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        default: f64,
        #[serde(default)]
        min: Option<f64>,
        #[serde(default)]
        max: Option<f64>,
    },
    Select {
        key: String,
        label: String,
        options: Vec<SelectOption>,
        #[serde(default)]
        default: Option<String>,
    },
    Slider {
        key: String,
        label: String,
        min: f64,
        max: f64,
        #[serde(default)]
        step: Option<f64>,
        #[serde(default)]
        default: f64,
    },
    Action {
        key: String,
        label: String,
        #[serde(default)]
        description: Option<String>,
    },
    Secret {
        key: String,
        label: String,
        #[serde(default)]
        description: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema, Type)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

impl PluginManifest {
    pub fn parse(source: &str) -> EngineResult<Self> {
        let manifest: Self = toml::from_str(source)
            .map_err(|error| EngineError::Configuration(error.to_string()))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> EngineResult<()> {
        if self.id.trim().is_empty() || !self.id.contains('.') {
            return Err(EngineError::Configuration(
                "plugin id must be a reverse-domain identifier".into(),
            ));
        }
        if self.name.trim().is_empty() {
            return Err(EngineError::Configuration("plugin name is required".into()));
        }
        semver::Version::parse(&self.version).map_err(|error| {
            EngineError::Configuration(format!("invalid plugin version: {error}"))
        })?;
        if self.api_version != "1" && self.api_version != ABI_VERSION {
            return Err(EngineError::Compatibility(format!(
                "unsupported api_version {}",
                self.api_version
            )));
        }
        if let Some(min) = &self.minimum_engine_version {
            let min = semver::Version::parse(min)
                .map_err(|error| EngineError::Compatibility(error.to_string()))?;
            let engine = semver::Version::parse(ENGINE_VERSION)
                .unwrap_or_else(|_| semver::Version::new(0, 1, 0));
            if engine < min {
                return Err(EngineError::Compatibility(format!(
                    "engine {ENGINE_VERSION} is older than required {min}"
                )));
            }
        }
        if self.provides.activity
            && self
                .icon
                .as_ref()
                .map(|icon| icon.trim().is_empty())
                .unwrap_or(true)
        {
            return Err(EngineError::Configuration(
                "activity plugin must declare an icon in plugin.toml".into(),
            ));
        }
        if !self.provides.activity && !self.provides.theme && !self.provides.app {
            return Err(EngineError::Configuration(
                "plugin must provide activity, theme, and/or app".into(),
            ));
        }
        let _ = PACKAGE_FORMAT;
        Ok(())
    }

    /// JSON Schema for the manifest shape, generated from the Rust types so
    /// tooling and SDK docs always match the real parser.
    pub fn json_schema() -> schemars::Schema {
        schemars::schema_for!(PluginManifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_manifest_parses() {
        let manifest = PluginManifest::parse(
            r#"
id = "com.example.now-playing"
name = "Now Playing"
version = "1.0.0"
api_version = "1"
icon = "assets/icon.svg"

[provides]
activity = true
theme = false

[permissions]
network = ["api.example.com"]
storage = true
media = true
"#,
        )
        .unwrap();
        assert_eq!(manifest.id, "com.example.now-playing");
        assert!(manifest.permissions.media);
    }

    #[test]
    fn invalid_id_fails() {
        let error = PluginManifest::parse(
            r#"
id = "now-playing"
name = "Now Playing"
version = "1.0.0"
[provides]
activity = true
"#,
        )
        .unwrap_err();
        assert!(matches!(error, EngineError::Configuration(_)));
    }

    #[test]
    fn widget_defaults_to_true() {
        let manifest = PluginManifest::parse(
            r#"
id = "com.example.util"
name = "Util"
version = "1.0.0"
icon = "icon.svg"
[provides]
activity = true
"#,
        )
        .unwrap();
        assert!(manifest.provides.widget);

        let manifest = PluginManifest::parse(
            r#"
id = "com.example.util"
name = "Util"
version = "1.0.0"
icon = "icon.svg"
[provides]
activity = true
widget = false
"#,
        )
        .unwrap();
        assert!(!manifest.provides.widget);
    }

    #[test]
    fn json_schema_generates() {
        let schema = PluginManifest::json_schema();
        let json = serde_json::to_string(&schema).unwrap();
        assert!(json.contains("id"));
        assert!(json.contains("settings"));
        assert!(json.contains("SettingField"));
    }

    #[test]
    fn incompatible_api_fails() {
        let error = PluginManifest::parse(
            r#"
id = "com.example.x"
name = "X"
version = "1.0.0"
api_version = "99"
[provides]
activity = true
"#,
        )
        .unwrap_err();
        assert!(matches!(error, EngineError::Compatibility(_)));
    }
}
