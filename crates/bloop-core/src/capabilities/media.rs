use serde::{Deserialize, Serialize};

use crate::error::{EngineError, EngineResult};
use crate::events::{Signal, Subscription};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackState {
    Closed,
    Opened,
    Changing,
    Stopped,
    Playing,
    Paused,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    #[default]
    None,
    Track,
    Playlist,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaControls {
    pub play: bool,
    pub pause: bool,
    pub stop: bool,
    pub previous: bool,
    pub next: bool,
    pub seek: bool,
    pub shuffle: bool,
    pub repeat: bool,
    pub playback_rate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub state: PlaybackState,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub last_updated_ms: u64,
    pub playback_rate: f64,
    pub shuffle: Option<bool>,
    pub repeat: RepeatMode,
    pub controls: MediaControls,
    pub has_artwork: bool,
}

impl MediaSession {
    pub fn matches_query(&self, query: &str) -> bool {
        let query = query.trim().to_ascii_lowercase();
        if query.is_empty() {
            return true;
        }
        [
            self.id.as_str(),
            self.app_id.as_str(),
            self.app_name.as_str(),
        ]
        .into_iter()
        .any(|value| normalize_app_token(value).contains(&query))
    }

    pub fn same_face(&self, other: &Self) -> bool {
        self.id == other.id
            && self.title == other.title
            && self.artist == other.artist
            && self.album == other.album
            && self.state == other.state
            && self.duration_ms == other.duration_ms
            && self.shuffle == other.shuffle
            && self.repeat == other.repeat
            && self.controls == other.controls
            && self.has_artwork == other.has_artwork
    }

    /// True when playback jumped rather than advancing continuously.
    pub fn position_jumped(&self, other: &Self) -> bool {
        self.position_ms.abs_diff(other.position_ms) >= 1_500
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MediaEvent {
    SessionsChanged { sessions: Vec<MediaSession> },
    SessionUpdated { session: MediaSession },
}

pub trait MediaBackend: Send + Sync {
    fn sessions(&self) -> Vec<MediaSession>;
    fn current(&self) -> Option<MediaSession>;
    fn artwork(&self, id: &str) -> Option<Vec<u8>>;
    fn play(&self, id: &str) -> EngineResult<bool>;
    fn pause(&self, id: &str) -> EngineResult<bool>;
    fn toggle(&self, id: &str) -> EngineResult<bool>;
    fn stop(&self, id: &str) -> EngineResult<bool>;
    fn next(&self, id: &str) -> EngineResult<bool>;
    fn previous(&self, id: &str) -> EngineResult<bool>;
    fn seek(&self, id: &str, position_ms: u64) -> EngineResult<bool>;
    fn set_shuffle(&self, id: &str, on: bool) -> EngineResult<bool>;
    fn set_repeat(&self, id: &str, mode: RepeatMode) -> EngineResult<bool>;
    fn set_rate(&self, id: &str, rate: f64) -> EngineResult<bool>;
}

#[derive(Default)]
pub struct NullMedia;

impl MediaBackend for NullMedia {
    fn sessions(&self) -> Vec<MediaSession> {
        Vec::new()
    }
    fn current(&self) -> Option<MediaSession> {
        None
    }
    fn artwork(&self, _id: &str) -> Option<Vec<u8>> {
        None
    }
    fn play(&self, _id: &str) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn pause(&self, _id: &str) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn toggle(&self, _id: &str) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn stop(&self, _id: &str) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn next(&self, _id: &str) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn previous(&self, _id: &str) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn seek(&self, _id: &str, _position_ms: u64) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn set_shuffle(&self, _id: &str, _on: bool) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn set_repeat(&self, _id: &str, _mode: RepeatMode) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
    fn set_rate(&self, _id: &str, _rate: f64) -> EngineResult<bool> {
        Err(EngineError::Unsupported("media is unavailable".into()))
    }
}

pub struct MediaService {
    backend: std::sync::Arc<dyn MediaBackend>,
    events: Signal<MediaEvent>,
}

impl MediaService {
    pub fn connect() -> std::sync::Arc<Self> {
        let slot: std::sync::Arc<parking_lot::Mutex<Option<std::sync::Arc<Self>>>> =
            std::sync::Arc::new(parking_lot::Mutex::new(None));
        let slot_for_backend = slot.clone();
        let backend = crate::capabilities::gsmtc::start(std::sync::Arc::new(move |event| {
            if let Some(service) = slot_for_backend.lock().as_ref() {
                service.emit(event);
            }
        }));
        let service = std::sync::Arc::new(Self::new(backend));
        *slot.lock() = Some(service.clone());
        service
    }

    pub fn new(backend: std::sync::Arc<dyn MediaBackend>) -> Self {
        Self {
            backend,
            events: Signal::new(),
        }
    }

    /// Subscribe to media events; drop the subscription to unsubscribe.
    pub fn subscribe(
        &self,
        listener: impl Fn(&MediaEvent) + Send + Sync + 'static,
    ) -> Subscription {
        self.events.subscribe(listener)
    }

    pub fn emit(&self, event: MediaEvent) {
        self.events.emit(&event);
    }

    pub fn sessions(&self) -> Vec<MediaSession> {
        self.backend.sessions()
    }

    pub fn session(&self, id: &str) -> Option<MediaSession> {
        self.backend
            .sessions()
            .into_iter()
            .find(|session| session.id == id)
    }

    pub fn current(&self) -> Option<MediaSession> {
        self.backend.current()
    }

    pub fn find(&self, query: &str) -> Option<MediaSession> {
        let mut sessions: Vec<MediaSession> = self
            .backend
            .sessions()
            .into_iter()
            .filter(|session| session.matches_query(query))
            .collect();
        if let Some(current) = self
            .backend
            .current()
            .filter(|session| session.matches_query(query))
        {
            if !sessions.iter().any(|session| session.id == current.id) {
                sessions.push(current);
            }
        }
        sessions.sort_by_key(|session| match session.state {
            PlaybackState::Playing => 0,
            PlaybackState::Paused => 1,
            _ => 2,
        });
        sessions.into_iter().next()
    }

    pub fn artwork(&self, id: &str) -> Option<Vec<u8>> {
        self.backend.artwork(id)
    }

    pub fn play(&self, id: &str) -> EngineResult<bool> {
        self.backend.play(id)
    }
    pub fn pause(&self, id: &str) -> EngineResult<bool> {
        self.backend.pause(id)
    }
    pub fn toggle(&self, id: &str) -> EngineResult<bool> {
        self.backend.toggle(id)
    }
    pub fn stop(&self, id: &str) -> EngineResult<bool> {
        self.backend.stop(id)
    }
    pub fn next(&self, id: &str) -> EngineResult<bool> {
        self.backend.next(id)
    }
    pub fn previous(&self, id: &str) -> EngineResult<bool> {
        self.backend.previous(id)
    }
    pub fn seek(&self, id: &str, position_ms: u64) -> EngineResult<bool> {
        self.backend.seek(id, position_ms)
    }
    pub fn set_shuffle(&self, id: &str, on: bool) -> EngineResult<bool> {
        self.backend.set_shuffle(id, on)
    }
    pub fn set_repeat(&self, id: &str, mode: RepeatMode) -> EngineResult<bool> {
        self.backend.set_repeat(id, mode)
    }
    pub fn set_rate(&self, id: &str, rate: f64) -> EngineResult<bool> {
        self.backend.set_rate(id, rate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_matches_spotify_aumid() {
        let session = MediaSession {
            id: "Spotify.exe".into(),
            app_id: "Spotify.exe".into(),
            app_name: "Spotify".into(),
            title: "Midnight City".into(),
            artist: "M83".into(),
            album: "Hurry Up, We're Dreaming".into(),
            state: PlaybackState::Playing,
            position_ms: 12_000,
            duration_ms: 240_000,
            last_updated_ms: 0,
            playback_rate: 1.0,
            shuffle: Some(false),
            repeat: RepeatMode::None,
            controls: MediaControls {
                play: true,
                pause: true,
                next: true,
                previous: true,
                seek: true,
                ..MediaControls::default()
            },
            has_artwork: true,
        };
        assert!(session.matches_query("spotify"));
        assert!(!session.matches_query("vlc"));
    }

    #[test]
    fn placeholder_titles_are_detected() {
        assert!(is_placeholder_title("Spotify Premium", "", ""));
        assert!(is_placeholder_title(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify",
            "",
            ""
        ));
        assert!(!is_placeholder_title(
            "Midnight City",
            "Spotify.exe",
            "Spotify"
        ));
    }

    #[test]
    fn query_matches_store_aumid() {
        let session = MediaSession {
            id: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify".into(),
            app_id: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify".into(),
            app_name: "SpotifyAB SpotifyMusic_zpdnekdrzrea0".into(),
            title: "Track".into(),
            artist: "Artist".into(),
            album: String::new(),
            state: PlaybackState::Playing,
            position_ms: 0,
            duration_ms: 0,
            last_updated_ms: 0,
            playback_rate: 1.0,
            shuffle: None,
            repeat: RepeatMode::None,
            controls: MediaControls::default(),
            has_artwork: false,
        };
        assert!(session.matches_query("spotify"));
    }
}

pub(crate) fn session_ids_match(left: &str, right: &str) -> bool {
    left == right || normalize_app_token(left) == normalize_app_token(right)
}

/// GSMTC often reports the app's marketing name (or the raw AUMID) as the track
/// title until real media properties arrive. Those placeholders must not stick.
pub(crate) fn is_placeholder_title(title: &str, app_id: &str, app_name: &str) -> bool {
    let title = title.trim();
    if title.is_empty() {
        return true;
    }
    let lower = title.to_ascii_lowercase();
    if lower == "spotify premium"
        || lower == "spotify"
        || lower == "now playing"
        || lower == "not playing"
    {
        return true;
    }
    if !app_name.is_empty() && title.eq_ignore_ascii_case(app_name) {
        return true;
    }
    looks_like_aumid(title) || (!app_id.is_empty() && title.eq_ignore_ascii_case(app_id))
}

fn looks_like_aumid(value: &str) -> bool {
    value.contains('!') || (value.contains('_') && value.len() > 24)
}

fn normalize_app_token(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['\\', '/', '.', '!', '_', '-'], "")
}
