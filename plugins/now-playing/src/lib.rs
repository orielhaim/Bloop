wit_bindgen::generate!({
    path: "../../wit",
    world: "activity-plugin",
});

use crate::exports::bloop::abi::activity::Guest;
use bloop::abi::media::{MediaSession, PlaybackState};
use bloop_sdk as ui;
use bloop_sdk::{Attention, Snapshot};
use std::sync::Mutex;

const PLUGIN_ID: &str = "bloop.activity.now-playing";
const ACTIVITY_ID: &str = "now-playing";

struct NowPlayingPlugin;

static SESSION_ID: Mutex<Option<String>> = Mutex::new(None);
static PLAYING: Mutex<bool> = Mutex::new(false);
static WANT_PLAYING: Mutex<Option<bool>> = Mutex::new(None);
static WANT_POSITION: Mutex<Option<u64>> = Mutex::new(None);
static FACE: Mutex<Option<String>> = Mutex::new(None);
static LAST_POSITION: Mutex<u64> = Mutex::new(0);
static LAST_SESSION: Mutex<Option<MediaSession>> = Mutex::new(None);

impl Guest for NowPlayingPlugin {
    fn initialize() -> Result<(), String> {
        bloop::abi::host::watch(bloop::abi::capability::Capability::Media, "").map_err(err)?;
        bloop::abi::host::set_timer("media-poll", 1_000);
        publish_session(active_session());
        Ok(())
    }

    fn on_action(action_id: String, payload_json: String) -> Result<(), String> {
        let Some(id) = SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
            return Ok(());
        };
        let playing_now = *PLAYING.lock().unwrap_or_else(|e| e.into_inner());
        let seek_to = (action_id == "seek").then(|| parse_position(&payload_json));
        let accepted = match action_id.as_str() {
            "play" => bloop::abi::host::media_play(&id),
            "pause" => bloop::abi::host::media_pause(&id),
            "toggle" => bloop::abi::host::media_toggle(&id),
            "next" => bloop::abi::host::media_next(&id),
            "previous" => bloop::abi::host::media_previous(&id),
            "stop" => bloop::abi::host::media_stop(&id),
            "seek" => bloop::abi::host::media_seek(&id, seek_to.unwrap_or(0)),
            "shuffle" => bloop::abi::host::media_set_shuffle(&id, payload_json.contains("true")),
            "repeat" => bloop::abi::host::media_set_repeat(&id, cycle_repeat()),
            _ => Ok(false),
        };
        accepted.map_err(err)?;
        let playing = match action_id.as_str() {
            "play" => true,
            "pause" | "stop" => false,
            "toggle" => !playing_now,
            _ => playing_now,
        };
        if matches!(action_id.as_str(), "play" | "pause" | "stop" | "toggle") {
            *WANT_PLAYING.lock().unwrap_or_else(|e| e.into_inner()) = Some(playing);
        }
        if let Some(position) = seek_to {
            *WANT_POSITION.lock().unwrap_or_else(|e| e.into_inner()) = Some(position);
        }
        publish_session_with(active_session(), Some(playing));
        Ok(())
    }

    fn on_timer(_timer_id: String) -> Result<(), String> {
        publish_session(active_session());
        Ok(())
    }

    fn on_event(event: bloop::abi::capability::CapabilityEvent) -> Result<(), String> {
        match event {
            bloop::abi::capability::CapabilityEvent::Media(
                bloop::abi::media::MediaEvent::SessionUpdated(session),
            ) => {
                publish_session(Some(remember_session(session)));
            }
            bloop::abi::capability::CapabilityEvent::Media(
                bloop::abi::media::MediaEvent::SessionsChanged(sessions),
            ) => {
                publish_session(pick_session(&sessions).map(remember_session));
            }
            _ => {}
        }
        Ok(())
    }

    fn on_settings_changed() -> Result<(), String> {
        publish_session(active_session());
        Ok(())
    }

    fn shutdown() {
        bloop::abi::host::unwatch(bloop::abi::capability::Capability::Media);
        let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
    }
}

fn err(error: bloop::abi::types::Error) -> String {
    format!("{error:?}")
}

fn remember_session(session: MediaSession) -> MediaSession {
    let mut last = LAST_SESSION.lock().unwrap_or_else(|e| e.into_inner());
    let merged = if let Some(previous) = last.as_ref().filter(|previous| previous.id == session.id)
    {
        MediaSession {
            title: prefer_track_title(&session.title, &previous.title, &session.app_id),
            artist: if session.artist.is_empty() {
                previous.artist.clone()
            } else {
                session.artist.clone()
            },
            album: if session.album.is_empty() {
                previous.album.clone()
            } else {
                session.album.clone()
            },
            has_artwork: session.has_artwork || previous.has_artwork,
            ..session
        }
    } else {
        session
    };
    *last = Some(merged.clone());
    merged
}

