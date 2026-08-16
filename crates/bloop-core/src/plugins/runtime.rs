use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{Receiver, Sender, bounded, select};
use parking_lot::Mutex;
use wasmtime::component::{Component, HasSelf, Linker, ResourceTable};
use wasmtime::{Engine as WasmEngine, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

use super::manifest::Permissions;
use super::package::{PluginRecord, PluginStore};
use super::permissions::{assert_audio, assert_devices, assert_media, assert_storage};
use super::watches::{Capability, WatchRegistry};
use crate::activity::{ActivityService, ActivitySnapshot};
use crate::capabilities::{
    AudioDevice, AudioDeviceMetadata, AudioEvent, AudioService, Device, DeviceEvent, DeviceKind,
    DeviceService, HttpRequest, HttpService, MediaEvent, MediaService, MediaSession, RepeatMode,
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
    SettingsChanged,
    Shutdown,
}

/// Handle to a running plugin worker. Control commands travel over a bounded
/// channel; typed capability events are delivered through a coalescing inbox
/// that keeps only the latest event per capability so a slow plugin cannot
/// accumulate unbounded snapshots.
#[derive(Clone)]
pub struct WorkerHandle {
    pub control: Sender<PluginCommand>,
    inbox: Arc<EventInbox>,
}

impl WorkerHandle {
    pub fn post_event(&self, event: bloop::abi::capability::CapabilityEvent) {
        self.inbox.post(event);
    }
}

/// Latest-wins per-capability event delivery.
struct EventInbox {
    latest: parking_lot::Mutex<HashMap<Capability, bloop::abi::capability::CapabilityEvent>>,
    signal: Sender<()>,
}

impl EventInbox {
    fn new() -> (Arc<Self>, Receiver<()>) {
        let (signal, wake) = bounded(1);
        (
            Arc::new(Self {
                latest: parking_lot::Mutex::new(HashMap::new()),
                signal,
            }),
            wake,
        )
    }

    fn post(&self, event: bloop::abi::capability::CapabilityEvent) {
        self.latest.lock().insert(event_capability(&event), event);
        // At most one wakeup is queued; if one is already pending the worker
        // will drain the latest state when it wakes.
        let _ = self.signal.try_send(());
    }

    fn drain(&self) -> Vec<bloop::abi::capability::CapabilityEvent> {
        std::mem::take(&mut *self.latest.lock())
            .into_values()
            .collect()
    }
}

fn event_capability(event: &bloop::abi::capability::CapabilityEvent) -> Capability {
    match event {
        bloop::abi::capability::CapabilityEvent::Media(_) => Capability::Media,
        bloop::abi::capability::CapabilityEvent::Audio(_) => Capability::Audio,
        bloop::abi::capability::CapabilityEvent::Devices(_) => Capability::Devices,
    }
}

pub struct HostState {
    pub plugin_id: String,
    pub permissions: Permissions,
    pub limits: StoreLimits,
    pub http: Arc<HttpService>,
    pub media: Arc<MediaService>,
    pub audio: Arc<AudioService>,
    pub devices: Arc<DeviceService>,
    pub watches: Arc<WatchRegistry>,
    pub storage: Arc<PluginStore>,
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

    fn require_audio(&self) -> Result<(), bloop::abi::types::Error> {
        assert_audio(&self.permissions).map_err(Into::into)
    }

    fn require_devices(&self) -> Result<(), bloop::abi::types::Error> {
        assert_devices(&self.permissions).map_err(Into::into)
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
impl bloop::abi::audio::Host for HostState {}
impl bloop::abi::devices::Host for HostState {}
impl bloop::abi::capability::Host for HostState {}

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
        self.storage.get(&self.plugin_id, &key)
    }

    fn storage_set(&mut self, key: String, value: String) -> Result<(), bloop::abi::types::Error> {
        assert_storage(&self.permissions).map_err(Into::<bloop::abi::types::Error>::into)?;
        self.charge(value.len())
            .map_err(Into::<bloop::abi::types::Error>::into)?;
        self.storage
            .set(&self.plugin_id, &key, value)
            .map_err(Into::<bloop::abi::types::Error>::into)
    }

    fn storage_delete(&mut self, key: String) -> Result<(), bloop::abi::types::Error> {
        assert_storage(&self.permissions).map_err(Into::<bloop::abi::types::Error>::into)?;
        self.storage
            .delete(&self.plugin_id, &key)
            .map_err(Into::<bloop::abi::types::Error>::into)
    }

    fn storage_list(&mut self) -> Vec<String> {
        if assert_storage(&self.permissions).is_err() {
            return Vec::new();
        }
        self.storage.list(&self.plugin_id)
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

    fn watch(
        &mut self,
        capability: bloop::abi::capability::Capability,
        filter: String,
    ) -> Result<(), bloop::abi::types::Error> {
        let capability = match capability {
            bloop::abi::capability::Capability::Media => {
                self.require_media()?;
                Capability::Media
            }
            bloop::abi::capability::Capability::Audio => {
                self.require_audio()?;
                Capability::Audio
            }
            bloop::abi::capability::Capability::Devices => {
                self.require_devices()?;
                Capability::Devices
            }
        };
        self.watches.subscribe(&self.plugin_id, capability, &filter);
        Ok(())
    }

    fn unwatch(&mut self, capability: bloop::abi::capability::Capability) {
        let capability = match capability {
            bloop::abi::capability::Capability::Media => Capability::Media,
            bloop::abi::capability::Capability::Audio => Capability::Audio,
            bloop::abi::capability::Capability::Devices => Capability::Devices,
        };
        self.watches.unsubscribe(&self.plugin_id, capability);
    }

    fn audio_current(&mut self) -> Result<bloop::abi::audio::AudioState, bloop::abi::types::Error> {
        self.require_audio()?;
        let state = self.audio.state();
        let output = self
            .audio
            .output()
            .map(|device| to_wit_audio_device(&device));
        Ok(bloop::abi::audio::AudioState {
            volume: state.volume,
            muted: state.muted,
            output_device: output,
        })
    }

    fn audio_devices(&mut self) -> Vec<bloop::abi::audio::AudioDevice> {
        if self.require_audio().is_err() {
            return Vec::new();
        }
        self.audio
            .devices()
            .iter()
            .map(to_wit_audio_device)
            .collect()
    }

    fn audio_set_volume(&mut self, volume: f32) -> Result<(), bloop::abi::types::Error> {
        self.require_audio()?;
        self.audio.set_volume(volume).map_err(Into::into)
    }

    fn audio_set_mute(&mut self, muted: bool) -> Result<(), bloop::abi::types::Error> {
        self.require_audio()?;
        self.audio.set_mute(muted).map_err(Into::into)
    }

    fn audio_toggle_mute(&mut self) -> Result<(), bloop::abi::types::Error> {
        self.require_audio()?;
        self.audio.toggle_mute().map_err(Into::into)
    }

    fn device_list(&mut self) -> Vec<bloop::abi::devices::Device> {
        if self.require_devices().is_err() {
            return Vec::new();
        }
        self.devices.devices().iter().map(to_wit_device).collect()
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

fn to_wit_audio_device(device: &AudioDevice) -> bloop::abi::audio::AudioDevice {
    bloop::abi::audio::AudioDevice {
        id: device.id.clone(),
        name: device.name.clone(),
        active: device.active,
        metadata: device.metadata.map(|metadata: AudioDeviceMetadata| {
            bloop::abi::audio::AudioDeviceMetadata {
                default: metadata.default,
            }
        }),
    }
}

fn to_wit_device(device: &Device) -> bloop::abi::devices::Device {
    bloop::abi::devices::Device {
        id: device.id.clone(),
        name: device.name.clone(),
        kind: match device.kind {
            DeviceKind::Headphones => bloop::abi::devices::DeviceKind::Headphones,
            DeviceKind::Speaker => bloop::abi::devices::DeviceKind::Speaker,
            DeviceKind::Keyboard => bloop::abi::devices::DeviceKind::Keyboard,
            DeviceKind::Mouse => bloop::abi::devices::DeviceKind::Mouse,
            DeviceKind::Controller => bloop::abi::devices::DeviceKind::Controller,
            DeviceKind::Phone => bloop::abi::devices::DeviceKind::Phone,
            DeviceKind::Other => bloop::abi::devices::DeviceKind::Other,
        },
        connected: device.connected,
        paired: device.paired,
        battery: device.battery,
    }
}

fn to_audio_event(event: &AudioEvent) -> bloop::abi::audio::AudioEvent {
    match event {
        AudioEvent::StateChanged { state, output } => {
            bloop::abi::audio::AudioEvent::StateChanged(bloop::abi::audio::AudioState {
                volume: state.volume,
                muted: state.muted,
                output_device: output.as_ref().map(to_wit_audio_device),
            })
        }
        AudioEvent::DeviceChanged { device } => {
            bloop::abi::audio::AudioEvent::DeviceChanged(to_wit_audio_device(device))
        }
    }
}

fn to_device_event(event: &DeviceEvent) -> bloop::abi::devices::DeviceEvent {
    match event {
        DeviceEvent::Connected { device } => {
            bloop::abi::devices::DeviceEvent::Connected(to_wit_device(device))
        }
        DeviceEvent::Disconnected { device } => {
            bloop::abi::devices::DeviceEvent::Disconnected(to_wit_device(device))
        }
        DeviceEvent::Updated { device } => {
            bloop::abi::devices::DeviceEvent::Updated(to_wit_device(device))
        }
    }
}

fn to_media_event(event: &MediaEvent) -> bloop::abi::media::MediaEvent {
    match event {
        MediaEvent::SessionsChanged { sessions } => bloop::abi::media::MediaEvent::SessionsChanged(
            sessions.iter().map(to_wit_session).collect(),
        ),
        MediaEvent::SessionUpdated { session } => {
            bloop::abi::media::MediaEvent::SessionUpdated(to_wit_session(session))
        }
    }
}

fn to_capability_event(event: &MediaEvent) -> bloop::abi::capability::CapabilityEvent {
    bloop::abi::capability::CapabilityEvent::Media(to_media_event(event))
}

/// Typed capability event for a media change.
pub fn media_capability_event(event: &MediaEvent) -> bloop::abi::capability::CapabilityEvent {
    to_capability_event(event)
}

/// Typed capability event for an audio change.
pub fn audio_capability_event(event: &AudioEvent) -> bloop::abi::capability::CapabilityEvent {
    bloop::abi::capability::CapabilityEvent::Audio(to_audio_event(event))
}

/// Typed capability event for a device change.
pub fn devices_capability_event(event: &DeviceEvent) -> bloop::abi::capability::CapabilityEvent {
    bloop::abi::capability::CapabilityEvent::Devices(to_device_event(event))
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
    audio: Arc<AudioService>,
    devices: Arc<DeviceService>,
    watches: Arc<WatchRegistry>,
    storage: Arc<PluginStore>,
    settings: Arc<SettingsService>,
    activities: Arc<ActivityService>,
    events: Arc<EventBus>,
    persist_path: Option<PathBuf>,
) -> EngineResult<WorkerHandle> {
    let component_path = record
        .component_path
        .clone()
        .ok_or_else(|| EngineError::Configuration("missing component".into()))?;
    let (control_tx, control_rx) = bounded(64);
    let (inbox, wake) = EventInbox::new();
    let plugin_id = record.id.clone();
    let permissions = record.manifest.permissions.clone();
    let timers = Arc::new(Mutex::new(HashMap::new()));
    let inbox_for_thread = inbox.clone();

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
                audio,
                devices,
                watches,
                storage,
                settings,
                activities,
                events.clone(),
                timers,
                persist_path,
                control_rx,
                wake,
                inbox_for_thread,
            ) {
                tracing::error!(plugin = %plugin_id, %error, "plugin worker failed");
                events.emit(EngineEvent::PluginError {
                    id: plugin_id,
                    message: error.to_string(),
                });
            }
        })
        .map_err(|error| EngineError::Runtime(error.to_string()))?;

    Ok(WorkerHandle {
        control: control_tx,
        inbox,
    })
}

fn run_plugin_loop(
    engine: WasmEngine,
    component_path: std::path::PathBuf,
    plugin_id: String,
    permissions: Permissions,
    http: Arc<HttpService>,
    media: Arc<MediaService>,
    audio: Arc<AudioService>,
    devices: Arc<DeviceService>,
    watches: Arc<WatchRegistry>,
    storage: Arc<PluginStore>,
    settings: Arc<SettingsService>,
    activities: Arc<ActivityService>,
    events: Arc<EventBus>,
    timers: Arc<Mutex<HashMap<String, u32>>>,
    persist_path: Option<PathBuf>,
    control_rx: Receiver<PluginCommand>,
    wake: Receiver<()>,
    inbox: Arc<EventInbox>,
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
        audio,
        devices,
        watches,
        storage,
        settings,
        activities,
        events: events.clone(),
        timers: timers.clone(),
        allocations: 0,
        persist_path,
        wasi: WasiCtxBuilder::new().build(),
        table: ResourceTable::new(),
    };
    let mut store = Store::new(&engine, state);
    store.limiter(|state| &mut state.limits);
    arm_epoch(&mut store);

    let bindings = ActivityPlugin::instantiate(&mut store, &component, &linker)
        .map_err(|error| EngineError::Runtime(format!("{plugin_id}: {error}")))?;

    // Timers are driven by the worker itself through select! deadlines instead
    // of a per-plugin polling thread, so a plugin with no timers sleeps
    // indefinitely.
    let mut last_fire = HashMap::<String, Instant>::new();

    loop {
        // Drain queued control commands, then the latest per-capability events.
        while let Ok(command) = control_rx.try_recv() {
            if handle_command(&bindings, &mut store, command, &plugin_id, &events) {
                return Ok(());
            }
        }
        for event in inbox.drain() {
            report_guest(
                &plugin_id,
                &events,
                invoke_guest(&mut store, |store| {
                    bindings.bloop_abi_activity().call_on_event(store, &event)
                }),
            );
        }

        let next_deadline = next_timer_deadline(&timers, &last_fire);
        let mut exit = false;
        match next_deadline {
            Some(duration) => {
                let timer = crossbeam_channel::after(duration);
                select! {
                    recv(control_rx) -> message => {
                        if let Ok(command) = message {
                            exit = handle_command(&bindings, &mut store, command, &plugin_id, &events);
                        } else {
                            exit = true;
                        }
                    }
                    recv(wake) -> _ => {}
                    recv(timer) -> _ => {
                        fire_due_timers(&bindings, &mut store, &*timers, &mut last_fire, &plugin_id, &events);
                    }
                }
            }
            None => {
                select! {
                    recv(control_rx) -> message => {
                        if let Ok(command) = message {
                            exit = handle_command(&bindings, &mut store, command, &plugin_id, &events);
                        } else {
                            exit = true;
                        }
                    }
                    recv(wake) -> _ => {}
                }
            }
        }
        if exit {
            return Ok(());
        }
    }
}

