use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bloop_core::{Engine, PluginManifest};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// Plugin source files that should trigger a reload when they change.
const WATCHED_FILES: [&str; 4] = ["plugin.toml", "component.wasm", "theme.toml", "theme.toml"];

/// Watch plugin directories and reload the affected plugin whenever its source
/// changes. Dev-only convenience; production builds ship immutable wasm.
pub fn start_plugin_watcher(engine: Arc<Engine>, roots: Vec<PathBuf>) {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    }) {
        Ok(watcher) => watcher,
        Err(error) => {
            tracing::warn!(%error, "plugin watcher unavailable");
            return;
        }
    };
    for root in roots {
        if !root.exists() {
            continue;
        }
        if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
            tracing::warn!(root = ?root, %error, "failed to watch plugin directory");
        }
    }
    std::thread::Builder::new()
        .name("bloop-plugin-watch".into())
        .spawn(move || {
            let mut pending = HashMap::<String, Instant>::new();
            loop {
                while let Ok(Ok(event)) = rx.try_recv() {
                    let relevant = matches!(
                        event.kind,
                        notify::EventKind::Modify(_) | notify::EventKind::Create(_)
                    );
                    if !relevant {
                        continue;
                    }
                    if let Some(plugin_id) =
                        event.paths.iter().find_map(|path| plugin_id_for_path(path))
                    {
                        pending.insert(plugin_id, Instant::now());
                    }
                }
                let now = Instant::now();
                let ready: Vec<String> = pending
                    .iter()
                    .filter(|(_, since)| now.duration_since(**since) >= Duration::from_millis(500))
                    .map(|(id, _)| id.clone())
                    .collect();
                for plugin_id in ready {
                    pending.remove(&plugin_id);
                    if let Err(error) = engine.plugins.reload(&plugin_id) {
                        tracing::warn!(plugin = %plugin_id, %error, "plugin reload failed");
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })
        .ok();
}

fn plugin_id_for_path(path: &Path) -> Option<String> {
    let file = path.file_name()?.to_str()?;
    if !WATCHED_FILES.contains(&file)
        && !file.ends_with(".wasm")
        && !file.ends_with(".svg")
        && !file.ends_with(".png")
    {
        return None;
    }
    let mut current = path.parent();
    while let Some(dir) = current {
        let manifest = dir.join("plugin.toml");
        if manifest.is_file() {
            let source = std::fs::read_to_string(&manifest).ok()?;
            let manifest = toml::from_str::<PluginManifest>(&source).ok()?;
            return Some(manifest.id);
        }
        current = dir.parent();
    }
    None
}