fn prefer_track_title(incoming: &str, previous: &str, app_id: &str) -> String {
    if !is_placeholder_title(incoming, app_id) {
        incoming.to_string()
    } else if !is_placeholder_title(previous, app_id) {
        previous.to_string()
    } else {
        incoming.to_string()
    }
}

fn is_placeholder_title(title: &str, app_id: &str) -> bool {
    let title = title.trim();
    if title.is_empty() {
        return true;
    }
    let lower = title.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "spotify premium" | "spotify" | "now playing" | "not playing"
    ) {
        return true;
    }
    title.contains('!') || (title.contains('_') && title.len() > 24) || title == app_id
}

fn is_playing(state: PlaybackState) -> bool {
    matches!(state, PlaybackState::Playing | PlaybackState::Changing)
}

fn is_active_media(state: PlaybackState) -> bool {
    matches!(
        state,
        PlaybackState::Playing | PlaybackState::Paused | PlaybackState::Changing
    )
}

fn forget_session() {
    *LAST_SESSION.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn pick_session(sessions: &[MediaSession]) -> Option<MediaSession> {
    let last_id = SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(id) = last_id.as_ref()
        && let Some(session) = sessions
            .iter()
            .find(|session| &session.id == id && is_active_media(session.state))
    {
        return Some(session.clone());
    }
    sessions
        .iter()
        .find(|session| is_playing(session.state))
        .cloned()
        .or_else(|| {
            sessions
                .iter()
                .find(|session| matches!(session.state, PlaybackState::Paused))
                .cloned()
        })
}

fn active_session() -> Option<MediaSession> {
    let sessions = bloop::abi::host::media_sessions();
    let current = bloop::abi::host::media_current().filter(|session| is_active_media(session.state));
    let found = pick_session(&sessions).or(current);
    match found {
        Some(session) if is_active_media(session.state) => Some(remember_session(session)),
        _ => {
            forget_session();
            None
        }
    }
}

fn parse_position(payload: &str) -> u64 {
    payload.parse::<u64>().unwrap_or_else(|_| {
        serde_json::from_str::<serde_json::Value>(payload)
            .ok()
            .and_then(|value| value.get("positionMs").and_then(|v| v.as_u64()))
            .unwrap_or(0)
    })
}

fn cycle_repeat() -> bloop::abi::media::RepeatMode {
    match active_session().map(|session| session.repeat) {
        Some(bloop::abi::media::RepeatMode::None) => bloop::abi::media::RepeatMode::Track,
        Some(bloop::abi::media::RepeatMode::Track) => bloop::abi::media::RepeatMode::Playlist,
        _ => bloop::abi::media::RepeatMode::None,
    }
}

fn publish_json(snapshot: &Snapshot<'_>) {
    if let Ok(json) = serde_json::to_string(snapshot) {
        let _ = bloop::abi::host::publish(&json);
    }
}

fn publish_session(session: Option<MediaSession>) {
    publish_session_with(session, None);
}

fn publish_session_with(session: Option<MediaSession>, playing_override: Option<bool>) {
    let Some(session) = session else {
        publish_idle();
        return;
    };
    *SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.id.clone());
    let reported = is_playing(session.state);
    let playing = if let Some(playing) = playing_override {
        playing
    } else {
        let mut want = WANT_PLAYING.lock().unwrap_or_else(|e| e.into_inner());
        match *want {
            Some(desired) if desired == reported => {
                *want = None;
                reported
            }
            Some(desired) => desired,
            None => reported,
        }
    };
    *PLAYING.lock().unwrap_or_else(|e| e.into_inner()) = playing;
    let position = {
        let mut want = WANT_POSITION.lock().unwrap_or_else(|e| e.into_inner());
        match *want {
            Some(desired) if session.position_ms.abs_diff(desired) < 2_000 => {
                *want = None;
                session.position_ms
            }
            Some(desired) => desired,
            None => session.position_ms,
        }
    };
    let title = display_title(&session);
    let artist = if session.artist.is_empty() {
        session.album.as_str()
    } else {
        session.artist.as_str()
    };
    publish_views(
        &session.id,
        title,
        artist,
        playing,
        position,
        session.duration_ms,
        session.has_artwork,
        &session.album,
    );
}

fn display_title(session: &MediaSession) -> &str {
    if is_placeholder_title(&session.title, &session.app_id) {
        if !session.album.is_empty() {
            session.album.as_str()
        } else {
            "Now Playing"
        }
    } else {
        session.title.as_str()
    }
}

fn face_key(
    session_id: &str,
    title: &str,
    artist: &str,
    playing: bool,
    artwork_src: &str,
) -> String {
    format!("{session_id}|{title}|{artist}|{playing}|{artwork_src}")
}

