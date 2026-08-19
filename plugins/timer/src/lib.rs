wit_bindgen::generate!({
    path: "../../wit",
    world: "activity-plugin",
});

use crate::exports::bloop::abi::activity::Guest;
use bloop_sdk as ui;
use bloop_sdk::{Attention, Snapshot};
use std::sync::Mutex;

const PLUGIN_ID: &str = "bloop.activity.timer";
const ACTIVITY_ID: &str = "timer";

const STATE_KEY: &str = "timer.state.v1";
const MIN_MS: u64 = 5_000; // 5 seconds
const MAX_MS: u64 = 3 * 60 * 60 * 1000; // 3 hours
const PERSIST_INTERVAL_MS: u64 = 5_000;

#[derive(Debug, Clone, PartialEq)]
enum TimerPhase {
    Idle,
    Running,
    Paused,
    Completed,
}

#[derive(Debug, Clone)]
struct TimerState {
    phase: TimerPhase,
    /// Absolute wall-clock deadline while running.
    deadline_ms: Option<u64>,
    /// Remaining ms while paused or configuring.
    remaining_ms: Option<u64>,
    /// The duration the timer was last started with (for restart / auto-restart).
    total_ms: Option<u64>,
    /// Start time for the running epoch (wall clock).
    started_ms: Option<u64>,
    /// Selected value in the configuration UI (ms).
    selected_ms: u64,
}

impl Default for TimerState {
    fn default() -> Self {
        Self {
            phase: TimerPhase::Idle,
            deadline_ms: None,
            remaining_ms: None,
            total_ms: None,
            started_ms: None,
            selected_ms: 5 * 60 * 1000,
        }
    }
}

static STATE: Mutex<TimerState> = Mutex::new(TimerState {
    phase: TimerPhase::Idle,
    deadline_ms: None,
    remaining_ms: None,
    total_ms: None,
    started_ms: None,
    selected_ms: 5 * 60 * 1000,
});

#[derive(Debug, Clone, Copy, PartialEq)]
struct Settings {
    show_seconds: bool,
    auto_restart: bool,
    default_minutes: u64,
    completion_ms: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            show_seconds: true,
            auto_restart: false,
            default_minutes: 5,
            completion_ms: 6000,
        }
    }
}

static SETTINGS: Mutex<Settings> = Mutex::new(Settings {
    show_seconds: true,
    auto_restart: false,
    default_minutes: 5,
    completion_ms: 6000,
});

struct TimerPlugin;

impl Guest for TimerPlugin {
    fn initialize() -> Result<(), String> {
        *SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = load_settings();
        restore_state();
        sync_timer();
        publish();
        Ok(())
    }

    fn on_action(action_id: String, payload_json: String) -> Result<(), String> {
        let now = bloop::abi::host::now_ms();
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let settings = *SETTINGS.lock().unwrap_or_else(|e| e.into_inner());
        match action_id.as_str() {
            "setValue" => {
                if let Some(value) = payload_json.parse::<u64>().ok() {
                    state.selected_ms = clamp(value);
                }
            }
            "start" => {
                let value = state.selected_ms;
                start(&mut state, value, now);
            }
            "startWith" => {
                if let Some(value) = payload_json.parse::<u64>().ok() {
                    state.selected_ms = clamp(value);
                    let value = state.selected_ms;
                    start(&mut state, value, now);
                }
            }
            "pause" => {
                if state.phase == TimerPhase::Running {
                    if let Some(deadline) = state.deadline_ms {
                        state.remaining_ms = Some(deadline.saturating_sub(now));
                        state.phase = TimerPhase::Paused;
                        state.deadline_ms = None;
                    }
                }
            }
            "resume" => {
                if state.phase == TimerPhase::Paused {
                    let remaining = state.remaining_ms.unwrap_or(0).max(MIN_MS);
                    state.deadline_ms = Some(now + remaining);
                    state.phase = TimerPhase::Running;
                    state.remaining_ms = None;
                }
            }
            "addMinute" => {
                if state.phase == TimerPhase::Running || state.phase == TimerPhase::Paused {
                    let base = if state.phase == TimerPhase::Running {
                        state.deadline_ms.unwrap_or(now).saturating_sub(now)
                    } else {
                        state.remaining_ms.unwrap_or(0)
                    };
                    let next = clamp(base + 60_000);
                    if state.phase == TimerPhase::Running {
                        state.deadline_ms = Some(now + next);
                    } else {
                        state.remaining_ms = Some(next);
                    }
                    if let Some(total) = state.total_ms {
                        state.total_ms = Some(total.saturating_add(60_000));
                    }
                }
            }
            "cancel" | "stop" | "reset" => {
                *state = TimerState::default();
                state.selected_ms = default_selected(&settings);
            }
            "restart" => {
                let total = state.total_ms.unwrap_or(state.selected_ms);
                start(&mut state, total, now);
            }
            _ => {}
        }
        persist(&state);
        drop(state);
        sync_timer();
        publish();
        Ok(())
    }