/// Time until the next plugin timer should fire, if any are registered.
fn next_timer_deadline(
    timers: &Mutex<HashMap<String, u32>>,
    last_fire: &HashMap<String, Instant>,
) -> Option<Duration> {
    let now = Instant::now();
    timers
        .lock()
        .iter()
        .map(|(id, interval)| {
            let last = last_fire.get(id.as_str()).copied().unwrap_or(now);
            let due = Duration::from_millis(u64::from(*interval));
            due.saturating_sub(now.duration_since(last))
                .max(Duration::from_millis(1))
        })
        .min()
}

/// Fire every plugin timer whose interval has elapsed since its last fire.
fn fire_due_timers(
    bindings: &ActivityPlugin,
    store: &mut Store<HostState>,
    timers: &Mutex<HashMap<String, u32>>,
    last_fire: &mut HashMap<String, Instant>,
    plugin_id: &str,
    events: &Arc<EventBus>,
) {
    let now = Instant::now();
    let due: Vec<String> = timers
        .lock()
        .iter()
        .filter(|(id, interval)| {
            let last = last_fire.get(id.as_str()).copied().unwrap_or(now);
            now.duration_since(last) >= Duration::from_millis(u64::from(**interval))
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in due {
        last_fire.insert(id.clone(), now);
        report_guest(
            plugin_id,
            events,
            invoke_guest(store, |store| {
                bindings.bloop_abi_activity().call_on_timer(store, &id)
            }),
        );
    }
}

/// Runs one control command. Returns `true` when the worker should exit.
fn handle_command(
    bindings: &ActivityPlugin,
    store: &mut Store<HostState>,
    command: PluginCommand,
    plugin_id: &str,
    events: &Arc<EventBus>,
) -> bool {
    let result = match command {
        PluginCommand::Initialize => {
            let result = invoke_guest(store, |store| {
                bindings.bloop_abi_activity().call_initialize(store)
            });
            if result.is_ok() {
                let sessions = store.data().media.sessions();
                let event = to_capability_event(&MediaEvent::SessionsChanged { sessions });
                report_guest(
                    plugin_id,
                    events,
                    invoke_guest(store, |store| {
                        bindings.bloop_abi_activity().call_on_event(store, &event)
                    }),
                );
            }
            result
        }
        PluginCommand::Action { id, payload } => invoke_guest(store, |store| {
            bindings
                .bloop_abi_activity()
                .call_on_action(store, &id, &payload)
        }),
        PluginCommand::SettingsChanged => invoke_guest(store, |store| {
            bindings
                .bloop_abi_activity()
                .call_on_settings_changed(store)
        }),
        PluginCommand::Shutdown => {
            arm_epoch(store);
            let _ = bindings.bloop_abi_activity().call_shutdown(&mut *store);
            return true;
        }
    };
    report_guest(plugin_id, events, result);
    false
}

/// Ticks until a guest call is interrupted. The epoch thread increments every
/// 10ms, so this is a 2.5s budget per invocation — not for the lifetime of the
/// worker. Forgetting to re-arm means every later `on_event` / `on_timer` traps.
const GUEST_EPOCH_TICKS: u64 = 250;

fn arm_epoch(store: &mut Store<HostState>) {
    store.set_epoch_deadline(GUEST_EPOCH_TICKS);
}

fn invoke_guest<E: std::fmt::Display>(
    store: &mut Store<HostState>,
    call: impl FnOnce(&mut Store<HostState>) -> Result<Result<(), String>, E>,
) -> Result<(), String> {
    arm_epoch(store);
    call(store)
        .map_err(|error| error.to_string())
        .and_then(|inner| inner)
}

fn report_guest<T>(plugin_id: &str, events: &Arc<EventBus>, result: Result<T, String>) {
    if let Err(error) = result {
        tracing::error!(plugin = %plugin_id, %error, "plugin guest call failed");
        events.emit(EngineEvent::PluginError {
            id: plugin_id.to_string(),
            message: error,
        });
    }
}

pub fn inspect_component(path: &Path) -> EngineResult<()> {
    let engine = wasm_engine()?;
    Component::from_file(&engine, path)
        .map(|_| ())
        .map_err(|error| EngineError::Compatibility(format!("incompatible component: {error}")))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn audio_event(volume: f32) -> bloop::abi::capability::CapabilityEvent {
        bloop::abi::capability::CapabilityEvent::Audio(bloop::abi::audio::AudioEvent::StateChanged(
            bloop::abi::audio::AudioState {
                volume,
                muted: false,
                output_device: None,
            },
        ))
    }

    fn devices_event() -> bloop::abi::capability::CapabilityEvent {
        bloop::abi::capability::CapabilityEvent::Devices(
            bloop::abi::devices::DeviceEvent::Connected(bloop::abi::devices::Device {
                id: "d1".into(),
                name: "Buds".into(),
                kind: bloop::abi::devices::DeviceKind::Headphones,
                connected: true,
                paired: true,
                battery: None,
            }),
        )
    }

    #[test]
    fn event_inbox_coalesces_latest_per_capability() {
        let (inbox, wake) = EventInbox::new();
        inbox.post(audio_event(1.0));
        inbox.post(audio_event(2.0));
        inbox.post(audio_event(3.0));
        inbox.post(devices_event());

        let drained = inbox.drain();
        assert_eq!(drained.len(), 2, "latest per capability only");
        let audio = drained.iter().find_map(|event| match event {
            bloop::abi::capability::CapabilityEvent::Audio(
                bloop::abi::audio::AudioEvent::StateChanged(state),
            ) => Some(state.volume),
            _ => None,
        });
        assert_eq!(audio, Some(3.0));
        assert!(
            drained
                .iter()
                .any(|event| matches!(event, bloop::abi::capability::CapabilityEvent::Devices(_)))
        );
        assert!(inbox.drain().is_empty(), "drain consumes the slot");

        // A fresh post signals the worker again.
        inbox.post(audio_event(4.0));
        assert!(wake.recv_timeout(Duration::from_millis(200)).is_ok());
    }

    #[test]
    fn event_inbox_signal_is_single_shot() {
        let (inbox, _wake) = EventInbox::new();
        inbox.post(audio_event(1.0));
        inbox.post(audio_event(2.0));
        inbox.post(audio_event(3.0));
        // The wake channel holds at most one wakeup.
        assert_eq!(inbox.signal.len(), 1);
    }

    #[test]
    fn media_event_matches_filters_by_query() {
        let session = crate::capabilities::MediaSession {
            id: "Spotify.exe".into(),
            app_id: "Spotify.exe".into(),
            app_name: "Spotify".into(),
            title: "Track".into(),
            artist: "Artist".into(),
            album: String::new(),
            state: crate::capabilities::PlaybackState::Playing,
            position_ms: 0,
            duration_ms: 0,
            last_updated_ms: 0,
            playback_rate: 1.0,
            shuffle: None,
            repeat: crate::capabilities::RepeatMode::None,
            controls: crate::capabilities::MediaControls::default(),
            has_artwork: false,
        };
        let event = crate::capabilities::MediaEvent::SessionUpdated { session };
        assert!(event_matches(&event, "spotify"));
        assert!(!event_matches(&event, "vlc"));
    }
}
