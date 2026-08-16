use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use super::{MediaBackend, MediaControls, MediaEvent, MediaSession, PlaybackState, RepeatMode};
use crate::error::{EngineError, EngineResult};

pub fn start(on_event: Arc<dyn Fn(MediaEvent) + Send + Sync>) -> Arc<dyn MediaBackend> {
    #[cfg(windows)]
    {
        Arc::new(GsmtcBackend::start(on_event))
    }
    #[cfg(not(windows))]
    {
        let _ = on_event;
        Arc::new(super::NullMedia)
    }
}

#[cfg(windows)]
struct GsmtcBackend {
    inner: Arc<Mutex<GsmtcState>>,
    on_event: Arc<dyn Fn(MediaEvent) + Send + Sync>,
}

#[cfg(windows)]
#[derive(Default)]
struct GsmtcState {
    sessions: Vec<MediaSession>,
    current_id: Option<String>,
    artwork: std::collections::HashMap<String, Vec<u8>>,
    subscribed: std::collections::HashSet<String>,
}

#[cfg(windows)]
impl GsmtcBackend {
    fn start(on_event: Arc<dyn Fn(MediaEvent) + Send + Sync>) -> Self {
        let inner = Arc::new(Mutex::new(GsmtcState::default()));
        let thread_state = inner.clone();
        let thread_events = on_event.clone();
        std::thread::Builder::new()
            .name("bloop-gsmtc".into())
            .spawn(move || run_gsmtc_thread(thread_state, thread_events))
            .ok();
        Self { inner, on_event }
    }

    fn session_guard(&self) -> parking_lot::MutexGuard<'_, GsmtcState> {
        self.inner.lock()
    }
}

#[cfg(windows)]
impl MediaBackend for GsmtcBackend {
    fn sessions(&self) -> Vec<MediaSession> {
        self.session_guard().sessions.clone()
    }

    fn current(&self) -> Option<MediaSession> {
        let state = self.session_guard();
        let id = state.current_id.as_ref()?;
        state
            .sessions
            .iter()
            .find(|session| &session.id == id)
            .cloned()
    }

    fn artwork(&self, id: &str) -> Option<Vec<u8>> {
        self.session_guard().artwork.get(id).cloned()
    }

    fn play(&self, id: &str) -> EngineResult<bool> {
        self.operate(id, SessionOp::Play)
    }
    fn pause(&self, id: &str) -> EngineResult<bool> {
        self.operate(id, SessionOp::Pause)
    }
    fn toggle(&self, id: &str) -> EngineResult<bool> {
        self.operate(id, SessionOp::Toggle)
    }
    fn stop(&self, id: &str) -> EngineResult<bool> {
        self.operate(id, SessionOp::Stop)
    }
    fn next(&self, id: &str) -> EngineResult<bool> {
        self.operate(id, SessionOp::Next)
    }
    fn previous(&self, id: &str) -> EngineResult<bool> {
        self.operate(id, SessionOp::Previous)
    }
    fn seek(&self, id: &str, position_ms: u64) -> EngineResult<bool> {
        self.operate(id, SessionOp::Seek(position_ms))
    }
    fn set_shuffle(&self, id: &str, on: bool) -> EngineResult<bool> {
        self.operate(id, SessionOp::Shuffle(on))
    }
    fn set_repeat(&self, id: &str, mode: RepeatMode) -> EngineResult<bool> {
        self.operate(id, SessionOp::Repeat(mode))
    }
    fn set_rate(&self, id: &str, rate: f64) -> EngineResult<bool> {
        self.operate(id, SessionOp::Rate(rate))
    }
}

#[cfg(windows)]
impl GsmtcBackend {
    fn operate(&self, id: &str, op: SessionOp) -> EngineResult<bool> {
        let accepted = invoke_session(id, op)?;
        sync_session(id, &self.inner, &self.on_event);
        Ok(accepted)
    }
}

#[cfg(windows)]
#[derive(Clone, Copy)]
enum SessionOp {
    Play,
    Pause,
    Toggle,
    Stop,
    Next,
    Previous,
    Seek(u64),
    Shuffle(bool),
    Repeat(RepeatMode),
    Rate(f64),
}

#[cfg(windows)]
static MANAGER: OnceLock<
    windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
> = OnceLock::new();

#[cfg(windows)]
fn wait<T: windows::core::RuntimeType>(
    op: windows_future::IAsyncOperation<T>,
) -> windows::core::Result<T> {
    op.join()
}