    fn on_timer(_timer_id: String) -> Result<(), String> {
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let settings = *SETTINGS.lock().unwrap_or_else(|e| e.into_inner());
        let now = bloop::abi::host::now_ms();

        if state.phase == TimerPhase::Running {
            let deadline = state.deadline_ms.unwrap_or(now);
            if now >= deadline {
                // Completed.
                if settings.auto_restart {
                    let total = state.total_ms.unwrap_or(state.selected_ms);
                    start(&mut state, total, now);
                } else {
                    state.phase = TimerPhase::Completed;
                    state.deadline_ms = None;
                    state.remaining_ms = Some(0);
                }
            }
        }
        // Once the completion window elapses, settle back to idle. The transient
        // presentation already expired through its freshness window; this keeps
        // the plugin's own state in step so it can accept a restart.
        if state.phase == TimerPhase::Completed {
            let elapsed_since_completion = if let Some(total) = state.total_ms {
                now.saturating_sub(state.started_ms.unwrap_or(now) + total)
            } else {
                0
            };
            if elapsed_since_completion >= settings.completion_ms {
                let last_total = state.total_ms;
                *state = TimerState::default();
                state.selected_ms = last_total.unwrap_or_else(|| default_selected(&settings));
                state.total_ms = last_total;
            }
        }
        persist(&state);
        drop(state);
        sync_timer();
        publish();
        Ok(())
    }

    fn on_event(_event: bloop::abi::capability::CapabilityEvent) -> Result<(), String> {
        Ok(())
    }

    fn on_settings_changed() -> Result<(), String> {
        *SETTINGS.lock().unwrap_or_else(|e| e.into_inner()) = load_settings();
        {
            let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
            if state.phase == TimerPhase::Idle {
                state.selected_ms = default_selected(&load_settings());
            }
        }
        sync_timer();
        publish();
        Ok(())
    }

    fn shutdown() {
        let state = STATE.lock().unwrap_or_else(|e| e.into_inner()).clone();
        persist(&state);
        let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
    }
}

fn clamp(value: u64) -> u64 {    value.clamp(MIN_MS, MAX_MS)
}

fn default_selected(settings: &Settings) -> u64 {
    clamp(settings.default_minutes.saturating_mul(60_000).max(MIN_MS))
}

fn start(state: &mut TimerState, duration_ms: u64, now: u64) {
    let duration = clamp(duration_ms).max(MIN_MS);
    state.phase = TimerPhase::Running;
    state.deadline_ms = Some(now + duration);
    state.remaining_ms = None;
    state.total_ms = Some(duration);
    state.started_ms = Some(now);
    state.selected_ms = duration;
}