fn commit_face(key: String, position: u64) -> bool {
    let mut face = FACE.lock().unwrap_or_else(|e| e.into_inner());
    let mut last_position = LAST_POSITION.lock().unwrap_or_else(|e| e.into_inner());
    let jumped = position.abs_diff(*last_position) >= 1_000;
    if face.as_ref() == Some(&key) && !jumped {
        return false;
    }
    *face = Some(key);
    *last_position = position;
    true
}

fn publish_idle() {
    forget_session();
    if !commit_face("idle".into(), 0) {
        let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
        return;
    }
    let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
}

fn player_chrome(
    title: &str,
    artist: &str,
    playing: bool,
    position: u64,
    duration: u64,
    has_artwork: bool,
    artwork_src: &str,
) -> serde_json::Value {
    let art = if has_artwork {
        ui::ui_artwork(artwork_src)
    } else {
        ui::ui_badge("♪")
    };
    let toggle = if playing {
        ui::ui_icon_button_lg("toggle", "pause", "Pause")
    } else {
        ui::ui_icon_button_lg("toggle", "play", "Play")
    };
    let mut heading = vec![ui::ui_text(title, "title")];
    if !artist.is_empty() {
        heading.push(ui::ui_secondary(artist));
    }
    ui::ui_column(
        vec![
            ui::ui_row(
                vec![
                    art,
                    ui::ui_column(heading, 2),
                    ui::ui_grow(),
                    ui::ui_waveform(playing),
                ],
                12,
            ),
            ui::ui_seek(position, duration),
            ui::ui_row(
                vec![
                    ui::ui_grow(),
                    ui::ui_icon_button("previous", "skip-back", "Previous"),
                    toggle,
                    ui::ui_icon_button("next", "skip-forward", "Next"),
                    ui::ui_grow(),
                ],
                18,
            ),
        ],
        14,
    )
}

fn publish_views(
    session_id: &str,
    title: &str,
    artist: &str,
    playing: bool,
    position: u64,
    duration: u64,
    has_artwork: bool,
    album: &str,
) {
    let artwork_src = format!("media:{session_id}::{title}::{album}");
    if !commit_face(
        face_key(session_id, title, artist, playing, &artwork_src),
        position,
    ) {
        return;
    }
    let artwork = if has_artwork {
        ui::ui_artwork(&artwork_src)
    } else {
        ui::ui_badge("♪")
    };
    let title_text = ui::ui_text(title, "title");
    let waveform = ui::ui_waveform(playing);

    // Semantic presentation variants: the engine chooses how much to show.
    let micro = ui::ui_waveform(playing);
    let small = ui::ui_row(vec![artwork.clone(), waveform.clone()], 8);
    let compact = ui::ui_row(vec![artwork.clone(), title_text.clone(), ui::ui_grow(), waveform.clone()], 10);
    let mut rich_children = vec![artwork.clone(), ui::ui_column(vec![title_text.clone(), ui::ui_secondary(artist)], 2), ui::ui_grow(), waveform.clone()];
    if artist.is_empty() {
        rich_children = vec![artwork.clone(), title_text.clone(), ui::ui_grow(), waveform.clone()];
    }
    let rich_compact = ui::ui_row(rich_children, 10);

    let chrome = player_chrome(
        title,
        artist,
        playing,
        position,
        duration,
        has_artwork,
        &artwork_src,
    );
    publish_json(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        instance_id: None,
        group: None,
        lifecycle: Some("ongoing"),
        attention: Some(Attention {
            importance: Some(0.6),
            urgency: Some(0.35),
            freshness_ms: None,
            urgency_window_ms: None,
            persistence: Some(0.85),
            interruptible: Some(true),
            takeover_suitable: Some(false),
        }),
        deadline_ms: None,
        lifetime_ms: None,
        variants: vec![
            ui::PresentationVariant {
                density: "micro",
                node: micro,
                min_width: 16,
                preferred_width: 22,
                max_width: None,
                utility: 0.3,
                min_readable_ms: None,
                coexist: true,
                label: None,
            },
            ui::PresentationVariant {
                density: "small",
                node: small,
                min_width: 40,
                preferred_width: 56,
                max_width: None,
                utility: 0.45,
                min_readable_ms: None,
                coexist: true,
                label: None,
            },
            ui::PresentationVariant {
                density: "compact",
                node: compact,
                min_width: 92,
                preferred_width: 168,
                max_width: Some(196),
                utility: 0.8,
                min_readable_ms: None,
                coexist: true,
                label: None,
            },
            ui::PresentationVariant {
                density: "richCompact",
                node: rich_compact,
                min_width: 120,
                preferred_width: 220,
                max_width: Some(300),
                utility: 1.0,
                min_readable_ms: None,
                coexist: false,
                label: None,
            },
        ],
        expanded: Some(chrome.clone()),
        preview: Some(chrome),
        timestamp_ms: bloop::abi::host::now_ms(),
    });
}

export!(NowPlayingPlugin);
