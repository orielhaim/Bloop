use std::collections::HashMap;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use super::{Device, DeviceKind, DevicesBackend};

pub fn start(on_snapshot: Arc<dyn Fn(Vec<Device>) + Send + Sync>) -> Arc<dyn DevicesBackend> {
    #[cfg(windows)]
    {
        WinBluetoothBackend::start(on_snapshot)
    }
    #[cfg(not(windows))]
    {
        let _ = on_snapshot;
        Arc::new(super::NullDevices)
    }
}

/// Bluetooth device backend built on the WinRT DeviceWatcher (AEP) surface.
///
/// The watcher enumerates paired Bluetooth devices (classic + LE). For each
/// known device we attach an authoritative `BluetoothDevice` /
/// `BluetoothLEDevice` connection monitor when the OS allows it; `ConnectionStatus`
/// then drives the connected flag event-first. When the monitor cannot be
/// opened (unpackaged apps can be denied access), presence in the AEP list
/// serves as the fallback connection signal. Raw snapshots are pushed to the
/// device service, which normalizes them into semantic Connected/Disconnected/
/// Updated events with a silent startup baseline. Battery levels are probed
/// through the GATT battery service where Windows exposes them.
#[cfg(windows)]
pub struct WinBluetoothBackend {
    registry: Arc<Mutex<Registry>>,
    _shutdown: Mutex<Option<mpsc::Sender<DeviceOp>>>,
}

#[cfg(windows)]
enum DeviceOp {
    #[allow(dead_code)]
    Shutdown,
}

#[cfg(windows)]
const BT_AQS: &str = "(System.Devices.Aep.ProtocolId:=\"{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}\" OR System.Devices.Aep.ProtocolId:=\"{bb7bb05e-5972-42b5-94fc-76eaa7084d49}\") AND System.Devices.Aep.IsPaired:System.StructuredQueryType.Boolean#True";

#[cfg(windows)]
const LE_PROTOCOL: windows::core::GUID =
    windows::core::GUID::from_u128(0xbb7bb05e_5972_42b5_94fc_76eaa7084d49);
#[cfg(windows)]
const BATTERY_SERVICE: windows::core::GUID =
    windows::core::GUID::from_u128(0x0000180f_0000_1000_8000_00805f9b34fb);
#[cfg(windows)]
const BATTERY_LEVEL: windows::core::GUID =
    windows::core::GUID::from_u128(0x00002a19_0000_1000_8000_00805f9b34fb);

#[cfg(windows)]
const PROP_NAME: &str = "System.Devices.Aep.Name";
#[cfg(windows)]
const PROP_PRESENT: &str = "System.Devices.Aep.IsPresent";
#[cfg(windows)]
const PROP_PAIRED: &str = "System.Devices.Aep.IsPaired";
#[cfg(windows)]
const PROP_PROTOCOL: &str = "System.Devices.Aep.ProtocolId";

#[cfg(windows)]
impl WinBluetoothBackend {
    fn start(on_snapshot: Arc<dyn Fn(Vec<Device>) + Send + Sync>) -> Arc<dyn DevicesBackend> {
        let registry = Arc::new(Mutex::new(Registry::default()));
        let (tx, rx) = mpsc::channel();
        let thread_registry = registry.clone();
        std::thread::Builder::new()
            .name("bloop-devices".into())
            .spawn(move || run_devices_thread(rx, on_snapshot, thread_registry))
            .ok();
        Arc::new(Self {
            registry,
            _shutdown: Mutex::new(Some(tx)),
        })
    }
}

#[cfg(windows)]
impl DevicesBackend for WinBluetoothBackend {
    fn devices(&self) -> Vec<Device> {
        self.registry.lock().snapshot()
    }
}

#[cfg(windows)]
#[derive(Default)]
struct Registry {
    entries: HashMap<String, Entry>,
    completed: bool,
}

