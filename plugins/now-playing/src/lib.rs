wit_bindgen::generate!({
    path: "../../wit",
    world: "activity-plugin",
});

use crate::exports::bloop::abi::activity::Guest;
use bloop_sdk as ui;
use bloop_sdk::Snapshot;
use std::sync::Mutex;

const PLUGIN_ID: &str = "bloop.activity.now-playing";
const ACTIVITY_ID: &str = "now-playing";

struct NowPlayingPlugin;

static SESSION_ID: Mutex<Option<String>> = Mutex::new(None);
static PLAYING: Mutex<bool> = Mutex::new(false);
static WANT_PLAYING: Mutex<bool> = Mutex::new(false);
static FACE: Mutex<Option<String>> = Mutex::new(None);
static LAST_SESSION: Mutex<Option<bloop::abi::media::MediaSession>> = Mutex::new(None);

impl Guest for NowPlayingPlugin {
    fn initialize() -> Result<(), String> {
        bloop::abi::host::watch("media", "").map_err(err)?;
        bloop::abi::host::set_timer("media-poll", 2_000);
        match active_session() {
            Some(session) => publish_session(Some(session)),
            None => publish_idle(),
        }
        Ok(())
    }

    fn on_action(action_id: String, payload_json: String) -> Result<(), String> {
        let Some(id) = SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
            return Ok(());
        };
        let playing_now = *PLAYING.lock().unwrap_or_else(|e| e.into_inner());
        let accepted = match action_id.as_str() {
            "play" => bloop::abi::host::media_play(&id),
            "pause" => bloop::abi::host::media_pause(&id),
            "toggle" => bloop::abi::host::media_toggle(&id),
            "next" => bloop::abi::host::media_next(&id),
            "previous" => bloop::abi::host::media_previous(&id),
            "stop" => bloop::abi::host::media_stop(&id),
            "seek" => bloop::abi::host::media_seek(&id, parse_position(&payload_json)),
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
        *WANT_PLAYING.lock().unwrap_or_else(|e| e.into_inner()) = playing;
        match active_session() {
            Some(session) => publish_session_with(Some(session), Some(playing)),
            None => {
                *PLAYING.lock().unwrap_or_else(|e| e.into_inner()) = playing;
            }
        }
        Ok(())
    }

    fn on_timer(_timer_id: String) -> Result<(), String> {
        *WANT_PLAYING.lock().unwrap_or_else(|e| e.into_inner()) = false;
        publish_session(active_session());
        Ok(())
    }

    fn on_event(topic: String, _payload_json: String) -> Result<(), String> {
        if topic != "media" {
            return Ok(());
        }
        publish_session(active_session());
        Ok(())
    }

    fn on_settings_changed() -> Result<(), String> {
        publish_session(active_session());
        Ok(())
    }

    fn shutdown() {
        bloop::abi::host::unwatch("media");
        let _ = bloop::abi::host::dismiss(ACTIVITY_ID);
    }
}

fn err(error: bloop::abi::types::Error) -> String {
    format!("{error:?}")
}

