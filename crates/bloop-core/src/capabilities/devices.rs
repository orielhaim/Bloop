use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Headphones,
    Speaker,
    Keyboard,
    Mouse,
    Controller,
    Phone,
    #[default]
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub kind: DeviceKind,
    pub connected: bool,
    pub paired: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battery: Option<u8>,
}

impl Device {
    /// True when everything that matters for a *metadata* update is identical.
    pub fn same_face(&self, other: &Self) -> bool {
        self.name == other.name
            && self.kind == other.kind
            && self.connected == other.connected
            && self.paired == other.paired
            && self.battery == other.battery
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DeviceEvent {
    Connected { device: Device },
    Disconnected { device: Device },
    Updated { device: Device },
}

/// Raw, un-normalized device feed produced by a native backend.
pub trait DevicesBackend: Send + Sync {
    /// Current known devices (startup enumeration included).
    fn devices(&self) -> Vec<Device>;
}

#[derive(Default)]
pub struct NullDevices;

impl DevicesBackend for NullDevices {
    fn devices(&self) -> Vec<Device> {
        Vec::new()
    }
}

struct PendingTransition {
    id: String,
    connected: bool,
    since: Instant,
}

struct Normalizer {
    /// Whether the initial startup enumeration has established the baseline.
    established: bool,
    /// Latest raw snapshot from the backend, by device id.
    known: HashMap<String, Device>,
    /// Devices the host has told plugins are connected (the emitted connected set).
    confirmed: HashMap<String, Device>,
    /// Connection-state transitions awaiting a stability window.
    pending: Vec<PendingTransition>,
}

impl Default for Normalizer {
    fn default() -> Self {
        Self {
            established: false,
            known: HashMap::new(),
            confirmed: HashMap::new(),
            pending: Vec::new(),
        }
    }
}

pub struct DeviceService {
    backend: Arc<dyn DevicesBackend>,
    listeners: parking_lot::Mutex<Vec<Arc<dyn Fn(DeviceEvent) + Send + Sync>>>,
    state: parking_lot::Mutex<Normalizer>,
    debounce: Duration,
}

impl DeviceService {
    pub fn connect() -> Arc<Self> {
        let slot: Arc<parking_lot::Mutex<Option<Arc<Self>>>> =
            Arc::new(parking_lot::Mutex::new(None));
        let slot_for_backend = slot.clone();
        let backend = crate::capabilities::winbluetooth::start(Arc::new(move |devices| {
            if let Some(service) = slot_for_backend.lock().as_ref() {
                service.emit_snapshot(devices, Instant::now());
            }
        }));
        let service = Arc::new(Self::new(backend));
        *slot.lock() = Some(service.clone());
        service
    }

    pub fn new(backend: Arc<dyn DevicesBackend>) -> Self {
        Self {
            backend,
            listeners: parking_lot::Mutex::new(Vec::new()),
            state: parking_lot::Mutex::new(Normalizer::default()),
            debounce: Duration::from_millis(350),
        }
    }

    pub fn subscribe(&self, listener: impl Fn(DeviceEvent) + Send + Sync + 'static) {
        self.listeners.lock().push(Arc::new(listener));
    }

    pub fn devices(&self) -> Vec<Device> {
        self.backend.devices()
    }

    pub fn emit_snapshot(&self, devices: Vec<Device>, now: Instant) {
        let events = self.normalize(devices, now);
        self.dispatch(events);
    }

    /// Confirm any pending connection transitions that have remained stable.
    pub fn tick(&self, now: Instant) {
        let mut events = Vec::new();
        let mut state = self.state.lock();
        let debounce = self.debounce;
        let mut pending = std::mem::take(&mut state.pending);
        let known = &state.known;
        let confirmed = &state.confirmed;
        let mut connect = Vec::new();
        let mut disconnect = Vec::new();
        pending.retain(|pending| {
            if now.duration_since(pending.since) < debounce {
                return true;
            }
            match known.get(&pending.id) {
                Some(device) if device.connected == pending.connected => {
                    if pending.connected {
                        connect.push(device.clone());
                    } else {
                        disconnect.push(device.clone());
                    }
                    false
                }
                Some(_) => false,
                None if !pending.connected => {
                    let device = confirmed
                        .get(&pending.id)
                        .cloned()
                        .unwrap_or_else(|| pending_device(&pending.id));
                    disconnect.push(device);
                    false
                }
                None => false,
            }
        });
        state.pending = pending;
        for device in connect {
            state.confirmed.insert(device.id.clone(), device.clone());
            events.push(DeviceEvent::Connected { device });
        }
        for device in disconnect {
            state.confirmed.remove(&device.id);
            events.push(DeviceEvent::Disconnected { device });
        }
        drop(state);
        self.dispatch(events);
    }

    fn normalize(&self, devices: Vec<Device>, now: Instant) -> Vec<DeviceEvent> {
        let mut state = self.state.lock();
        let mut events = Vec::new();

        if !state.established {
            // Startup enumeration is a baseline, not a set of connections.
            state.established = true;
            for device in devices {
                state.known.insert(device.id.clone(), device.clone());
                if device.connected {
                    state.confirmed.insert(device.id.clone(), device);
                }
            }
            return events;
        }

        // Reconcile pending transitions against the freshest snapshot so flapping
        // cancels a transition instead of emitting a stale event.
        state.pending.retain(|pending| match devices.iter().find(|d| d.id == pending.id) {
            Some(device) => device.connected == pending.connected,
            None => !pending.connected,
        });

        state.known.clear();
        let ids: HashSet<String> = devices.iter().map(|d| d.id.clone()).collect();
        for device in &devices {
            state.known.insert(device.id.clone(), device.clone());
        }

        for device in &devices {
            match state.confirmed.get(&device.id) {
                Some(existing) => {
                    if existing.connected != device.connected {
                        if device.connected {
                            upsert_pending(&mut state.pending, &device.id, true, now);
                        } else {
                            state.confirmed.remove(&device.id);
                            upsert_pending(&mut state.pending, &device.id, false, now);
                        }
                    } else if !existing.same_face(device) {
                        state.confirmed.insert(device.id.clone(), device.clone());
                        events.push(DeviceEvent::Updated {
                            device: device.clone(),
                        });
                    }
                }
                None => {
                    if device.connected {
                        upsert_pending(&mut state.pending, &device.id, true, now);
                    }
                }
            }
        }

        // Devices that vanished while confirmed-connected are disconnecting.
        let vanished: Vec<Device> = state
            .confirmed
            .values()
            .filter(|device| !ids.contains(&device.id))
            .cloned()
            .collect();
        for device in vanished {
            upsert_pending(&mut state.pending, &device.id, false, now);
        }

        events
    }

    fn dispatch(&self, events: Vec<DeviceEvent>) {
        for event in events {
            for listener in self.listeners.lock().iter() {
                listener(event.clone());
            }
        }
    }
}

fn upsert_pending(pending: &mut Vec<PendingTransition>, id: &str, connected: bool, now: Instant) {
    if !pending
        .iter()
        .any(|entry| entry.id == id && entry.connected == connected)
    {
        pending.push(PendingTransition {
            id: id.to_string(),
            connected,
            since: now,
        });
    }
}

fn pending_device(id: &str) -> Device {
    Device {
        id: id.to_string(),
        name: String::new(),
        kind: DeviceKind::Other,
        connected: false,
        paired: false,
        battery: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(id: &str, connected: bool, battery: Option<u8>) -> Device {
        Device {
            id: id.into(),
            name: format!("Device {id}"),
            kind: DeviceKind::Headphones,
            connected,
            paired: true,
            battery,
        }
    }

    struct FakeDevices {
        current: parking_lot::Mutex<Vec<Device>>,
    }

    impl FakeDevices {
        fn new(devices: Vec<Device>) -> Self {
            Self {
                current: parking_lot::Mutex::new(devices),
            }
        }
    }

    impl DevicesBackend for FakeDevices {
        fn devices(&self) -> Vec<Device> {
            self.current.lock().clone()
        }
    }

    fn service(
        devices: Vec<Device>,
    ) -> (Arc<DeviceService>, Arc<parking_lot::Mutex<Vec<DeviceEvent>>>) {
        let service = Arc::new(DeviceService::new(Arc::new(FakeDevices::new(devices))));
        let seen = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let listener = seen.clone();
        service.subscribe(move |event| listener.lock().push(event));
        (service, seen)
    }

    #[test]
    fn startup_enumeration_is_silent() {
        let (service, seen) = service(vec![device("buds", true, Some(84))]);
        service.emit_snapshot(vec![device("buds", true, Some(84))], Instant::now());
        assert!(seen.lock().is_empty(), "baseline must not emit events");
    }

    #[test]
    fn connection_emits_after_stability_window() {
        let (service, seen) = service(Vec::new());
        let now = Instant::now();
        service.emit_snapshot(Vec::new(), now);
        assert!(seen.lock().is_empty());

        service.emit_snapshot(vec![device("buds", true, None)], now);
        assert!(seen.lock().is_empty(), "connect waits for the debounce window");

        service.tick(now + Duration::from_millis(400));
        let events = seen.lock().clone();
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], DeviceEvent::Connected { device } if device.id == "buds"));
    }

