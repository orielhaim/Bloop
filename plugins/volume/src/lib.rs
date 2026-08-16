wit_bindgen::generate!({
    path: "../../wit",
    world: "activity-plugin",
});

use crate::exports::bloop::abi::activity::Guest;
use bloop::abi::audio::AudioState;
use bloop_sdk as ui;
use bloop_sdk::Snapshot;
use std::sync::Mutex;

const PLUGIN_ID: &str = "bloop.activity.volume";
const ACTIVITY_ID: &str = "volume";
const COALESCING_KEY: &str = "system-audio";

#[derive(Debug, Clone, Copy, PartialEq)]
struct Settings {
    show_on_mute: bool,
    show_percentage: bool,
    duration_ms: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            show_on_mute: true,
            show_percentage: true,
            duration_ms: 1500,
        }
    }
}

static SETTINGS: Mutex<Settings> = Mutex::new(Settings {
    show_on_mute: true,
    show_percentage: true,
    duration_ms: 1500,
});
static LAST: Mutex<Option<AudioState>> = Mutex::new(None);

struct VolumePlugin;

impl Guest for VolumePlugin {
    fn initialize() -> Result<(), String> {
        *SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = load_settings();
        *LAST.lock().unwrap_or_else(|e| e.into_inner()) = current_state();
        bloop::abi::host::watch(bloop::abi::capability::Capability::Audio, "").map_err(err)?;
        Ok(())
    }

    fn on_action(_action_id: String, _payload_json: String) -> Result<(), String> {
        Ok(())
    }

    fn on_timer(_timer_id: String) -> Result<(), String> {
        Ok(())
    }

    fn on_event(event: bloop::abi::capability::CapabilityEvent) -> Result<(), String> {
        match event {
            bloop::abi::capability::CapabilityEvent::Audio(
                bloop::abi::audio::AudioEvent::StateChanged(state),
            ) => react(Some(state)),
            bloop::abi::capability::CapabilityEvent::Audio(
                bloop::abi::audio::AudioEvent::DeviceChanged(_),
            ) => react(None),
            _ => {}
        }
        Ok(())
    }

    fn on_settings_changed() -> Result<(), String> {
        *SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = load_settings();
        react(None);
        Ok(())
    }

    fn shutdown() {
        bloop::abi::host::unwatch(bloop::abi::capability::Capability::Audio);
        let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
    }
}

fn err(error: bloop::abi::types::Error) -> String {
    format!("{error:?}")
}

fn load_settings() -> Settings {
    let get = |key: &str| bloop::abi::host::get_setting(key);
    Settings {
        show_on_mute: get("showOnMute")
            .and_then(|value| value.parse().ok())
            .unwrap_or(true),
        show_percentage: get("showPercentage")
            .and_then(|value| value.parse().ok())
            .unwrap_or(true),
        duration_ms: get("durationMs")
            .and_then(|value| value.parse().ok())
            .unwrap_or(1500),
    }
}

fn current_state() -> Option<AudioState> {
    bloop::abi::host::audio_current().ok()
}

fn react(event_state: Option<AudioState>) {
    let Some(state) = event_state.or_else(current_state) else {
        bloop::abi::host::log("error", "volume react: no audio state");
        return;
    };
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if last
        .as_ref()
        .is_some_and(|previous| previous.volume == state.volume && previous.muted == state.muted)
    {
        return;
    }
    let settings = *SETTINGS.lock().unwrap_or_else(|e| e.into_inner());
    let previous_muted = last.as_ref().map_or(state.muted, |previous| previous.muted);
    if state.muted != previous_muted && !settings.show_on_mute {
        *last = Some(state.clone());
        return;
    }
    *last = Some(state.clone());
    publish(&state, &settings);
}

fn publish(state: &AudioState, settings: &Settings) {
    let row = presentation(state, settings);
    if let Ok(json) = serde_json::to_string(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        priority: 62,
        mode: "presentation",
        lifetime_ms: Some(settings.duration_ms),
        interruptible: true,
        compact: None,
        peek: None,
        presentation: Some(row),
        expanded: None,
        preview: None,
        timestamp_ms: bloop::abi::host::now_ms(),
        coalescing_key: Some(COALESCING_KEY),
        preferred_size: Some("medium"),
    }) {
        let _ = bloop::abi::host::publish(&json);
    } else {
        bloop::abi::host::log("error", "volume publish: snapshot serialization failed");
    }
}

fn presentation(state: &AudioState, settings: &Settings) -> serde_json::Value {
    let icon = if state.muted {
        ui::ui_icon("volume-x")
    } else {
        ui::ui_icon("volume")
    };
    let mut children = vec![icon, ui::ui_progress(f64::from(state.volume), 1.0)];
    if state.muted {
        children.push(ui::ui_text("Muted", "body"));
    } else if settings.show_percentage {
        let percent = (f64::from(state.volume) * 100.0).round() as u32;
        children.push(ui::ui_text(&format!("{percent}%"), "numeric"));
    }
    ui::ui_row(children, 12)
}

export!(VolumePlugin);
