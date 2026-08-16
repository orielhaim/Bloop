use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use wasmtime::component::{Component, HasSelf, Linker, ResourceAny, ResourceTable};
use wasmtime::{Engine as WasmEngine, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

use super::manifest::{Permissions, PluginManifest};
use super::package::{NamespacedStore, PluginRecord};
use super::permissions::{assert_media, assert_storage};
use crate::activity::{ActivityService, ActivitySnapshot};
use crate::capabilities::{
    HttpRequest, HttpService, MediaEvent, MediaService, MediaSession, RepeatMode,
};
use crate::error::{EngineError, EngineResult};
use crate::events::{EngineEvent, EventBus};
use crate::settings::SettingsService;

wasmtime::component::bindgen!({
    path: "../../wit",
    world: "activity-plugin",
});

pub enum PluginCommand {
    Initialize,
    Action { id: String, payload: String },
    Timer { id: String },
    Event { topic: String, payload: String },
    SettingsChanged,
    Shutdown,
}

pub struct HostState {
    pub plugin_id: String,
    pub permissions: Permissions,
    pub limits: StoreLimits,
    pub http: Arc<HttpService>,
    pub media: Arc<MediaService>,
    pub watches: Arc<Mutex<HashMap<String, String>>>,
    pub storage: Arc<Mutex<NamespacedStore>>,
    pub settings: Arc<SettingsService>,
    pub activities: Arc<ActivityService>,
    pub events: Arc<EventBus>,
    pub timers: Arc<Mutex<HashMap<String, u32>>>,
    pub allocations: usize,
    pub persist_path: Option<PathBuf>,
    wasi: WasiCtx,
    table: ResourceTable,
}

impl HostState {
    fn charge(&mut self, bytes: usize) -> EngineResult<()> {
        self.allocations = self.allocations.saturating_add(bytes);
        if self.allocations > 8 * 1024 * 1024 {
            return Err(EngineError::Runtime(
                "host allocation limit exceeded".into(),
            ));
        }
        Ok(())
    }

    fn require_media(&self) -> Result<(), bloop::abi::types::Error> {
        assert_media(&self.permissions).map_err(Into::into)
    }

    fn persist_storage(&self) {
        let Some(path) = &self.persist_path else {
            return;
        };
        if let Err(error) = self.storage.lock().save(path) {
            tracing::warn!(plugin = %self.plugin_id, %error, "plugin storage persist failed");
        }
    }
}

impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl bloop::abi::types::Host for HostState {}
impl bloop::abi::media::Host for HostState {}

impl bloop::abi::host::Host for HostState {
    fn log(&mut self, level: String, message: String) {
        match level.as_str() {
            "error" => tracing::error!(plugin = %self.plugin_id, "{message}"),
            "warn" => tracing::warn!(plugin = %self.plugin_id, "{message}"),
            "debug" => tracing::debug!(plugin = %self.plugin_id, "{message}"),
            _ => tracing::info!(plugin = %self.plugin_id, "{message}"),
        }
    }

    fn now_ms(&mut self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn http(
        &mut self,
        request: bloop::abi::types::HttpRequest,
    ) -> Result<bloop::abi::types::HttpResponse, bloop::abi::types::Error> {
        self.charge(request.body.as_ref().map(Vec::len).unwrap_or(0))
            .map_err(bloop::abi::types::Error::from)?;
        let mapped = HttpRequest {
            method: request.method,
            url: request.url,
            headers: request
                .headers
                .into_iter()
                .map(|header| (header.name, header.value))
                .collect(),
            body: request.body,
            timeout_ms: request.timeout_ms,
        };
        match self.http.request(&self.permissions, mapped) {
            Ok(response) => Ok(bloop::abi::types::HttpResponse {
                status: response.status,
                headers: response
                    .headers
                    .into_iter()
                    .map(|(name, value)| bloop::abi::types::HttpHeader { name, value })
                    .collect(),
                body: response.body,
            }),
            Err(error) => Err(error.into()),
        }
    }

    fn storage_get(&mut self, key: String) -> Option<String> {
        if assert_storage(&self.permissions).is_err() {
            return None;
        }
        self.storage.lock().get(&self.plugin_id, &key)
    }

    fn storage_set(&mut self, key: String, value: String) -> Result<(), bloop::abi::types::Error> {
        assert_storage(&self.permissions).map_err(Into::<bloop::abi::types::Error>::into)?;
        self.charge(value.len())
            .map_err(Into::<bloop::abi::types::Error>::into)?;
        self.storage.lock().set(&self.plugin_id, &key, value);
        self.persist_storage();
        Ok(())
    }

    fn storage_delete(&mut self, key: String) -> Result<(), bloop::abi::types::Error> {
        assert_storage(&self.permissions).map_err(Into::<bloop::abi::types::Error>::into)?;
        self.storage.lock().delete(&self.plugin_id, &key);
        self.persist_storage();
        Ok(())
    }

    fn storage_list(&mut self) -> Vec<String> {
        if assert_storage(&self.permissions).is_err() {
            return Vec::new();
        }
        self.storage.lock().list(&self.plugin_id)
    }

    fn publish(&mut self, snapshot_json: String) -> Result<(), bloop::abi::types::Error> {
        self.charge(snapshot_json.len())
            .map_err(Into::<bloop::abi::types::Error>::into)?;
        let snapshot =
            ActivitySnapshot::parse_json(&self.plugin_id, &snapshot_json).map_err(|error| {
                tracing::warn!(plugin = %self.plugin_id, %error, "plugin snapshot rejected");
                bloop::abi::types::Error::Configuration(error)
            })?;
        self.activities.publish(snapshot);
        Ok(())
    }

    fn dismiss(&mut self, activity_id: String) -> Result<(), bloop::abi::types::Error> {
        let id = if activity_id.starts_with(&self.plugin_id) {
            activity_id
        } else {
            format!("{}.{activity_id}", self.plugin_id)
        };
        self.activities.dismiss(&id);
        Ok(())
    }

    fn set_timer(&mut self, id: String, interval_ms: u32) {
        self.timers.lock().insert(id, interval_ms.max(250));
    }

    fn clear_timer(&mut self, id: String) {
        self.timers.lock().remove(&id);
    }

    fn get_setting(&mut self, key: String) -> Option<String> {
        self.settings.plugin_setting(&self.plugin_id, &key)
    }

    fn media_sessions(&mut self) -> Vec<bloop::abi::media::MediaSession> {
        if self.require_media().is_err() {
            return Vec::new();
        }
        self.media.sessions().iter().map(to_wit_session).collect()
    }

    fn get_session(&mut self, id: String) -> Option<bloop::abi::media::MediaSession> {
        self.require_media().ok()?;
        self.media.session(&id).as_ref().map(to_wit_session)
    }

    fn media_current(&mut self) -> Option<bloop::abi::media::MediaSession> {
        self.require_media().ok()?;
        self.media.current().as_ref().map(to_wit_session)
    }

    fn media_find(&mut self, query: String) -> Option<bloop::abi::media::MediaSession> {
        self.require_media().ok()?;
        self.media.find(&query).as_ref().map(to_wit_session)
    }

    fn media_watch(&mut self, query: String) -> Result<(), bloop::abi::types::Error> {
        self.require_media()?;
        self.watches.lock().insert(self.plugin_id.clone(), query);
        Ok(())
    }

    fn media_unwatch(&mut self) {
        self.watches.lock().remove(&self.plugin_id);
    }

    fn media_play(&mut self, id: String) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.play(&id).map_err(Into::into)
    }
    fn media_pause(&mut self, id: String) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.pause(&id).map_err(Into::into)
    }
    fn media_toggle(&mut self, id: String) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.toggle(&id).map_err(Into::into)
    }
    fn media_stop(&mut self, id: String) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.stop(&id).map_err(Into::into)
    }
    fn media_next(&mut self, id: String) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.next(&id).map_err(Into::into)
    }
    fn media_previous(&mut self, id: String) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.previous(&id).map_err(Into::into)
    }
    fn media_seek(
        &mut self,
        id: String,
        position_ms: u64,
    ) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.seek(&id, position_ms).map_err(Into::into)
    }
    fn media_set_shuffle(
        &mut self,
        id: String,
        on: bool,
    ) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.set_shuffle(&id, on).map_err(Into::into)
    }
    fn media_set_repeat(
        &mut self,
        id: String,
        mode: bloop::abi::media::RepeatMode,
    ) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media
            .set_repeat(&id, from_wit_repeat(mode))
            .map_err(Into::into)
    }
    fn media_set_rate(&mut self, id: String, rate: f64) -> Result<bool, bloop::abi::types::Error> {
        self.require_media()?;
        self.media.set_rate(&id, rate).map_err(Into::into)
    }
}