    #[test]
    fn persistent_connection_does_not_retrigger() {
        let (service, seen) = service(Vec::new());
        let now = Instant::now();
        service.emit_snapshot(Vec::new(), now);
        service.emit_snapshot(vec![device("buds", true, None)], now);
        service.emit_snapshot(vec![device("buds", true, None)], now + Duration::from_millis(100));
        service.tick(now + Duration::from_millis(400));
        assert_eq!(seen.lock().len(), 1, "persistent connection emits exactly once");
    }

    #[test]
    fn flapping_connection_suppressed() {
        let (service, seen) = service(Vec::new());
        let now = Instant::now();
        service.emit_snapshot(Vec::new(), now);

        service.emit_snapshot(vec![device("buds", true, None)], now);
        service.emit_snapshot(Vec::new(), now + Duration::from_millis(100));
        service.emit_snapshot(vec![device("buds", true, None)], now + Duration::from_millis(150));
        service.tick(now + Duration::from_millis(400));
        assert!(seen.lock().is_empty(), "flapping must not produce events");

        service.tick(now + Duration::from_millis(600));
        assert_eq!(seen.lock().len(), 1, "a stable connection eventually emits once");
    }

    #[test]
    fn disconnection_emits() {
        let (service, seen) = service(vec![device("buds", true, None)]);
        let now = Instant::now();
        service.emit_snapshot(vec![device("buds", true, None)], now);
        assert!(seen.lock().is_empty());

        service.emit_snapshot(Vec::new(), now);
        service.tick(now + Duration::from_millis(400));
        let events = seen.lock().clone();
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], DeviceEvent::Disconnected { device } if device.id == "buds"));
    }

    #[test]
    fn reconnect_after_disconnect_emits_again() {
        let (service, seen) = service(vec![device("buds", true, None)]);
        let now = Instant::now();
        service.emit_snapshot(vec![device("buds", true, None)], now);
        service.emit_snapshot(Vec::new(), now);
        service.tick(now + Duration::from_millis(400));
        assert_eq!(seen.lock().len(), 1);

        service.emit_snapshot(vec![device("buds", true, None)], now);
        service.tick(now + Duration::from_millis(800));
        assert_eq!(seen.lock().len(), 2);
        assert!(matches!(&seen.lock()[1], DeviceEvent::Connected { .. }));
    }

    #[test]
    fn metadata_update_emits_updated() {
        let (service, seen) = service(vec![device("buds", true, None)]);
        let now = Instant::now();
        service.emit_snapshot(vec![device("buds", true, None)], now);
        assert!(seen.lock().is_empty());

        service.emit_snapshot(vec![device("buds", true, Some(84))], now);
        let events = seen.lock().clone();
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], DeviceEvent::Updated { device } if device.battery == Some(84)));

        // Identical update is a duplicate and is suppressed.
        service.emit_snapshot(vec![device("buds", true, Some(84))], now);
        assert_eq!(seen.lock().len(), 1);
    }

    #[test]
    fn missing_battery_is_not_fabricated() {
        let (service, seen) = service(Vec::new());
        let now = Instant::now();
        service.emit_snapshot(Vec::new(), now);
        service.emit_snapshot(vec![device("buds", true, None)], now);
        service.tick(now + Duration::from_millis(400));
        let events = seen.lock().clone();
        assert!(matches!(
            &events[0],
            DeviceEvent::Connected { device } if device.battery.is_none()
        ));
    }

    #[test]
    fn unconnected_presence_does_not_connect() {
        let (service, seen) = service(Vec::new());
        let now = Instant::now();
        service.emit_snapshot(Vec::new(), now);
        service.emit_snapshot(vec![device("buds", false, None)], now);
        service.tick(now + Duration::from_millis(1000));
        assert!(seen.lock().is_empty());
    }

    /// Exercises the real Windows Bluetooth watcher. Run with
    /// `cargo test -p bloop-core -- --ignored windows_watcher`.
    #[test]
    #[ignore]
    fn windows_watcher_initializes() {
        use windows::core::HSTRING;
        use windows::Devices::Enumeration::DeviceInformation;

        const AQS: &str = "(System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\")";
        const AQS_PAIRED: &str = "(System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\") AND System.Devices.Aep.IsPaired:System.StructuredQueryType.Boolean#True";

        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
        }
        // The full backend property list must be accepted by the watcher.
        let props = crate::capabilities::winbluetooth::property_list(&[
            "System.Devices.Aep.IsPresent",
            "System.Devices.Aep.IsPaired",
            "System.Devices.Aep.ProtocolId",
        ]);
        let result = DeviceInformation::CreateWatcherAqsFilterAndAdditionalProperties(
            &HSTRING::from(AQS),
            &props,
        );
        assert!(result.is_ok(), "watcher with real properties must initialize");

        // The paired-only AQS must also parse.
        let paired = DeviceInformation::CreateWatcherAqsFilterAndAdditionalProperties(
            &HSTRING::from(AQS_PAIRED),
            &props,
        );
        assert!(paired.is_ok(), "paired-only AQS must initialize");
    }

    #[test]
    fn disable_and_reenable_resubscribes() {
        let service = Arc::new(DeviceService::new(Arc::new(FakeDevices::new(Vec::new()))));
        let seen = Arc::new(parking_lot::Mutex::new(0usize));
        let first = seen.clone();
        let second = seen.clone();
        service.subscribe(move |_| *first.lock() += 1);
        service.subscribe(move |_| *second.lock() += 1);
        let now = Instant::now();
        service.emit_snapshot(Vec::new(), now);
        service.emit_snapshot(vec![device("buds", true, None)], now);
        service.tick(now + Duration::from_millis(400));
        assert_eq!(*seen.lock(), 2, "both listeners receive the connect event");
    }
}
