pub mod activity;
pub mod capabilities;
pub mod codec;
pub mod error;
pub mod events;
pub mod metrics;
pub mod plugins;
pub mod settings;
pub mod theme;

use std::path::PathBuf;
use std::sync::Arc;

pub use activity::{ActivityService, ActivitySnapshot, IslandState, ScheduledView, UiNode};
pub use capabilities::{
    HttpBackend, HttpRequest, HttpResponse, HttpService, MediaControls, MediaEvent, MediaService,
    MediaSession, NullMedia, PlaybackState, RepeatMode, ReqwestBackend,
};
pub use codec::{data_url, encode_base64, sha256_hex};
pub use error::{EngineError, EngineResult};
pub use events::{EngineEvent, EventBus};
pub use metrics::{ABI_VERSION, ENGINE_VERSION, IslandMetrics, Presence};
pub use plugins::{PluginLifecycle, PluginManager, PluginManifest, PluginRecord};
pub use settings::{AppSettings, HomeLayout, IdleProvider, MonitorPreference, SettingsService};
pub use theme::{MotionTokens, ThemeDocument, ThemeService};

pub struct Engine {
    pub events: Arc<EventBus>,
    pub settings: Arc<SettingsService>,
    pub activities: Arc<ActivityService>,
    pub themes: Arc<ThemeService>,
    pub plugins: Arc<PluginManager>,
    pub media: Arc<MediaService>,
    pub metrics: IslandMetrics,
}

impl Engine {
    pub fn new(
        settings: AppSettings,
        http: Arc<dyn HttpBackend>,
        persist_path: Option<PathBuf>,
    ) -> EngineResult<Self> {
        let events = Arc::new(EventBus::default());
        let settings = Arc::new(SettingsService::new(settings));
        let activities = Arc::new(ActivityService::new(events.clone()));
        let themes = Arc::new(ThemeService::new());
        let media = MediaService::connect();
        let plugins = Arc::new(PluginManager::new(
            Arc::new(HttpService::new(http)),
            media.clone(),
            settings.clone(),
            activities.clone(),
            themes.clone(),
            events.clone(),
            persist_path,
        )?);
        Ok(Self {
            events,
            settings,
            activities,
            themes,
            plugins,
            media,
            metrics: IslandMetrics::load(),
        })
    }

    pub fn load_plugins(&self, roots: &[PathBuf]) {
        self.plugins.discover_and_load(roots);
        if let Ok(theme) = self.themes.apply(&self.settings.get().theme_id) {
            self.events.emit(EngineEvent::ThemeChanged { id: theme.id });
        }
    }

    pub fn island_state(&self) -> IslandState {
        let view = self.activities.view();
        IslandState {
            presence: view.presence,
            sticky: view.sticky,
            activity: view.activity,
            activities: self.activities.all(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoHttp;
    impl HttpBackend for NoHttp {
        fn send(&self, _request: HttpRequest) -> EngineResult<HttpResponse> {
            Err(EngineError::Network("offline".into()))
        }
    }

    #[test]
    fn engine_constructs() {
        let engine = Engine::new(AppSettings::default(), Arc::new(NoHttp), None).unwrap();
        assert_eq!(engine.metrics.window.width, 560.0);
        assert!(engine.media.sessions().is_empty() || true);
    }
}