fn load_settings() -> Settings {
    let get = |key: &str| bloop::abi::host::get_setting(key);
    Settings {
        show_seconds: get("showSeconds")
            .and_then(|value| value.parse().ok())
            .unwrap_or(true),
        auto_restart: get("autoRestart")
            .and_then(|value| value.parse().ok())
            .unwrap_or(false),
        default_minutes: get("defaultMinutes")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|minutes| minutes as u64)
            .unwrap_or(5),
        completion_ms: get("completionMs")
            .and_then(|value| value.parse::<f64>().ok())
            .map(|ms| ms as u64)
            .unwrap_or(6000),
    }
}

fn persist(state: &TimerState) {
    #[derive(serde::Serialize)]
    #[serde(tag = "phase", rename_all = "camelCase")]
    enum Stored {
        Idle,
        Running {
            deadline_ms: u64,
            total_ms: u64,
            started_ms: u64,
        },
        Paused {
            remaining_ms: u64,
            total_ms: u64,
        },
        Completed {
            total_ms: u64,
            started_ms: u64,
        },
    }
    let stored = match state.phase {
        TimerPhase::Idle => Stored::Idle,
        TimerPhase::Running => Stored::Running {
            deadline_ms: state.deadline_ms.unwrap_or(0),
            total_ms: state.total_ms.unwrap_or(0),
            started_ms: state.started_ms.unwrap_or(0),
        },
        TimerPhase::Paused => Stored::Paused {
            remaining_ms: state.remaining_ms.unwrap_or(0),
            total_ms: state.total_ms.unwrap_or(0),
        },
        TimerPhase::Completed => Stored::Completed {
            total_ms: state.total_ms.unwrap_or(0),
            started_ms: state.started_ms.unwrap_or(0),
        },
    };
    if let Ok(json) = serde_json::to_string(&stored) {
        let _ = bloop::abi::host::storage_set(STATE_KEY, &json);
    }
}

fn restore_state() {
    let Some(json) = bloop::abi::host::storage_get(STATE_KEY) else {
        let settings = load_settings();
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        state.selected_ms = default_selected(&settings);
        return;
    };
    #[derive(serde::Deserialize)]
    #[serde(tag = "phase", rename_all = "camelCase")]
    enum Stored {
        Idle,
        Running { deadline_ms: u64, total_ms: u64, started_ms: u64 },
        Paused { remaining_ms: u64, total_ms: u64 },
        Completed { total_ms: u64, started_ms: u64 },
    }
    let Ok(stored) = serde_json::from_str::<Stored>(&json) else {
        return;
    };
    let now = bloop::abi::host::now_ms();
    let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    *state = match stored {
        Stored::Idle => TimerState::default(),
        Stored::Running { deadline_ms, total_ms, started_ms } => {
            let remaining = deadline_ms.saturating_sub(now);
            if remaining == 0 {
                TimerState {
                    phase: TimerPhase::Completed,
                    deadline_ms: None,
                    remaining_ms: Some(0),
                    total_ms: Some(total_ms),
                    started_ms: Some(started_ms),
                    selected_ms: total_ms,
                }
            } else {
                TimerState {
                    phase: TimerPhase::Running,
                    deadline_ms: Some(deadline_ms),
                    remaining_ms: None,
                    total_ms: Some(total_ms),
                    started_ms: Some(started_ms),
                    selected_ms: total_ms,
                }
            }
        }
        Stored::Paused { remaining_ms, total_ms } => TimerState {
            phase: TimerPhase::Paused,
            deadline_ms: None,
            remaining_ms: Some(remaining_ms),
            total_ms: Some(total_ms),
            started_ms: None,
            selected_ms: total_ms,
        },
        Stored::Completed { total_ms, started_ms } => TimerState {
            phase: TimerPhase::Completed,
            deadline_ms: None,
            remaining_ms: Some(0),
            total_ms: Some(total_ms),
            started_ms: Some(started_ms),
            selected_ms: total_ms,
        },
    };
}