#[cfg(windows)]
fn run_gsmtc_thread(
    state: Arc<Mutex<GsmtcState>>,
    on_event: Arc<dyn Fn(MediaEvent) + Send + Sync>,
) {
    use windows::Foundation::TypedEventHandler;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    let manager =
        match GlobalSystemMediaTransportControlsSessionManager::RequestAsync().and_then(wait) {
            Ok(manager) => manager,
            Err(error) => {
                tracing::error!(%error, "failed to acquire GSMTC manager");
                return;
            }
        };
    let _ = MANAGER.set(manager.clone());
    refresh_sessions(&manager, &state, &on_event);

    let state_changed = state.clone();
    let on_event_changed = on_event.clone();
    let manager_for_handler = manager.clone();
    let _ = manager.SessionsChanged(&TypedEventHandler::new(move |_, _| {
        refresh_sessions(&manager_for_handler, &state_changed, &on_event_changed);
        Ok(())
    }));

    loop {
        std::thread::park();
    }
}

#[cfg(windows)]
fn refresh_sessions(
    manager: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager,
    state: &Arc<Mutex<GsmtcState>>,
    on_event: &Arc<dyn Fn(MediaEvent) + Send + Sync>,
) {
    use windows::Foundation::TypedEventHandler;

    let Ok(sessions) = manager.GetSessions() else {
        return;
    };
    let cached_sessions = state.lock().sessions.clone();
    let mut mapped = Vec::new();
    let mut artwork = std::collections::HashMap::new();
    let count = sessions.Size().unwrap_or(0);
    for index in 0..count {
        let Ok(session) = sessions.GetAt(index) else {
            continue;
        };
        let cached = session.SourceAppUserModelId().ok().and_then(|id| {
            let id = id.to_string();
            cached_sessions.iter().find(|item| item.id == id).cloned()
        });
        if let Some((snapshot, bytes)) =
            snapshot_session(&session, cached.as_ref(), cached.is_none())
        {
            if let Some(bytes) = bytes {
                artwork.insert(snapshot.id.clone(), bytes);
            }
            let session_id = snapshot.id.clone();
            let already = state.lock().subscribed.contains(&session_id);
            if !already {
                state.lock().subscribed.insert(session_id.clone());
                let state_ref = state.clone();
                let service_ref = on_event.clone();
                let session_for_events = session.clone();
                let _ = session.MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                    update_one(&session_for_events, &state_ref, &service_ref, true);
                    Ok(())
                }));
                let session_for_events = session.clone();
                let state_ref = state.clone();
                let service_ref = on_event.clone();
                let _ = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                    update_one(&session_for_events, &state_ref, &service_ref, false);
                    Ok(())
                }));
            }
            mapped.push(snapshot);
        }
    }
    let current_id = manager
        .GetCurrentSession()
        .ok()
        .and_then(|session| session.SourceAppUserModelId().ok())
        .map(|value| value.to_string());
    let changed = {
        let mut guard = state.lock();
        let changed = guard.sessions.len() != mapped.len()
            || guard
                .sessions
                .iter()
                .zip(mapped.iter())
                .any(|(left, right)| !left.same_face(right));
        guard.sessions = mapped.clone();
        guard.current_id = current_id;
        guard.artwork.extend(artwork);
        changed
    };
    if changed {
        on_event(MediaEvent::SessionsChanged { sessions: mapped });
    }
}

#[cfg(windows)]
fn update_one(
    session: &windows::Media::Control::GlobalSystemMediaTransportControlsSession,
    state: &Arc<Mutex<GsmtcState>>,
    on_event: &Arc<dyn Fn(MediaEvent) + Send + Sync>,
    refresh_properties: bool,
) {
    let cached = state
        .lock()
        .sessions
        .iter()
        .find(|item| {
            session
                .SourceAppUserModelId()
                .ok()
                .is_some_and(|id| item.id == id.to_string())
        })
        .cloned();
    let Some((snapshot, artwork)) = snapshot_session(session, cached.as_ref(), refresh_properties)
    else {
        return;
    };
    let changed = {
        let mut guard = state.lock();
        if let Some(bytes) = artwork {
            guard.artwork.insert(snapshot.id.clone(), bytes);
        }
        if let Some(existing) = guard
            .sessions
            .iter_mut()
            .find(|item| item.id == snapshot.id)
        {
            let changed = !existing.same_face(&snapshot);
            *existing = snapshot.clone();
            changed
        } else {
            guard.sessions.push(snapshot.clone());
            true
        }
    };
    if changed {
        on_event(MediaEvent::SessionUpdated { session: snapshot });
    }
}

