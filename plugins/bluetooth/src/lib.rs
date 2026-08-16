wit_bindgen::generate!({
    path: "../../wit",
    world: "activity-plugin",
});

use crate::exports::bloop::abi::activity::Guest;
use bloop::abi::capability::CapabilityEvent;
use bloop::abi::devices::{Device, DeviceEvent, DeviceKind};
use bloop_sdk as ui;
use bloop_sdk::Snapshot;
use std::collections::HashMap;
use std::sync::Mutex;

const PLUGIN_ID: &str = "bloop.activity.bluetooth";
const ACTIVITY_ID: &str = "bluetooth";
const COALESCING_KEY: &str = "system-devices";

#[derive(Debug, Clone, Copy, PartialEq)]
struct Settings {
    show_connect: bool,
    show_disconnect: bool,
    show_battery: bool,
    duration_ms: u32,
}

static SETTINGS: Mutex<Settings> = Mutex::new(Settings {
    show_connect: true,
    show_disconnect: true,
    show_battery: true,
    duration_ms: 1800,
});

/// When each device was last announced as connected, used to avoid surfacing
/// startup/baseline battery reads as fresh presentations.
static ANNOUNCED: std::sync::OnceLock<std::sync::Mutex<HashMap<String, u64>>> =
    std::sync::OnceLock::new();

const ANNOUNCE_WINDOW_MS: u64 = 10_000;

fn announced() -> &'static std::sync::Mutex<HashMap<String, u64>> {
    ANNOUNCED.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

struct BluetoothPlugin;

impl Guest for BluetoothPlugin {
    fn initialize() -> Result<(), String> {
        *SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = load_settings();
        let _ = bloop::abi::host::device_list();
        bloop::abi::host::watch(bloop::abi::capability::Capability::Devices, "").map_err(err)?;
        Ok(())
    }

    fn on_action(_action_id: String, _payload_json: String) -> Result<(), String> {
        Ok(())
    }

    fn on_timer(_timer_id: String) -> Result<(), String> {
        Ok(())
    }

    fn on_event(event: CapabilityEvent) -> Result<(), String> {
        let CapabilityEvent::Devices(device_event) = event else {
            return Ok(());
        };
        let settings = *SETTINGS.lock().unwrap_or_else(|e| e.into_inner());
        let now = bloop::abi::host::now_ms();
        match device_event {
            DeviceEvent::Connected(device) => {
                if settings.show_connect {
                    announced()
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(device.id.clone(), now);
                    publish_connected(&device, &settings);
                }
            }
            DeviceEvent::Disconnected(device) => {
                announced()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&device.id);
                if settings.show_disconnect {
                    publish_disconnected(&device, &settings);
                }
            }
            DeviceEvent::Updated(device) => {
                // Only surface battery updates for devices announced recently;
                // baseline reads that resolve after startup stay silent.
                let recent = announced()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&device.id)
                    .is_some_and(|at| now.saturating_sub(*at) <= ANNOUNCE_WINDOW_MS);
                if settings.show_battery && device.connected && device.battery.is_some() && recent {
                    publish_connected(&device, &settings);
                }
            }
        }
        Ok(())
    }

    fn on_settings_changed() -> Result<(), String> {
        *SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = load_settings();
        Ok(())
    }

    fn shutdown() {
        bloop::abi::host::unwatch(bloop::abi::capability::Capability::Devices);
        let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
    }
}

fn err(error: bloop::abi::types::Error) -> String {
    format!("{error:?}")
}

fn load_settings() -> Settings {
    let get = |key: &str| bloop::abi::host::get_setting(key);
    Settings {
        show_connect: get("showConnect")
            .and_then(|value| value.parse().ok())
            .unwrap_or(true),
        show_disconnect: get("showDisconnect")
            .and_then(|value| value.parse().ok())
            .unwrap_or(true),
        show_battery: get("showBattery")
            .and_then(|value| value.parse().ok())
            .unwrap_or(true),
        duration_ms: get("durationMs")
            .and_then(|value| value.parse().ok())
            .unwrap_or(1800),
    }
}

fn publish(node: serde_json::Value, settings: &Settings) {
    if let Ok(json) = serde_json::to_string(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        priority: 60,
        mode: "presentation",
        lifetime_ms: Some(settings.duration_ms),
        interruptible: true,
        compact: None,
        peek: None,
        presentation: Some(node),
        expanded: None,
        preview: None,
        timestamp_ms: bloop::abi::host::now_ms(),
        coalescing_key: Some(COALESCING_KEY),
        preferred_size: None,
    }) {
        let _ = bloop::abi::host::publish(&json);
    }
}

fn publish_connected(device: &Device, settings: &Settings) {
    let name = display_name(device);
    let subtitle = match (device.battery, settings.show_battery) {
        (Some(level), true) => format!("Connected · {level}%"),
        _ => "Connected".into(),
    };
    let node = ui::ui_row(
        vec![
            ui::ui_icon(icon_for(device.kind)),
            ui::ui_column(
                vec![ui::ui_text(&name, "title"), ui::ui_secondary(&subtitle)],
                2,
            ),
        ],
        12,
    );
    publish(node, settings);
}

fn publish_disconnected(device: &Device, settings: &Settings) {
    let name = display_name(device);
    let node = ui::ui_row(
        vec![
            ui::ui_icon(icon_for(device.kind)),
            ui::ui_column(
                vec![
                    ui::ui_text(&name, "title"),
                    ui::ui_secondary("Disconnected"),
                ],
                2,
            ),
        ],
        12,
    );
    publish(node, settings);
}

fn display_name(device: &Device) -> &str {
    if device.name.trim().is_empty() {
        "Device"
    } else {
        &device.name
    }
}

fn icon_for(kind: DeviceKind) -> &'static str {
    match kind {
        DeviceKind::Headphones => "headphones",
        DeviceKind::Speaker => "speaker",
        DeviceKind::Keyboard => "keyboard",
        DeviceKind::Mouse => "mouse",
        DeviceKind::Controller => "gamepad",
        DeviceKind::Phone => "smartphone",
        DeviceKind::Other => "bluetooth",
    }
}

export!(BluetoothPlugin);
