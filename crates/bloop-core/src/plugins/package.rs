use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::manifest::PluginManifest;
use crate::error::{EngineError, EngineResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub id: String,
    pub manifest: PluginManifest,
    pub root: PathBuf,
    pub component_path: Option<PathBuf>,
    pub theme_path: Option<PathBuf>,
    pub enabled: bool,
    pub error: Option<String>,
    #[serde(rename = "iconUrl")]
    pub icon_url: Option<String>,
    pub state: PluginLifecycle,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PluginLifecycle {
    Discovered,
    Validated,
    Installed,
    Enabled,
    Running,
    Disabled,
    Failed,
}

pub fn plugin_icon_data_url(root: &Path, icon: Option<&str>) -> Option<String> {
    let icon = icon.filter(|value| !value.is_empty())?;
    let path = root.join(icon);
    let bytes = std::fs::read(&path).ok()?;
    let mime = match path.extension().and_then(|ext| ext.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    };
    Some(crate::codec::data_url(mime, &bytes))
}

pub fn discover(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut packages = Vec::new();
    for root in roots {
        collect_packages(root, 0, &mut packages);
    }
    packages.sort();
    packages.dedup();
    packages
}

fn collect_packages(root: &Path, depth: u8, packages: &mut Vec<PathBuf>) {
    if depth > 2 {
        return;
    }
    if root.join("plugin.toml").is_file() {
        packages.push(root.to_path_buf());
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_packages(&path, depth + 1, packages);
        }
    }
}

pub fn load_package(
    root: &Path,
) -> EngineResult<(PluginManifest, PathBuf, Option<PathBuf>, Option<PathBuf>)> {
    let source = std::fs::read_to_string(root.join("plugin.toml"))
        .map_err(|error| EngineError::Configuration(error.to_string()))?;
    let manifest = PluginManifest::parse(&source)?;
    let entry = manifest
        .entry
        .clone()
        .unwrap_or_else(|| "component.wasm".into());
    let component = root.join(entry);
    let component_path = component.exists().then_some(component);
    let theme = ["theme/theme.toml", "theme.toml"]
        .into_iter()
        .map(|rel| root.join(rel))
        .find(|path| path.exists());
    if manifest.provides.activity {
        let icon = manifest.icon.as_deref().unwrap_or("");
        if icon.is_empty() || !root.join(icon).is_file() {
            return Err(EngineError::Configuration(
                "activity plugin is missing the icon declared in plugin.toml".into(),
            ));
        }
    }
    if manifest.provides.theme && theme.is_none() {
        return Err(EngineError::Configuration(
            "theme plugin is missing theme.toml".into(),
        ));
    }
    Ok((manifest, root.to_path_buf(), component_path, theme))
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct NamespacedStore {
    namespaces: BTreeMap<String, BTreeMap<String, String>>,
}

impl NamespacedStore {
    pub fn get(&self, plugin_id: &str, key: &str) -> Option<String> {
        self.namespaces.get(plugin_id)?.get(key).cloned()
    }

    pub fn set(&mut self, plugin_id: &str, key: &str, value: String) {
        self.namespaces
            .entry(plugin_id.to_string())
            .or_default()
            .insert(key.to_string(), value);
    }

    pub fn delete(&mut self, plugin_id: &str, key: &str) {
        if let Some(ns) = self.namespaces.get_mut(plugin_id) {
            ns.remove(key);
        }
    }

    pub fn list(&self, plugin_id: &str) -> Vec<String> {
        self.namespaces
            .get(plugin_id)
            .map(|ns| ns.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn load(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> EngineResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| EngineError::Configuration(error.to_string()))?;
        }
        std::fs::write(
            path,
            serde_json::to_vec_pretty(self)
                .map_err(|error| EngineError::Configuration(error.to_string()))?,
        )
        .map_err(|error| EngineError::Configuration(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_is_namespaced() {
        let mut store = NamespacedStore::default();
        store.set("a", "token", "1".into());
        store.set("b", "token", "2".into());
        assert_eq!(store.get("a", "token").as_deref(), Some("1"));
        assert_eq!(store.get("b", "token").as_deref(), Some("2"));
        assert!(store.get("a", "missing").is_none());
    }
}