#[cfg(windows)]
fn snapshot_session(
    session: &windows::Media::Control::GlobalSystemMediaTransportControlsSession,
    cached: Option<&MediaSession>,
    refresh_properties: bool,
) -> Option<(MediaSession, Option<Vec<u8>>)> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
    use windows::Media::MediaPlaybackAutoRepeatMode;

    let app_id = session.SourceAppUserModelId().ok()?.to_string();
    let props = if refresh_properties || cached.is_none() {
        session
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|op| wait(op).ok())
    } else {
        None
    };
    let playback = session.GetPlaybackInfo().ok()?;
    let timeline = session.GetTimelineProperties().ok();
    let controls = playback.Controls().ok();
    let status = playback
        .PlaybackStatus()
        .unwrap_or(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed);
    let state = match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened => PlaybackState::Opened,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => {
            PlaybackState::Changing
        }
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => PlaybackState::Stopped,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => PlaybackState::Playing,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => PlaybackState::Paused,
        _ => PlaybackState::Closed,
    };
    let position_ms = timeline
        .as_ref()
        .and_then(|t| t.Position().ok())
        .map(duration_ms)
        .unwrap_or(0);
    let duration_ms_value = timeline
        .as_ref()
        .and_then(|t| t.EndTime().ok())
        .map(duration_ms)
        .unwrap_or(0);
    let last_updated_ms = timeline
        .as_ref()
        .and_then(|t| t.LastUpdatedTime().ok())
        .map(|time| time.UniversalTime as u64 / 10_000)
        .unwrap_or_else(now_ms);
    let playback_rate = playback
        .PlaybackRate()
        .ok()
        .and_then(|rate| rate.Value().ok())
        .unwrap_or(1.0);
    let shuffle = playback
        .IsShuffleActive()
        .ok()
        .and_then(|value| value.Value().ok());
    let repeat = match playback
        .AutoRepeatMode()
        .ok()
        .and_then(|value| value.Value().ok())
        .unwrap_or(MediaPlaybackAutoRepeatMode::None)
    {
        MediaPlaybackAutoRepeatMode::Track => RepeatMode::Track,
        MediaPlaybackAutoRepeatMode::List => RepeatMode::Playlist,
        _ => RepeatMode::None,
    };
    let media_controls = MediaControls {
        play: controls
            .as_ref()
            .and_then(|c| c.IsPlayEnabled().ok())
            .unwrap_or(false),
        pause: controls
            .as_ref()
            .and_then(|c| c.IsPauseEnabled().ok())
            .unwrap_or(false),
        stop: controls
            .as_ref()
            .and_then(|c| c.IsStopEnabled().ok())
            .unwrap_or(false),
        previous: controls
            .as_ref()
            .and_then(|c| c.IsPreviousEnabled().ok())
            .unwrap_or(false),
        next: controls
            .as_ref()
            .and_then(|c| c.IsNextEnabled().ok())
            .unwrap_or(false),
        seek: controls
            .as_ref()
            .and_then(|c| c.IsPlaybackPositionEnabled().ok())
            .unwrap_or(false),
        shuffle: controls
            .as_ref()
            .and_then(|c| c.IsShuffleEnabled().ok())
            .unwrap_or(false),
        repeat: controls
            .as_ref()
            .and_then(|c| c.IsRepeatEnabled().ok())
            .unwrap_or(false),
        playback_rate: controls
            .as_ref()
            .and_then(|c| c.IsPlaybackRateEnabled().ok())
            .unwrap_or(false),
    };
    let artwork = if refresh_properties || cached.is_none_or(|item| !item.has_artwork) {
        props
            .as_ref()
            .and_then(|props| props.Thumbnail().ok())
            .and_then(|thumb| read_thumbnail(&thumb))
    } else {
        None
    };
    Some((
        MediaSession {
            id: app_id.clone(),
            app_id: app_id.clone(),
            app_name: cached
                .map(|item| item.app_name.clone())
                .unwrap_or_else(|| app_name_from_aumid(&app_id)),
            title: props
                .as_ref()
                .and_then(|props| props.Title().ok())
                .map(|value| value.to_string())
                .or_else(|| cached.map(|item| item.title.clone()))
                .unwrap_or_default(),
            artist: props
                .as_ref()
                .and_then(|props| props.Artist().ok())
                .map(|value| value.to_string())
                .or_else(|| cached.map(|item| item.artist.clone()))
                .unwrap_or_default(),
            album: props
                .as_ref()
                .and_then(|props| props.AlbumTitle().ok())
                .map(|value| value.to_string())
                .or_else(|| cached.map(|item| item.album.clone()))
                .unwrap_or_default(),
            state,
            position_ms,
            duration_ms: duration_ms_value,
            last_updated_ms,
            playback_rate,
            shuffle,
            repeat,
            controls: media_controls,
            has_artwork: artwork.is_some() || cached.is_some_and(|item| item.has_artwork),
        },
        artwork,
    ))
}