#[cfg(windows)]
#[derive(Default, Clone)]
struct Entry {
    id: String,
    name: String,
    kind: DeviceKind,
    present: bool,
    paired: bool,
    battery: Option<u8>,
    probing: bool,
    /// Authoritative connection state once a ConnectionStatus monitor is attached.
    connected: bool,
    monitored: bool,
}

#[cfg(windows)]
impl Registry {
    fn snapshot(&self) -> Vec<Device> {
        self.entries
            .values()
            .map(|entry| Device {
                id: entry.id.clone(),
                name: entry.name.clone(),
                kind: entry.kind,
                connected: if entry.monitored {
                    entry.connected
                } else {
                    entry.present && entry.paired
                },
                paired: entry.paired,
                battery: entry.battery,
            })
            .collect()
    }

    fn set_connected(&mut self, id: &str, connected: bool) {
        if let Some(entry) = self.entries.get_mut(id) {
            entry.connected = connected;
            entry.monitored = true;
        }
    }

    fn update_battery(&mut self, id: &str, level: u8) -> bool {
        let Some(entry) = self.entries.get_mut(id) else {
            return false;
        };
        entry.probing = false;
        if entry.battery != Some(level) {
            entry.battery = Some(level);
            true
        } else {
            false
        }
    }
}

#[cfg(windows)]
fn run_devices_thread(
    rx: mpsc::Receiver<DeviceOp>,
    on_snapshot: Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    registry: Arc<Mutex<Registry>>,
) {
    use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let started = Instant::now();
    let monitors: Arc<Mutex<HashMap<String, ConnectionMonitor>>> =
        Arc::new(Mutex::new(HashMap::new()));
    if let Err(error) = setup_watcher(&on_snapshot, &registry, &monitors) {
        tracing::error!(%error, "failed to initialize bluetooth watcher");
    }
    pump_messages(rx, &on_snapshot, &registry, started);
    unsafe {
        CoUninitialize();
    }
}