/// Keep a low-frequency timer running only while needed, so the plugin sleeps
/// otherwise. Running timers sync at 1s (enough for completion detection); the
/// frontend interpolates the countdown display locally.
fn sync_timer() {
    let state = STATE.lock().unwrap_or_else(|e| e.into_inner());
    match state.phase {
        TimerPhase::Running | TimerPhase::Completed => {
            bloop::abi::host::set_timer("tick", 1_000);
        }
        TimerPhase::Paused => {
            bloop::abi::host::set_timer("persist", PERSIST_INTERVAL_MS as u32);
        }
        TimerPhase::Idle => {
            bloop::abi::host::clear_timer("tick");
            bloop::abi::host::clear_timer("persist");
        }
    }
}

fn format_long(remaining: u64) -> String {
    let total_seconds = (remaining / 1000).min(3 * 60 * 60);
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn publish() {
    let state = STATE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let settings = *SETTINGS.lock().unwrap_or_else(|e| e.into_inner());
    let now = bloop::abi::host::now_ms();

    match state.phase {
        TimerPhase::Idle => publish_configuring(&state, &settings),
        TimerPhase::Running | TimerPhase::Paused => {
            let remaining = if state.phase == TimerPhase::Running {
                state.deadline_ms.unwrap_or(now).saturating_sub(now)
            } else {
                state.remaining_ms.unwrap_or(0)
            };
            publish_running(
                &state,
                &settings,
                remaining,
                state.deadline_ms.unwrap_or(now),
            );
        }
        TimerPhase::Completed => publish_completed(&state, &settings),
    }
}

fn publish_configuring(state: &TimerState, _settings: &Settings) {
    let value = state.selected_ms;
    let expanded = ui::ui_row(
        vec![
            ui::ui_ruler(value, MIN_MS, MAX_MS, None, "setValue"),
            ui::ui_column(
                vec![
                    ui::ui_icon_button("start", "play", "Start"),
                    ui::ui_icon_button("reset", "rotate-ccw", "Reset"),
                ],
                8,
            ),
        ],
        12,
    );
    // No compact variants: an idle timer shouldn't occupy the face.
    publish_json(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        instance_id: None,
        group: None,
        lifecycle: Some("ongoing"),
        attention: Some(Attention::default()),
        deadline_ms: None,
        lifetime_ms: None,
        variants: vec![],
        expanded: Some(expanded),
        preview: Some(ui::ui_ruler(value, MIN_MS, MAX_MS, None, "setValue")),
        timestamp_ms: now(),
    });
}

