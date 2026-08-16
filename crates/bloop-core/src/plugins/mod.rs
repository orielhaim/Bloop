mod manifest;
mod package;
mod permissions;
pub mod runtime;

pub use manifest::*;
pub use package::*;
pub use permissions::*;

use crate::activity::ActivityService;
use crate::capabilities::{HttpService, MediaEvent, MediaService};
use crate::error::{EngineError, EngineResult};
use crate::events::{EngineEvent, EventBus};
use crate::settings::SettingsService;
use crate::theme::{ThemeDocument, ThemeService};
use parking_lot::Mutex;
pub use runtime::inspect_component;
use runtime::{
    PluginCommand, event_matches, spawn_activity_plugin, start_epoch_thread, wasm_engine,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Sender;

pub struct PluginManager {
    records: Mutex<HashMap<String, PluginRecord>>,
    workers: Arc<Mutex<HashMap<String, Sender<PluginCommand>>>>,
    storage: Arc<Mutex<NamespacedStore>>,
    http: Arc<HttpService>,
    media: Arc<MediaService>,
    watches: Arc<Mutex<HashMap<String, String>>>,
    settings: Arc<SettingsService>,
    activities: Arc<ActivityService>,
    themes: Arc<ThemeService>,
    events: Arc<EventBus>,
    wasm: wasmtime::Engine,
    persist_path: Option<PathBuf>,
}

impl PluginManager {
    pub fn new(
        http: Arc<HttpService>,
        media: Arc<MediaService>,
        settings: Arc<SettingsService>,
        activities: Arc<ActivityService>,
        themes: Arc<ThemeService>,
        events: Arc<EventBus>,
        persist_path: Option<PathBuf>,
    ) -> EngineResult<Self> {
        let wasm = wasm_engine()?;
        start_epoch_thread(wasm.clone());
        let workers: Arc<Mutex<HashMap<String, Sender<PluginCommand>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let watches = Arc::new(Mutex::new(HashMap::new()));
        let workers_for_media = workers.clone();
        let watches_for_media = watches.clone();
        media.subscribe(move |event| {
            dispatch_media_event(&workers_for_media, &watches_for_media, event);
        });
        let storage = persist_path
            .as_ref()
            .map(|path| NamespacedStore::load(path))
            .unwrap_or_default();
        Ok(Self {
            records: Mutex::new(HashMap::new()),
            workers,
            storage: Arc::new(Mutex::new(storage)),
            http,
            media,
            watches,
            settings,
            activities,
            themes,
            events,
            wasm,
            persist_path,
        })
    }

    pub fn storage(&self) -> Arc<Mutex<NamespacedStore>> {
        self.storage.clone()
    }

    pub fn discover_and_load(&self, roots: &[PathBuf]) -> Vec<PluginRecord> {
        let mut loaded = Vec::new();
        for package in discover(roots) {
            match self.install_from_path(package, false) {
                Ok(record) => loaded.push(record),
                Err(error) => tracing::warn!(%error, "plugin discovery failed"),
            }
        }
        loaded
    }

    pub fn install_from_path(
        &self,
        root: PathBuf,
        force_enable: bool,
    ) -> EngineResult<PluginRecord> {
        let (manifest, root, component_path, theme_path) = load_package(&root)?;
        let mut inspect_error = None;
        if manifest.provides.activity && component_path.is_none() {
            inspect_error = Some("activity plugin is missing component.wasm".into());
        }
        if let Some(path) = &component_path {
            if let Err(error) = inspect_component(path) {
                inspect_error = Some(error.to_string());
            }
        }
        let enabled = force_enable
            || self
                .settings
                .get()
                .enabled_plugins
                .get(&manifest.id)
                .copied()
                .unwrap_or(manifest.enabled_by_default);
        let icon_url = plugin_icon_data_url(&root, manifest.icon.as_deref());
        let mut record = PluginRecord {
            id: manifest.id.clone(),
            manifest,
            root,
            component_path,
            theme_path,
            enabled,
            error: inspect_error.clone(),
            icon_url,
            state: if inspect_error.is_some() {
                PluginLifecycle::Failed
            } else {
                PluginLifecycle::Installed
            },
        };
        if enabled && inspect_error.is_none() {
            if let Err(error) = self.enable_record(&mut record) {
                record.state = PluginLifecycle::Failed;
                record.error = Some(error.to_string());
                record.enabled = false;
            }
        } else if inspect_error.is_none() {
            record.state = PluginLifecycle::Disabled;
        }
        self.records
            .lock()
            .insert(record.id.clone(), record.clone());
        self.events.emit(EngineEvent::PluginLoaded {
            plugin: record.clone(),
        });
        Ok(record)
    }

    pub fn list(&self) -> Vec<PluginRecord> {
        self.records.lock().values().cloned().collect()
    }

    pub fn get(&self, id: &str) -> Option<PluginRecord> {
        self.records.lock().get(id).cloned()
    }

    pub fn enable(&self, id: &str) -> EngineResult<PluginRecord> {
        let mut records = self.records.lock();
        let record = records
            .get_mut(id)
            .ok_or_else(|| EngineError::Plugin("plugin not found".into()))?;
        self.enable_record(record)?;
        Ok(record.clone())
    }

    pub fn disable(&self, id: &str) -> EngineResult<PluginRecord> {
        if let Some(worker) = self.workers.lock().remove(id) {
            let _ = worker.send(PluginCommand::Shutdown);
        }
        let mut records = self.records.lock();
        let record = records
            .get_mut(id)
            .ok_or_else(|| EngineError::Plugin("plugin not found".into()))?;
        record.enabled = false;
        record.state = PluginLifecycle::Disabled;
        if let Some(theme) = theme_from_record(record) {
            let id = theme.id.clone();
            self.themes.unregister(&id);
            self.settings.update(|settings| {
                if settings.theme_id == id {
                    settings.theme_id = "bloop.theme.obsidian".into();
                }
            });
            if self.themes.current().id == "bloop.theme.obsidian" {
                self.events.emit(EngineEvent::ThemeChanged {
                    id: "bloop.theme.obsidian".into(),
                });
            }
        }
        self.settings.update(|settings| {
            settings.enabled_plugins.insert(record.id.clone(), false);
        });
        self.events
            .emit(EngineEvent::PluginUnloaded { id: id.into() });
        Ok(record.clone())
    }

    pub fn uninstall(&self, id: &str) -> EngineResult<()> {
        self.disable(id)?;
        self.records.lock().remove(id);
        Ok(())
    }

    pub fn reload(&self, id: &str) -> EngineResult<PluginRecord> {
        let record = self
            .get(id)
            .ok_or_else(|| EngineError::Plugin("plugin not found".into()))?;
        self.disable(id)?;
        self.install_from_path(record.root, true)
    }

    pub fn dispatch_action(
        &self,
        plugin_id: &str,
        action_id: &str,
        payload: &str,
    ) -> EngineResult<()> {
        let worker = self
            .workers
            .lock()
            .get(plugin_id)
            .cloned()
            .ok_or_else(|| EngineError::Plugin("plugin is not running".into()))?;
        worker
            .send(PluginCommand::Action {
                id: action_id.into(),
                payload: payload.into(),
            })
            .map_err(|_| EngineError::Runtime("plugin worker closed".into()))
    }

    pub fn notify_settings(&self, plugin_id: &str) {
        if let Some(worker) = self.workers.lock().get(plugin_id) {
            let _ = worker.send(PluginCommand::SettingsChanged);
        }
    }

    fn enable_record(&self, record: &mut PluginRecord) -> EngineResult<()> {
        if record.manifest.provides.activity {
            if let Some(existing) = self.workers.lock().remove(&record.id) {
                let _ = existing.send(PluginCommand::Shutdown);
            }
            let tx = spawn_activity_plugin(
                self.wasm.clone(),
                record,
                self.http.clone(),
                self.media.clone(),
                self.watches.clone(),
                self.storage.clone(),
                self.settings.clone(),
                self.activities.clone(),
                self.events.clone(),
                self.persist_path.clone(),
            )?;
            tx.send(PluginCommand::Initialize)
                .map_err(|_| EngineError::Runtime("failed to initialize plugin".into()))?;
            self.workers.lock().insert(record.id.clone(), tx);
        }
        if let Some(theme) = theme_from_record(record) {
            self.themes.register(theme);
        }
        record.enabled = true;
        record.state = PluginLifecycle::Running;
        record.error = None;
        self.settings.update(|settings| {
            settings.enabled_plugins.insert(record.id.clone(), true);
        });
        Ok(())
    }
}

fn theme_from_record(record: &PluginRecord) -> Option<ThemeDocument> {
    let path = record.theme_path.as_ref()?;
    let source = std::fs::read_to_string(path).ok()?;
    ThemeDocument::parse(&source).ok()
}

fn dispatch_media_event(
    workers: &Arc<Mutex<HashMap<String, Sender<PluginCommand>>>>,
    watches: &Arc<Mutex<HashMap<String, String>>>,
    event: MediaEvent,
) {
    let payload = serde_json::to_string(&event).unwrap_or_else(|_| "{}".into());
    let watches = watches.lock().clone();
    let workers = workers.lock();
    for (plugin_id, query) in watches {
        if event_matches(&event, &query)
            && let Some(worker) = workers.get(&plugin_id)
        {
            let _ = worker.send(PluginCommand::Event {
                topic: "media".into(),
                payload: payload.clone(),
            });
        }
    }
}