#[cfg(windows)]
fn setup_watcher(
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    registry: &Arc<Mutex<Registry>>,
    monitors: &Arc<Mutex<HashMap<String, ConnectionMonitor>>>,
) -> Result<(), String> {
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Foundation::TypedEventHandler;

    // The friendly name is always available via DeviceInformation::Name, so it
    // is intentionally not requested here (it cannot be resolved as an AEP
    // additional property key on all systems).
    let props = property_list(&[PROP_PRESENT, PROP_PAIRED, PROP_PROTOCOL]);
    let watcher = DeviceInformation::CreateWatcherAqsFilterAndAdditionalProperties(
        &windows::core::HSTRING::from(BT_AQS),
        &props,
    )
    .map_err(|error| error.to_string())?;

    let on_added = on_snapshot.clone();
    let reg_added = registry.clone();
    let mon_added = monitors.clone();
    let _ = watcher.Added(&TypedEventHandler::new(move |_, info| {
        if let Some(info) = &*info {
            handle_added(info, &on_added, &reg_added, &mon_added);
        }
        Ok(())
    }));

    let on_updated = on_snapshot.clone();
    let reg_updated = registry.clone();
    let mon_updated = monitors.clone();
    let _ = watcher.Updated(&TypedEventHandler::new(move |_, update| {
        if let Some(update) = &*update {
            handle_updated(update, &on_updated, &reg_updated, &mon_updated);
        }
        Ok(())
    }));

    let on_removed = on_snapshot.clone();
    let reg_removed = registry.clone();
    let _ = watcher.Removed(&TypedEventHandler::new(move |_, update| {
        if let Some(update) = &*update {
            handle_removed(update, &on_removed, &reg_removed);
        }
        Ok(())
    }));

    let on_completed = on_snapshot.clone();
    let reg_completed = registry.clone();
    let _ = watcher.EnumerationCompleted(&TypedEventHandler::new(move |_, _| {
        {
            let mut reg = reg_completed.lock();
            reg.completed = true;
        }
        emit_flush(&reg_completed, &on_completed);
        Ok(())
    }));

    watcher.Start().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn handle_added(
    info: &windows::Devices::Enumeration::DeviceInformation,
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    registry: &Arc<Mutex<Registry>>,
    monitors: &Arc<Mutex<HashMap<String, ConnectionMonitor>>>,
) {
    let Ok(id) = info.Id() else {
        return;
    };
    let id = id.to_string();
    let name = info
        .Name()
        .map(|name| name.to_string())
        .unwrap_or_else(|_| id.clone());
    let props = match info.Properties() {
        Ok(props) => props,
        Err(_) => return,
    };
    let is_le = prop_guid(&props, PROP_PROTOCOL).is_some_and(|guid| guid == LE_PROTOCOL);
    let kind = classify_kind(&name);

    let probe = {
        let mut reg = registry.lock();
        let existing = reg.entries.get(&id).cloned();
        let entry = reg
            .entries
            .entry(id.clone())
            .or_insert_with(|| Entry {
                id: id.clone(),
                ..Entry::default()
            });
        // The query only returns paired devices, so a missing IsPaired property
        // preserves the previous state and defaults to paired.
        entry.name = name;
        entry.kind = kind;
        entry.paired = prop_bool(&props, PROP_PAIRED)
            .unwrap_or_else(|| existing.as_ref().map(|e| e.paired).unwrap_or(true));
        entry.present = prop_bool(&props, PROP_PRESENT)
            .unwrap_or_else(|| existing.as_ref().map(|e| e.present).unwrap_or(true));
        let should_probe = is_le && !entry.probing && entry.battery.is_none();
        if should_probe {
            entry.probing = true;
        }
        should_probe
    };
    if probe {
        spawn_battery_probe(id.clone(), registry.clone(), on_snapshot.clone());
    }
    attach_connection_monitor(&id, registry, on_snapshot, monitors);
    emit_flush(registry, on_snapshot);
}

#[cfg(windows)]
fn handle_updated(
    update: &windows::Devices::Enumeration::DeviceInformationUpdate,
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    registry: &Arc<Mutex<Registry>>,
    monitors: &Arc<Mutex<HashMap<String, ConnectionMonitor>>>,
) {
    let Ok(id) = update.Id() else {
        return;
    };
    let id = id.to_string();
    let Ok(props) = update.Properties() else {
        return;
    };
    let became_present = {
        let mut reg = registry.lock();
        let existing = reg.entries.get(&id).cloned();
        let entry = reg
            .entries
            .entry(id.clone())
            .or_insert_with(|| Entry {
                id: id.clone(),
                ..Entry::default()
            });
        if let Some(name) = prop_string(&props, PROP_NAME) {
            entry.name = name;
            entry.kind = classify_kind(&entry.name);
        }
        if let Some(paired) = prop_bool(&props, PROP_PAIRED) {
            entry.paired = paired || existing.as_ref().is_some_and(|e| e.paired);
        }
        let present = prop_bool(&props, PROP_PRESENT);
        let became_present = present == Some(true) && !entry.present;
        if let Some(present) = present {
            entry.present = present;
        }
        became_present
    };
    if became_present {
        attach_connection_monitor(&id, registry, on_snapshot, monitors);
    }
    emit_flush(registry, on_snapshot);
}

#[cfg(windows)]
fn handle_removed(
    update: &windows::Devices::Enumeration::DeviceInformationUpdate,
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    registry: &Arc<Mutex<Registry>>,
) {
    let Ok(id) = update.Id() else {
        return;
    };
    {
        let mut reg = registry.lock();
        reg.entries.remove(&id.to_string());
    }
    emit_flush(registry, on_snapshot);
}

/// Attach an authoritative connection monitor for a paired device. The monitor
/// subscribes to ConnectionStatusChanged and drives the connected flag. When the
/// handle cannot be opened (unpackaged access is denied on some systems) the
/// device keeps using the AEP presence heuristic instead.
#[cfg(windows)]
fn attach_connection_monitor(
    id: &str,
    registry: &Arc<Mutex<Registry>>,
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    monitors: &Arc<Mutex<HashMap<String, ConnectionMonitor>>>,
) {
    use windows::core::HSTRING;
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
    use windows::Foundation::TypedEventHandler;

    if monitors.lock().contains_key(id) {
        return;
    }
    let hstring = HSTRING::from(id);
    if id.starts_with("BluetoothLE#") {
        let Ok(device) = BluetoothLEDevice::FromIdAsync(&hstring).and_then(|op| op.join()) else {
            return;
        };
        let reg = registry.clone();
        let snap = on_snapshot.clone();
        let dev_id = id.to_string();
        let handler = TypedEventHandler::new(
            move |sender: windows::core::Ref<BluetoothLEDevice>,
                  _: windows::core::Ref<windows::core::IInspectable>| {
                let connected = sender
                    .as_ref()
                    .and_then(|device| device.ConnectionStatus().ok())
                    == Some(BluetoothConnectionStatus::Connected);
                reg.lock().set_connected(&dev_id, connected);
                emit_flush(&reg, &snap);
                Ok(())
            },
        );
        let Ok(status) = device.ConnectionStatus() else {
            return;
        };
        let Ok(token) = device.ConnectionStatusChanged(&handler) else {
            return;
        };
        registry
            .lock()
            .set_connected(id, status == BluetoothConnectionStatus::Connected);
        emit_flush(registry, on_snapshot);
        monitors.lock().insert(
            id.to_string(),
            ConnectionMonitor::Ble(BleMonitor {
                _device: device,
                _handler: handler,
                _token: token,
            }),
        );
    } else {
        let Ok(device) = BluetoothDevice::FromIdAsync(&hstring).and_then(|op| op.join()) else {
            return;
        };
        let reg = registry.clone();
        let snap = on_snapshot.clone();
        let dev_id = id.to_string();
        let handler = TypedEventHandler::new(
            move |sender: windows::core::Ref<BluetoothDevice>,
                  _: windows::core::Ref<windows::core::IInspectable>| {
                let connected = sender
                    .as_ref()
                    .and_then(|device| device.ConnectionStatus().ok())
                    == Some(BluetoothConnectionStatus::Connected);
                reg.lock().set_connected(&dev_id, connected);
                emit_flush(&reg, &snap);
                Ok(())
            },
        );
        let Ok(status) = device.ConnectionStatus() else {
            return;
        };
        let Ok(token) = device.ConnectionStatusChanged(&handler) else {
            return;
        };
        registry
            .lock()
            .set_connected(id, status == BluetoothConnectionStatus::Connected);
        emit_flush(registry, on_snapshot);
        monitors.lock().insert(
            id.to_string(),
            ConnectionMonitor::Classic(ClassicMonitor {
                _device: device,
                _handler: handler,
                _token: token,
            }),
        );
    }
}

#[cfg(windows)]
#[allow(dead_code)]
enum ConnectionMonitor {
    Classic(ClassicMonitor),
    Ble(BleMonitor),
}

#[cfg(windows)]
struct ClassicMonitor {
    #[allow(dead_code)]
    _device: windows::Devices::Bluetooth::BluetoothDevice,
    #[allow(dead_code)]
    _handler:
        windows::Foundation::TypedEventHandler<windows::Devices::Bluetooth::BluetoothDevice, windows::core::IInspectable>,
    #[allow(dead_code)]
    _token: i64,
}

#[cfg(windows)]
struct BleMonitor {
    #[allow(dead_code)]
    _device: windows::Devices::Bluetooth::BluetoothLEDevice,
    #[allow(dead_code)]
    _handler:
        windows::Foundation::TypedEventHandler<windows::Devices::Bluetooth::BluetoothLEDevice, windows::core::IInspectable>,
    #[allow(dead_code)]
    _token: i64,
}

// The connection monitors live and die on the single watcher thread; the COM
// handles and delegates are never shared across threads.
#[cfg(windows)]
unsafe impl Send for ClassicMonitor {}
#[cfg(windows)]
unsafe impl Send for BleMonitor {}

#[cfg(windows)]
fn emit_flush(
    registry: &Arc<Mutex<Registry>>,
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
) {
    let devices = {
        let reg = registry.lock();
        if !reg.completed {
            return;
        }
        reg.snapshot()
    };
    on_snapshot(devices);
}

/// Best-effort GATT battery probe. Runs on its own MTA thread because WinRT
/// async calls need an apartment; failures degrade to "no battery" silently.
#[cfg(windows)]
fn spawn_battery_probe(
    id: String,
    registry: Arc<Mutex<Registry>>,
    on_snapshot: Arc<dyn Fn(Vec<Device>) + Send + Sync>,
) {
    std::thread::Builder::new()
        .name("bloop-battery".into())
        .spawn(move || {
            use windows::Devices::Bluetooth::BluetoothLEDevice;
            use windows::Devices::Bluetooth::GenericAttributeProfile::GattCommunicationStatus;
            use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let level = (|| {
                let device = BluetoothLEDevice::FromIdAsync(&windows::core::HSTRING::from(&id))
                    .ok()?
                    .join()
                    .ok()?;
                let result = device.GetGattServicesAsync().ok()?.join().ok()?;
                if result.Status().ok()? != GattCommunicationStatus::Success {
                    return None;
                }
                let services = result.Services().ok()?;
                let count = services.Size().ok()?;
                for index in 0..count {
                    let service = services.GetAt(index).ok()?;
                    if service.Uuid().ok()? != BATTERY_SERVICE {
                        continue;
                    }
                    let characteristics = service.GetCharacteristics(BATTERY_LEVEL).ok()?;
                    let char_count = characteristics.Size().ok()?;
                    for char_index in 0..char_count {
                        let characteristic = characteristics.GetAt(char_index).ok()?;
                        let read = characteristic.ReadValueAsync().ok()?.join().ok()?;
                        if read.Status().ok()? == GattCommunicationStatus::Success {
                            let buffer = read.Value().ok()?;
                            return read_buffer_byte(&buffer);
                        }
                    }
                }
                None
            })();
            unsafe {
                CoUninitialize();
            }
            if let Some(level) = level {
                let changed = registry.lock().update_battery(&id, level);
                if changed {
                    emit_flush(&registry, &on_snapshot);
                }
            } else {
                let mut reg = registry.lock();
                if let Some(entry) = reg.entries.get_mut(&id) {
                    entry.probing = false;
                }
            }
        })
        .ok();
}

#[cfg(windows)]
fn read_buffer_byte(buffer: &windows::Storage::Streams::IBuffer) -> Option<u8> {
    let reader = windows::Storage::Streams::DataReader::FromBuffer(buffer).ok()?;
    reader.ReadByte().ok()
}

#[cfg(windows)]
fn prop_string(
    props: &windows_collections::IMapView<windows::core::HSTRING, windows::core::IInspectable>,
    key: &str,
) -> Option<String> {
    use windows::core::Interface;
    let value = props.Lookup(&windows::core::HSTRING::from(key)).ok()?;
    let reference = value
        .cast::<windows::Foundation::IReference<windows::core::HSTRING>>()
        .ok()?;
    Some(reference.Value().ok()?.to_string())
}

#[cfg(windows)]
fn prop_bool(
    props: &windows_collections::IMapView<windows::core::HSTRING, windows::core::IInspectable>,
    key: &str,
) -> Option<bool> {
    use windows::core::Interface;
    let value = props.Lookup(&windows::core::HSTRING::from(key)).ok()?;
    let reference = value
        .cast::<windows::Foundation::IReference<bool>>()
        .ok()?;
    reference.Value().ok()
}

#[cfg(windows)]
fn prop_guid(
    props: &windows_collections::IMapView<windows::core::HSTRING, windows::core::IInspectable>,
    key: &str,
) -> Option<windows::core::GUID> {
    use windows::core::Interface;
    let value = props.Lookup(&windows::core::HSTRING::from(key)).ok()?;
    let reference = value
        .cast::<windows::Foundation::IReference<windows::core::GUID>>()
        .ok()?;
    reference.Value().ok()
}

#[cfg(windows)]
fn classify_kind(name: &str) -> DeviceKind {
    let name = name.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| name.contains(needle));
    if has(&["headphone", "headset", "earbud", "earphone", " buds", "buds"]) {
        DeviceKind::Headphones
    } else if has(&["speaker", "soundbar", "sound bar"]) {
        DeviceKind::Speaker
    } else if has(&["keyboard"]) {
        DeviceKind::Keyboard
    } else if has(&["mouse", "trackpad"]) {
        DeviceKind::Mouse
    } else if has(&["controller", "gamepad", "joy-con", "dualshock", "xbox"]) {
        DeviceKind::Controller
    } else if has(&["phone", "iphone", "pixel", "galaxy"]) {
        DeviceKind::Phone
    } else {
        DeviceKind::Other
    }
}