fn last_session() -> Option<bloop::abi::media::MediaSession> {
    LAST_SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn remember_session(session: bloop::abi::media::MediaSession) -> bloop::abi::media::MediaSession {
    let mut last = LAST_SESSION.lock().unwrap_or_else(|e| e.into_inner());
    let merged = if let Some(previous) = last.as_ref().filter(|previous| previous.id == session.id)
    {
        bloop::abi::media::MediaSession {
            title: if session.title.is_empty() {
                previous.title.clone()
            } else {
                session.title.clone()
            },
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
            app_name: if session.app_name.is_empty() {
                previous.app_name.clone()
            } else {
                session.app_name.clone()
            },
            duration_ms: if session.duration_ms == 0 {
                previous.duration_ms
            } else {
                session.duration_ms
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

fn active_session() -> Option<bloop::abi::media::MediaSession> {
    let sessions = bloop::abi::host::media_sessions();
    let current = bloop::abi::host::media_current();
    let last_id = SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let found = if let Some(id) = last_id.as_ref()
        && let Some(session) = sessions.iter().find(|session| &session.id == id)
        && matches!(session.state, bloop::abi::media::PlaybackState::Playing)
    {
        Some(session.clone())
    } else if let Some(session) = current
        .as_ref()
        .filter(|session| matches!(session.state, bloop::abi::media::PlaybackState::Playing))
    {
        Some(session.clone())
    } else {
        sessions
            .iter()
            .find(|session| matches!(session.state, bloop::abi::media::PlaybackState::Playing))
            .cloned()
            .or(current)
            .or_else(|| {
                last_id.and_then(|id| sessions.into_iter().find(|session| session.id == id))
            })
    };
    found.map(remember_session).or_else(last_session)
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

fn publish_session(session: Option<bloop::abi::media::MediaSession>) {
    publish_session_with(session, None);
}

fn publish_session_with(
    session: Option<bloop::abi::media::MediaSession>,
    playing_override: Option<bool>,
) {
    let Some(session) = session else {
        return;
    };
    *SESSION_ID.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.id.clone());
    let reported = matches!(session.state, bloop::abi::media::PlaybackState::Playing);
    let playing = if let Some(playing) = playing_override {
        playing
    } else {
        let mut want = WANT_PLAYING.lock().unwrap_or_else(|e| e.into_inner());
        if *want {
            if reported {
                *want = false;
            }
            true
        } else {
            reported
        }
    };
    *PLAYING.lock().unwrap_or_else(|e| e.into_inner()) = playing;
    publish_views(
        &session.id,
        &session.title,
        &session.artist,
        &session.album,
        &session.app_name,
        playing,
        session.position_ms,
        session.duration_ms,
        serde_json::json!({
            "play": session.controls.play,
            "pause": session.controls.pause,
            "previous": session.controls.previous,
            "next": session.controls.next,
            "seek": session.controls.seek,
            "shuffle": session.controls.shuffle,
            "repeat": session.controls.repeat,
        }),
        session.has_artwork,
    );
}

fn face_key(
    session_id: &str,
    title: &str,
    artist: &str,
    app_name: &str,
    playing: bool,
    has_artwork: bool,
) -> String {
    format!("{session_id}|{title}|{artist}|{app_name}|{playing}|{has_artwork}")
}

fn commit_face(key: String) -> bool {
    let mut face = FACE.lock().unwrap_or_else(|e| e.into_inner());
    if face.as_ref() == Some(&key) {
        return false;
    }
    *face = Some(key);
    true
}

fn source_label(app_name: &str) -> &str {
    if app_name.is_empty() {
        "Now Playing"
    } else {
        app_name
    }
}

fn source_mark(app_name: &str) -> String {
    source_label(app_name)
        .chars()
        .find(|ch| ch.is_alphanumeric())
        .map(|ch| ch.to_uppercase().to_string())
        .unwrap_or_else(|| "♪".into())
}

fn publish_idle() {
    if !commit_face("idle".into()) {
        return;
    }
    let idle = ui::ui_column(
        vec![
            ui::ui_text("Now Playing", "kicker"),
            ui::ui_secondary("Nothing is playing"),
        ],
        4,
    );
    let preview = player_chrome(
        "Not playing",
        "Now Playing",
        "Now Playing",
        false,
        0,
        180_000,
        serde_json::json!({}),
        false,
        "",
    );
    publish_json(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        priority: 40,
        mode: "compact",
        lifetime_ms: None,
        interruptible: true,
        compact: None,
        peek: None,
        presentation: None,
        expanded: Some(idle),
        preview: Some(preview),
        timestamp_ms: bloop::abi::host::now_ms(),
        coalescing_key: None,
        preferred_size: None,
    });
}

fn player_chrome(
    title: &str,
    artist: &str,
    app_name: &str,
    playing: bool,
    position: u64,
    duration: u64,
    controls: serde_json::Value,
    has_artwork: bool,
    artwork_src: &str,
) -> serde_json::Value {
    let art = if has_artwork {
        ui::ui_artwork(artwork_src)
    } else {
        ui::ui_badge(&source_mark(app_name))
    };
    let pause = if playing
        && controls
            .get("pause")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    {
        ui::ui_icon_button_lg("pause", "pause", "Pause")
    } else {
        ui::ui_icon_button_lg("play", "play", "Play")
    };
    ui::ui_column(
        vec![
            ui::ui_row(
                vec![
                    art,
                    ui::ui_column(
                        vec![
                            ui::ui_text(source_label(app_name), "kicker"),
                            ui::ui_text(title, "title"),
                            ui::ui_secondary(artist),
                        ],
                        2,
                    ),
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
                    pause,
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
    album: &str,
    app_name: &str,
    playing: bool,
    position: u64,
    duration: u64,
    controls: serde_json::Value,
    has_artwork: bool,
) {
    let title = if title.is_empty() {
        "Not playing"
    } else {
        title
    };
    let artist = if artist.is_empty() { album } else { artist };
    if !commit_face(face_key(
        session_id,
        title,
        artist,
        app_name,
        playing,
        has_artwork,
    )) {
        return;
    }
    let artwork_src = format!("media:{session_id}");
    let mark = source_mark(app_name);
    let peek = ui::ui_row(
        vec![
            if has_artwork {
                ui::ui_artwork(&artwork_src)
            } else {
                ui::ui_badge(&mark)
            },
            ui::ui_text(title, "title"),
            ui::ui_grow(),
            ui::ui_waveform(playing),
        ],
        10,
    );
    let chrome = player_chrome(
        title,
        artist,
        app_name,
        playing,
        position,
        duration,
        controls,
        has_artwork,
        &artwork_src,
    );
    publish_json(&Snapshot {
        activity_id: ACTIVITY_ID,
        plugin_id: PLUGIN_ID,
        priority: 40,
        mode: "peek",
        lifetime_ms: None,
        interruptible: true,
        compact: None,
        peek: Some(peek.clone()),
        presentation: Some(peek),
        expanded: Some(chrome.clone()),
        preview: Some(chrome),
        timestamp_ms: bloop::abi::host::now_ms(),
        coalescing_key: None,
        preferred_size: None,
    });
}

export!(NowPlayingPlugin);