fn to_wit_session(session: &MediaSession) -> bloop::abi::media::MediaSession {
    bloop::abi::media::MediaSession {
        id: session.id.clone(),
        app_id: session.app_id.clone(),
        app_name: session.app_name.clone(),
        title: session.title.clone(),
        artist: session.artist.clone(),
        album: session.album.clone(),
        state: match session.state {
            crate::capabilities::PlaybackState::Closed => bloop::abi::media::PlaybackState::Closed,
            crate::capabilities::PlaybackState::Opened => bloop::abi::media::PlaybackState::Opened,
            crate::capabilities::PlaybackState::Changing => {
                bloop::abi::media::PlaybackState::Changing
            }
            crate::capabilities::PlaybackState::Stopped => {
                bloop::abi::media::PlaybackState::Stopped
            }
            crate::capabilities::PlaybackState::Playing => {
                bloop::abi::media::PlaybackState::Playing
            }
            crate::capabilities::PlaybackState::Paused => bloop::abi::media::PlaybackState::Paused,
        },
        position_ms: session.position_ms,
        duration_ms: session.duration_ms,
        last_updated_ms: session.last_updated_ms,
        playback_rate: session.playback_rate,
        shuffle: session.shuffle,
        repeat: match session.repeat {
            RepeatMode::None => bloop::abi::media::RepeatMode::None,
            RepeatMode::Track => bloop::abi::media::RepeatMode::Track,
            RepeatMode::Playlist => bloop::abi::media::RepeatMode::Playlist,
        },
        controls: bloop::abi::media::MediaControls {
            play: session.controls.play,
            pause: session.controls.pause,
            stop: session.controls.stop,
            previous: session.controls.previous,
            next: session.controls.next,
            seek: session.controls.seek,
            shuffle: session.controls.shuffle,
            repeat: session.controls.repeat,
            playback_rate: session.controls.playback_rate,
        },
        has_artwork: session.has_artwork,
    }
}