#[cfg(windows)]
fn pump_messages(
    rx: mpsc::Receiver<DeviceOp>,
    on_snapshot: &Arc<dyn Fn(Vec<Device>) + Send + Sync>,
    registry: &Arc<Mutex<Registry>>,
    started: Instant,
) {
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PM_REMOVE, PeekMessageW, TranslateMessage, WM_QUIT,
    };
    let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
    loop {
        let mut quit = false;
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() } {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if msg.message == WM_QUIT {
                quit = true;
            }
        }
        if quit {
            return;
        }
        // If the initial enumeration never reports completion, seed the
        // baseline after a generous window so the watcher is never silent.
        if started.elapsed() > Duration::from_secs(5) {
            let mut reg = registry.lock();
            if !reg.completed {
                reg.completed = true;
                drop(reg);
                emit_flush(registry, on_snapshot);
            }
        }
        match rx.try_recv() {
            Ok(DeviceOp::Shutdown) | Err(mpsc::TryRecvError::Disconnected) => return,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Minimal in-memory `IVector<HSTRING>` used to request AEP properties from the
/// DeviceWatcher. The watcher iterates it; `GetView` is never called.
#[cfg(windows)]
#[windows::core::implement(
    windows_collections::IVector<windows::core::HSTRING>,
    windows_collections::IIterable<windows::core::HSTRING>
)]
struct StringList {
    items: Mutex<Vec<windows::core::HSTRING>>,
}