#[cfg(windows)]
fn read_thumbnail(
    thumb: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> Option<Vec<u8>> {
    use windows::Storage::Streams::{Buffer, InputStreamOptions};
    let stream = wait(thumb.OpenReadAsync().ok()?).ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > 8_000_000 {
        return None;
    }
    let buffer = Buffer::Create(size as u32).ok()?;
    stream
        .ReadAsync(&buffer, size as u32, InputStreamOptions::None)
        .ok()?
        .join()
        .ok()?;
    let reader = windows::Storage::Streams::DataReader::FromBuffer(&buffer).ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}

#[cfg(windows)]
fn invoke_session(id: &str, op: SessionOp) -> EngineResult<bool> {
    use windows::Media::MediaPlaybackAutoRepeatMode;
    let manager = MANAGER
        .get()
        .ok_or_else(|| EngineError::Runtime("media manager is not ready".into()))?;
    let sessions = manager
        .GetSessions()
        .map_err(|error| EngineError::Runtime(error.to_string()))?;
    let count = sessions.Size().unwrap_or(0);
    for index in 0..count {
        let Ok(session) = sessions.GetAt(index) else {
            continue;
        };
        let Ok(app_id) = session.SourceAppUserModelId() else {
            continue;
        };
        if !super::media::session_ids_match(&app_id.to_string(), id) {
            continue;
        }
        let result = match op {
            SessionOp::Play => session.TryPlayAsync(),
            SessionOp::Pause => session.TryPauseAsync(),
            SessionOp::Toggle => session.TryTogglePlayPauseAsync(),
            SessionOp::Stop => session.TryStopAsync(),
            SessionOp::Next => session.TrySkipNextAsync(),
            SessionOp::Previous => session.TrySkipPreviousAsync(),
            SessionOp::Seek(position_ms) => {
                let ticks = (position_ms as i64).saturating_mul(10_000);
                session.TryChangePlaybackPositionAsync(ticks)
            }
            SessionOp::Shuffle(on) => session.TryChangeShuffleActiveAsync(on),
            SessionOp::Repeat(mode) => {
                let win_mode = match mode {
                    RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
                    RepeatMode::Playlist => MediaPlaybackAutoRepeatMode::List,
                    RepeatMode::None => MediaPlaybackAutoRepeatMode::None,
                };
                session.TryChangeAutoRepeatModeAsync(win_mode)
            }
            SessionOp::Rate(rate) => session.TryChangePlaybackRateAsync(rate),
        };
        return result
            .and_then(wait)
            .map_err(|error| EngineError::Runtime(error.to_string()));
    }
    Err(EngineError::Runtime("media session not found".into()))
}

#[cfg(windows)]
fn sync_session(
    id: &str,
    state: &Arc<Mutex<GsmtcState>>,
    on_event: &Arc<dyn Fn(MediaEvent) + Send + Sync>,
) {
    let Some(manager) = MANAGER.get() else {
        return;
    };
    let Ok(sessions) = manager.GetSessions() else {
        return;
    };
    let count = sessions.Size().unwrap_or(0);
    for index in 0..count {
        let Ok(session) = sessions.GetAt(index) else {
            continue;
        };
        let Ok(app_id) = session.SourceAppUserModelId() else {
            continue;
        };
        if super::media::session_ids_match(&app_id.to_string(), id) {
            update_one(&session, state, on_event, true);
            return;
        }
    }
}

#[cfg(windows)]
fn duration_ms(timespan: windows::Foundation::TimeSpan) -> u64 {
    (timespan.Duration.max(0) / 10_000) as u64
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn app_name_from_aumid(app_id: &str) -> String {
    let file = app_id.split('!').next().unwrap_or(app_id);
    let name = file
        .rsplit('\\')
        .next()
        .unwrap_or(file)
        .trim_end_matches(".exe");
    name.replace('.', " ")
}