fn from_wit_repeat(mode: bloop::abi::media::RepeatMode) -> RepeatMode {
    match mode {
        bloop::abi::media::RepeatMode::Track => RepeatMode::Track,
        bloop::abi::media::RepeatMode::Playlist => RepeatMode::Playlist,
        bloop::abi::media::RepeatMode::None => RepeatMode::None,
    }
}

impl From<EngineError> for bloop::abi::types::Error {
    fn from(error: EngineError) -> Self {
        match error {
            EngineError::Permission(message) => Self::Permission(message),
            EngineError::Network(message) => Self::Network(message),
            EngineError::Configuration(message) => Self::Configuration(message),
            EngineError::Compatibility(message) => Self::Compatibility(message),
            EngineError::Unsupported(message) => Self::Unsupported(message),
            EngineError::Plugin(message) | EngineError::Runtime(message) => Self::Runtime(message),
        }
    }
}

pub fn wasm_engine() -> EngineResult<WasmEngine> {
    let mut config = wasmtime::Config::new();
    config.wasm_component_model(true);
    config.epoch_interruption(true);
    config.max_wasm_stack(512 * 1024);
    WasmEngine::new(&config).map_err(|error| EngineError::Runtime(error.to_string()))
}

pub fn start_epoch_thread(engine: WasmEngine) {
    thread::Builder::new()
        .name("bloop-wasm-epoch".into())
        .spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(10));
                engine.increment_epoch();
            }
        })
        .ok();
}

pub fn spawn_activity_plugin(
    engine: WasmEngine,
    record: &PluginRecord,
    http: Arc<HttpService>,
    media: Arc<MediaService>,
    watches: Arc<Mutex<HashMap<String, String>>>,
    storage: Arc<Mutex<NamespacedStore>>,
    settings: Arc<SettingsService>,
    activities: Arc<ActivityService>,
    events: Arc<EventBus>,
    persist_path: Option<PathBuf>,
) -> EngineResult<Sender<PluginCommand>> {
    let component_path = record
        .component_path
        .clone()
        .ok_or_else(|| EngineError::Configuration("missing component".into()))?;
    let (tx, rx) = mpsc::channel();
    let plugin_id = record.id.clone();
    let permissions = record.manifest.permissions.clone();
    let timers = Arc::new(Mutex::new(HashMap::new()));
    let timer_tx = tx.clone();
    let timer_map = timers.clone();
    let timer_plugin = plugin_id.clone();

    thread::Builder::new()
        .name(format!("plugin-{plugin_id}"))
        .spawn(move || {
            if let Err(error) = run_plugin_loop(
                engine,
                component_path,
                plugin_id.clone(),
                permissions,
                http,
                media,
                watches,
                storage,
                settings,
                activities,
                events.clone(),
                timers,
                persist_path,
                rx,
            ) {
                tracing::error!(plugin = %plugin_id, %error, "plugin worker failed");
                events.emit(EngineEvent::PluginError {
                    id: plugin_id,
                    message: error.to_string(),
                });
            }
        })
        .map_err(|error| EngineError::Runtime(error.to_string()))?;

    thread::spawn(move || {
        let mut last = HashMap::<String, Instant>::new();
        loop {
            thread::sleep(Duration::from_millis(100));
            let snapshot: Vec<(String, u32)> = timer_map
                .lock()
                .iter()
                .map(|(id, interval)| (id.clone(), *interval))
                .collect();
            let now = Instant::now();
            for (id, interval) in snapshot {
                let Some(fired) = last.get(&id).copied() else {
                    last.insert(id, now);
                    continue;
                };
                if now.duration_since(fired) >= Duration::from_millis(u64::from(interval)) {
                    last.insert(id.clone(), now);
                    if timer_tx.send(PluginCommand::Timer { id }).is_err() {
                        tracing::debug!(plugin = %timer_plugin, "timer thread exiting");
                        return;
                    }
                }
            }
        }
    });

    Ok(tx)
}