/// Build an `IVector<HSTRING>` of AEP property names (used by tests too).
#[cfg(windows)]
pub fn property_list(props: &[&str]) -> windows_collections::IVector<windows::core::HSTRING> {
    let items: Vec<windows::core::HSTRING> = props
        .iter()
        .map(|prop| windows::core::HSTRING::from(*prop))
        .collect();
    StringList {
        items: Mutex::new(items),
    }
    .into()
}

#[cfg(windows)]
impl windows_collections::IVector_Impl<windows::core::HSTRING> for StringList_Impl {
    fn GetAt(&self, index: u32) -> windows::core::Result<windows::core::HSTRING> {
        self.items
            .lock()
            .get(index as usize)
            .cloned()
            .ok_or_else(bounds_error)
    }

    fn Size(&self) -> windows::core::Result<u32> {
        Ok(self.items.lock().len() as u32)
    }

    fn GetView(
        &self,
    ) -> windows::core::Result<windows_collections::IVectorView<windows::core::HSTRING>> {
        Err(not_impl_error())
    }

    fn IndexOf(
        &self,
        value: windows::core::Ref<windows::core::HSTRING>,
        index: &mut u32,
    ) -> windows::core::Result<bool> {
        let items = self.items.lock();
        match items.iter().position(|item| *item == *value) {
            Some(found) => {
                *index = found as u32;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn SetAt(&self, index: u32, value: windows::core::Ref<windows::core::HSTRING>) -> windows::core::Result<()> {
        let mut items = self.items.lock();
        let index = index as usize;
        if index >= items.len() {
            return Err(bounds_error());
        }
        items[index] = (*value).clone();
        Ok(())
    }

    fn InsertAt(&self, index: u32, value: windows::core::Ref<windows::core::HSTRING>) -> windows::core::Result<()> {
        let mut items = self.items.lock();
        let index = (index as usize).min(items.len());
        items.insert(index, (*value).clone());
        Ok(())
    }

    fn RemoveAt(&self, index: u32) -> windows::core::Result<()> {
        let mut items = self.items.lock();
        if (index as usize) >= items.len() {
            return Err(bounds_error());
        }
        items.remove(index as usize);
        Ok(())
    }

    fn Append(&self, value: windows::core::Ref<windows::core::HSTRING>) -> windows::core::Result<()> {
        self.items.lock().push((*value).clone());
        Ok(())
    }

    fn RemoveAtEnd(&self) -> windows::core::Result<()> {
        self.items.lock().pop();
        Ok(())
    }

    fn Clear(&self) -> windows::core::Result<()> {
        self.items.lock().clear();
        Ok(())
    }

    fn GetMany(
        &self,
        start_index: u32,
        items: &mut [windows::core::HSTRING],
    ) -> windows::core::Result<u32> {
        let all = self.items.lock();
        let start = start_index as usize;
        let count = all.len().saturating_sub(start).min(items.len());
        for (offset, slot) in items.iter_mut().enumerate().take(count) {
            *slot = all[start + offset].clone();
        }
        Ok(count as u32)
    }

    fn ReplaceAll(&self, values: &[windows::core::HSTRING]) -> windows::core::Result<()> {
        let mut items = self.items.lock();
        items.clear();
        items.extend(values.iter().cloned());
        Ok(())
    }
}

#[cfg(windows)]
impl windows_collections::IIterable_Impl<windows::core::HSTRING> for StringList_Impl {
    fn First(
        &self,
    ) -> windows::core::Result<windows_collections::IIterator<windows::core::HSTRING>> {
        use windows::core::IUnknownImpl;
        Ok(windows::core::ComObject::new(StringIterator {
            owner: self.to_object(),
            current: std::sync::atomic::AtomicUsize::new(0),
        })
        .into_interface())
    }
}

#[cfg(windows)]
#[windows::core::implement(windows_collections::IIterator<windows::core::HSTRING>)]
struct StringIterator {
    owner: windows::core::ComObject<StringList>,
    current: std::sync::atomic::AtomicUsize,
}

#[cfg(windows)]
impl windows_collections::IIterator_Impl<windows::core::HSTRING> for StringIterator_Impl {
    fn Current(&self) -> windows::core::Result<windows::core::HSTRING> {
        self.owner
            .items
            .lock()
            .get(self.current.load(std::sync::atomic::Ordering::Relaxed))
            .cloned()
            .ok_or_else(bounds_error)
    }

    fn HasCurrent(&self) -> windows::core::Result<bool> {
        Ok(self.current.load(std::sync::atomic::Ordering::Relaxed)
            < self.owner.items.lock().len())
    }

    fn MoveNext(&self) -> windows::core::Result<bool> {
        self.current.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(self.current.load(std::sync::atomic::Ordering::Relaxed)
            < self.owner.items.lock().len())
    }

    fn GetMany(&self, items: &mut [windows::core::HSTRING]) -> windows::core::Result<u32> {
        let all = self.owner.items.lock();
        let current = self.current.load(std::sync::atomic::Ordering::Relaxed);
        let count = all.len().saturating_sub(current).min(items.len());
        for (offset, slot) in items.iter_mut().enumerate().take(count) {
            *slot = all[current + offset].clone();
        }
        self.current.fetch_add(count, std::sync::atomic::Ordering::Relaxed);
        Ok(count as u32)
    }
}

#[cfg(windows)]
fn bounds_error() -> windows::core::Error {
    windows::core::Error::from_hresult(windows::core::HRESULT(0x8000_000B_u32 as i32))
}

#[cfg(windows)]
fn not_impl_error() -> windows::core::Error {
    windows::core::Error::from_hresult(windows::core::HRESULT(0x8000_4001_u32 as i32))
}
