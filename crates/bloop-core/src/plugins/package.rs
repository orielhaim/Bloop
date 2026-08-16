use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use super::manifest::PluginManifest;
use crate::error::{EngineError, EngineResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Type)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
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
    let component_path = resolve_component(root, &entry);
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

/// Locate the wasm component for a plugin package.
///
/// Dev builds keep `plugin.toml` in the source tree and write `component.wasm`
/// to `target/{debug,release}/plugins/<dir>/` via xtask. Packaged builds place
/// the file next to the manifest.
pub fn resolve_component(root: &Path, entry: &str) -> Option<PathBuf> {
    let local = root.join(entry);
    if local.is_file() {
        return Some(local);
    }
    let plugin_name = root.file_name()?;
    for ancestor in root.ancestors().skip(1) {
        for profile in ["debug", "release"] {
            let candidate = ancestor
                .join("target")
                .join(profile)
                .join("plugins")
                .join(plugin_name)
                .join(entry);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Crash-safe, transactional plugin storage backed by redb. Namespaced by
/// plugin id so one plugin can never read or overwrite another's keys.
pub struct PluginStore {
    db: parking_lot::Mutex<redb::Database>,
}

const TABLE: redb::TableDefinition<(&str, &str), &str> = redb::TableDefinition::new("plugins");

impl PluginStore {
    /// Open (or create) the store at `path`, or an in-memory store when no
    /// path is given.
    pub fn open(path: Option<&Path>) -> EngineResult<Self> {
        let db = match path {
            Some(path) => {
                if let Some(parent) = path.parent()
                    && !parent.as_os_str().is_empty()
                {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| EngineError::Configuration(error.to_string()))?;
                }
                redb::Database::create(path)
                    .map_err(|error| EngineError::Configuration(error.to_string()))?
            }
            None => redb::Database::builder()
                .create_with_backend(redb::backends::InMemoryBackend::new())
                .map_err(|error| EngineError::Configuration(error.to_string()))?,
        };
        let write = db
            .begin_write()
            .map_err(|error| EngineError::Configuration(error.to_string()))?;
        write
            .open_table(TABLE)
            .map_err(|error| EngineError::Configuration(error.to_string()))?;
        write
            .commit()
            .map_err(|error| EngineError::Configuration(error.to_string()))?;
        Ok(Self {
            db: parking_lot::Mutex::new(db),
        })
    }

    pub fn get(&self, plugin_id: &str, key: &str) -> Option<String> {
        use redb::ReadableDatabase;
        let db = self.db.lock();
        let read = db.begin_read().ok()?;
        let table = read.open_table(TABLE).ok()?;
        table
            .get((plugin_id, key))
            .ok()
            .flatten()
            .map(|value| value.value().to_string())
    }

    pub fn set(&self, plugin_id: &str, key: &str, value: String) -> EngineResult<()> {
        let db = self.db.lock();
        let write = db
            .begin_write()
            .map_err(|error| EngineError::Configuration(error.to_string()))?;
        {
            let mut table = write
                .open_table(TABLE)
                .map_err(|error| EngineError::Configuration(error.to_string()))?;
            table
                .insert((plugin_id, key), value.as_str())
                .map_err(|error| EngineError::Configuration(error.to_string()))?;
        }
        write
            .commit()
            .map_err(|error| EngineError::Configuration(error.to_string()))
    }

    pub fn delete(&self, plugin_id: &str, key: &str) -> EngineResult<()> {
        let db = self.db.lock();
        let write = db
            .begin_write()
            .map_err(|error| EngineError::Configuration(error.to_string()))?;
        {
            let mut table = write
                .open_table(TABLE)
                .map_err(|error| EngineError::Configuration(error.to_string()))?;
            table
                .remove((plugin_id, key))
                .map_err(|error| EngineError::Configuration(error.to_string()))?;
        }
        write
            .commit()
            .map_err(|error| EngineError::Configuration(error.to_string()))
    }

    pub fn list(&self, plugin_id: &str) -> Vec<String> {
        use redb::{ReadableDatabase, ReadableTable};
        let db = self.db.lock();
        let Ok(read) = db.begin_read() else {
            return Vec::new();
        };
        let Ok(table) = read.open_table(TABLE) else {
            return Vec::new();
        };
        table
            .iter()
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok())
            .filter_map(|(key, _)| {
                let (namespace, key) = key.value();
                (namespace == plugin_id).then(|| key.to_string())
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn storage_is_namespaced_and_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("plugins.redb");
        let store = PluginStore::open(Some(&path)).unwrap();
        store.set("a", "token", "1".into()).unwrap();
        store.set("b", "token", "2".into()).unwrap();
        assert_eq!(store.get("a", "token").as_deref(), Some("1"));
        assert_eq!(store.get("b", "token").as_deref(), Some("2"));
        assert!(store.get("a", "missing").is_none());
        assert_eq!(store.list("a"), vec!["token".to_string()]);

        store.delete("a", "token").unwrap();
        assert!(store.get("a", "token").is_none());
        drop(store);

        // Reopening reads the persisted values.
        let reopened = PluginStore::open(Some(&path)).unwrap();
        assert_eq!(reopened.get("b", "token").as_deref(), Some("2"));
    }

    #[test]
    fn in_memory_store_works_without_a_path() {
        let store = PluginStore::open(None).unwrap();
        store.set("a", "k", "v".into()).unwrap();
        assert_eq!(store.get("a", "k").as_deref(), Some("v"));
    }

    #[test]
    fn resolves_xtask_component_from_workspace_target() {
        let dir = tempdir().unwrap();
        let plugin = dir.path().join("plugins").join("volume");
        std::fs::create_dir_all(&plugin).unwrap();
        let wasm = dir
            .path()
            .join("target")
            .join("debug")
            .join("plugins")
            .join("volume")
            .join("component.wasm");
        std::fs::create_dir_all(wasm.parent().unwrap()).unwrap();
        std::fs::write(&wasm, b"\0asm").unwrap();
        assert_eq!(
            resolve_component(&plugin, "component.wasm").as_deref(),
            Some(wasm.as_path())
        );
    }
}