fn run_plugin_loop(
    engine: WasmEngine,
    component_path: std::path::PathBuf,
    plugin_id: String,
    permissions: Permissions,
    http: Arc<HttpService>,
    media: Arc<MediaService>,
    watches: Arc<Mutex<HashMap<String, String>>>,
    storage: Arc<Mutex<NamespacedStore>>,
    settings: Arc<SettingsService>,
    activities: Arc<ActivityService>,
    events: Arc<EventBus>,
    timers: Arc<Mutex<HashMap<String, u32>>>,
    persist_path: Option<PathBuf>,
    rx: Receiver<PluginCommand>,
) -> EngineResult<()> {
    let component = Component::from_file(&engine, &component_path)
        .map_err(|error| EngineError::Runtime(format!("{plugin_id}: {error}")))?;
    let mut linker = Linker::new(&engine);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)
        .map_err(|error| EngineError::Runtime(error.to_string()))?;
    ActivityPlugin::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .map_err(|error| EngineError::Runtime(error.to_string()))?;

    let state = HostState {
        plugin_id: plugin_id.clone(),
        permissions,
        limits: StoreLimitsBuilder::new()
            .memory_size(16 * 1024 * 1024)
            .memories(2)
            .instances(8)
            .tables(8)
            .build(),
        http,
        media,
        watches,
        storage,
        settings,
        activities,
        events: events.clone(),
        timers,
        allocations: 0,
        persist_path,
        wasi: WasiCtxBuilder::new().build(),
        table: ResourceTable::new(),
    };
    let mut store = Store::new(&engine, state);
    store.limiter(|state| &mut state.limits);
    store.set_epoch_deadline(250);

    let bindings = ActivityPlugin::instantiate(&mut store, &component, &linker)
        .map_err(|error| EngineError::Runtime(format!("{plugin_id}: {error}")))?;

    while let Ok(command) = rx.recv() {
        store.set_epoch_deadline(250);
        let result = match command {
            PluginCommand::Initialize => {
                let result = bindings
                    .bloop_abi_activity()
                    .call_initialize(&mut store)
                    .map_err(|error| error.to_string())
                    .and_then(|inner| inner);
                if result.is_ok() {
                    let payload = {
                        let data = store.data();
                        serde_json::to_string(&MediaEvent::SessionsChanged {
                            sessions: data.media.sessions(),
                        })
                        .unwrap_or_else(|_| "{}".into())
                    };
                    let _ = bindings
                        .bloop_abi_activity()
                        .call_on_event(&mut store, "media", &payload);
                }
                result
            }
            PluginCommand::Action { id, payload } => bindings
                .bloop_abi_activity()
                .call_on_action(&mut store, &id, &payload)
                .map_err(|error| error.to_string())
                .and_then(|inner| inner),
            PluginCommand::Timer { id } => bindings
                .bloop_abi_activity()
                .call_on_timer(&mut store, &id)
                .map_err(|error| error.to_string())
                .and_then(|inner| inner),
            PluginCommand::Event { topic, payload } => bindings
                .bloop_abi_activity()
                .call_on_event(&mut store, &topic, &payload)
                .map_err(|error| error.to_string())
                .and_then(|inner| inner),
            PluginCommand::SettingsChanged => bindings
                .bloop_abi_activity()
                .call_on_settings_changed(&mut store)
                .map_err(|error| error.to_string())
                .and_then(|inner| inner),
            PluginCommand::Shutdown => {
                let _ = bindings.bloop_abi_activity().call_shutdown(&mut store);
                break;
            }
        };
        if let Err(error) = result {
            events.emit(EngineEvent::PluginError {
                id: plugin_id.clone(),
                message: error,
            });
        }
    }
    Ok(())
}

pub fn inspect_component(path: &Path) -> EngineResult<()> {
    let engine = wasm_engine()?;
    Component::from_file(&engine, path)
        .map(|_| ())
        .map_err(|error| EngineError::Compatibility(format!("incompatible component: {error}")))
}

#[allow(dead_code)]
fn _resource_any(_: ResourceAny) {}

pub fn validate_activity_manifest(_manifest: &PluginManifest) -> EngineResult<()> {
    Ok(())
}

pub fn event_matches(event: &MediaEvent, query: &str) -> bool {
    match event {
        MediaEvent::SessionsChanged { sessions } => {
            query.is_empty()
                || sessions.is_empty()
                || sessions.iter().any(|session| session.matches_query(query))
        }
        MediaEvent::SessionUpdated { session } => session.matches_query(query),
    }
}
