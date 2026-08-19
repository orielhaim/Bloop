wit_bindgen::generate!({
    path: "../../wit",
    world: "activity-plugin",
});

use crate::exports::bloop::abi::activity::Guest;
use bloop::abi::audio::AudioState;
use bloop_sdk as ui;
use bloop_sdk::{Attention, Snapshot};
use std::sync::Mutex;

const PLUGIN_ID: &str = "bloop.activity.volume";
const ACTIVITY_ID: &str = "volume";
const GROUP: &str = "system-audio";

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
    let percent = (f64::from(state.volume) * 100.0).round() as u32;
    let icon_name = if state.muted { "volume-x" } else { "volume" };
    let icon = ui::ui_icon(icon_name);
    let bar = ui::ui_progress(f64::from(state.volume), 1.0);
    let mut compact_children = vec![icon.clone(), bar.clone()];
    let label = if state.muted {
        "Muted".to_string()
    } else if settings.show_percentage {
        format!("{percent}%")
    } else {
        String::new()
    };
    if !label.is_empty() {
        compact_children.push(ui::ui_text(&label, "numeric"));
    }

    let variants = vec![
        ui::PresentationVariant {
            density: "micro",
            node: icon.clone(),
            min_width: 20,
            preferred_width: 26,
            max_width: None,
            utility: 0.35,
            min_readable_ms: None,
            coexist: true,
            label: Some("icon"),
        },
        ui::PresentationVariant {
            density: "compact",
            node: ui::ui_row(vec![icon.clone(), bar.clone()], 10),
            min_width: 64,
            preferred_width: 110,
            max_width: Some(160),
            utility: 0.7,
            min_readable_ms: None,
            coexist: true,
            label: Some("bar"),
        },
    ];

    let rich = if label.is_empty() {
        ui::ui_row(vec![icon.clone(), bar.clone()], 12)
    } else {
        ui::ui_row(vec![icon.clone(), bar.clone(), ui::ui_text(&label, "numeric")], 12)
    };
    let mut all = variants;
    all.push(ui::PresentationVariant {
        density: "richCompact",
        node: rich,
            min_width: 168,
            preferred_width: 196,
            max_width: Some(220),
        utility: 1.0,
        min_readable_ms: None,
        coexist: false,
        label: Some("level"),
    });

    let duration = settings.duration_ms;
    if let Ok(json) = serde_json::to_string(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        instance_id: None,
        group: Some(GROUP),
        lifecycle: Some("momentary"),
        attention: Some(Attention::default().with(0.7, 0.9, Some(duration)).takeover(true)),
        deadline_ms: None,
        lifetime_ms: Some(duration),
        variants: all,
        expanded: None,
        preview: None,
        timestamp_ms: bloop::abi::host::now_ms(),
    }) {
        let _ = bloop::abi::host::publish(&json);
    } else {
        bloop::abi::host::log("error", "volume publish: snapshot serialization failed");
    }
}

export!(VolumePlugin);