fn publish_running(state: &TimerState, _settings: &Settings, _remaining: u64, deadline: u64) {
    let paused = state.phase == TimerPhase::Paused;
    let running = !paused;
    let icon = ui::ui_icon("timer");
    let time = ui::ui_countdown(deadline, running, state.remaining_ms, state.total_ms);

    let variants = vec![
        ui::PresentationVariant {
            density: "micro",
            node: icon.clone(),
            min_width: 18,
            preferred_width: 22,
            max_width: None,
            utility: 0.25,
            min_readable_ms: None,
            coexist: true,
            label: Some("icon"),
        },
        ui::PresentationVariant {
            density: "small",
            node: time.clone(),
            min_width: 44,
            preferred_width: 56,
            max_width: Some(72),
            utility: 0.7,
            min_readable_ms: None,
            coexist: true,
            label: Some("time"),
        },
        ui::PresentationVariant {
            density: "compact",
            node: ui::ui_row(vec![icon.clone(), time.clone()], 6),
            min_width: 64,
            preferred_width: 86,
            max_width: Some(110),
            utility: 0.95,
            min_readable_ms: None,
            coexist: true,
            label: Some("icon+time"),
        },
        ui::PresentationVariant {
            density: "richCompact",
            node: ui::ui_row(vec![icon, time], 6),
            min_width: 64,
            preferred_width: 86,
            max_width: Some(110),
            utility: 1.0,
            min_readable_ms: None,
            coexist: true,
            label: Some("icon+time"),
        },
    ];

    // Urgency ramps generically via deadline + urgency_window_ms: the engine
    // derives the curve from `deadline_ms` and `urgencyWindowMs`, so the plugin
    // just declares a 5-minute "becomes relevant" window before the deadline.

    let controls = ui::ui_row(
        vec![
            ui::ui_icon_button(if paused { "resume" } else { "pause" }, if paused { "play" } else { "pause" }, if paused { "Resume" } else { "Pause" }),
            ui::ui_icon_button("addMinute", "plus", "Add minute"),
            ui::ui_icon_button("cancel", "x", "Cancel"),
        ],
        12,
    );

    let countdown_node = ui::ui_countdown(deadline, running, state.remaining_ms, state.total_ms);
    let expanded = if paused {
        ui::ui_column(
            vec![
                ui::ui_countdown(now() + state.remaining_ms.unwrap_or(0).max(1), false, state.remaining_ms, state.total_ms),
                ui::ui_secondary(&format!("{} remaining", format_long(state.remaining_ms.unwrap_or(0)))),
                controls,
            ],
            8,
        )
    } else {
        ui::ui_column(vec![countdown_node, controls], 8)
    };

    publish_json(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        instance_id: None,
        group: None,
        lifecycle: Some("countdown"),
        attention: Some(Attention {
            importance: Some(0.7),
            urgency: Some(if paused { 0.25 } else { 0.35 }),
            freshness_ms: None,
            urgency_window_ms: Some(5 * 60 * 1000),
            persistence: Some(0.9),
            interruptible: Some(false),
            takeover_suitable: Some(false),
        }),
        deadline_ms: Some(deadline),
        lifetime_ms: None,
        variants,
        expanded: Some(expanded),
        preview: Some(ui::ui_countdown(deadline, running, state.remaining_ms, state.total_ms)),
        timestamp_ms: now(),
    });
}

fn publish_completed(state: &TimerState, settings: &Settings) {
    let total = state.total_ms.unwrap_or(60_000);
    let completed_at = state.started_ms.unwrap_or(0) + total;
    let remaining_window = settings.completion_ms.saturating_sub(now().saturating_sub(completed_at));
    let duration = remaining_window.max(800);
    let icon = ui::ui_icon("bell");
    let node = ui::ui_row(
        vec![
            icon,
            ui::ui_column(vec![ui::ui_text("Timer finished", "title"), ui::ui_secondary("0:00")], 2),
        ],
        10,
    );
    let expanded = ui::ui_column(
        vec![
            ui::ui_text("Timer finished", "title"),
            ui::ui_row(
                vec![
                    ui::ui_grow(),
                    ui::ui_button("stop", "Stop", None),
                    ui::ui_button("restart", "Restart", None),
                    ui::ui_grow(),
                ],
                10,
            ),
        ],
        8,
    );
    publish_json(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        instance_id: None,
        group: None,
        lifecycle: Some("completion"),
        attention: Some(Attention {
            importance: Some(1.0),
            urgency: Some(1.0),
            freshness_ms: Some(duration as u32),
            urgency_window_ms: None,
            persistence: Some(0.2),
            interruptible: Some(true),
            takeover_suitable: Some(true),
        }),
        deadline_ms: None,
        lifetime_ms: Some(duration as u32),
        variants: vec![ui::PresentationVariant {
            density: "compact",
            node,
            min_width: 120,
            preferred_width: 180,
            max_width: Some(240),
            utility: 1.0,
            min_readable_ms: None,
            coexist: false,
            label: None,
        }],
        expanded: Some(expanded.clone()),
        preview: Some(expanded),
        timestamp_ms: now(),
    });
}

fn now() -> u64 {
    bloop::abi::host::now_ms()
}

fn publish_json(snapshot: &Snapshot<'_>) {
    if let Ok(json) = serde_json::to_string(snapshot) {
        let _ = bloop::abi::host::publish(&json);
    }
}

export!(TimerPlugin);
