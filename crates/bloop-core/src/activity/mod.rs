mod model;
mod scheduler;
mod ui;

pub use model::*;
pub use scheduler::*;
pub use ui::*;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::events::{EngineEvent, EventBus};
use crate::metrics::Presence;

pub struct ActivityService {
    scheduler: Mutex<ActivityScheduler>,
    events: std::sync::Arc<EventBus>,
}

impl ActivityService {
    pub fn new(events: std::sync::Arc<EventBus>) -> Self {
        Self {
            scheduler: Mutex::new(ActivityScheduler::default()),
            events,
        }
    }

    pub fn publish(&self, snapshot: ActivitySnapshot) -> ScheduledView {
        let mut scheduler = self.scheduler.lock();
        if scheduler
            .latest(&snapshot.activity_id)
            .is_some_and(|existing| existing.same_content(&snapshot))
        {
            // A no-op update to a live transient presentation still extends its
            // window without producing a visual change.
            return scheduler.touch(&snapshot.activity_id, Instant::now());
        }
        let view = scheduler.publish(snapshot, Instant::now());
        drop(scheduler);
        self.events.emit(EngineEvent::PresenceChanged);
        view
    }

    /// Extend the presentation window of a live transient activity.
    pub fn touch(&self, activity_id: &str) -> ScheduledView {
        self.scheduler.lock().touch(activity_id, Instant::now())
    }

    pub fn dismiss(&self, activity_id: &str) -> ScheduledView {
        let view = self.scheduler.lock().dismiss(activity_id);
        self.events.emit(EngineEvent::ActivityDismissed {
            activity_id: activity_id.to_string(),
        });
        view
    }

    pub fn dismiss_plugin(&self, plugin_id: &str) -> ScheduledView {
        let view = self.scheduler.lock().dismiss_plugin(plugin_id);
        self.events.emit(EngineEvent::PresenceChanged);
        view
    }

    pub fn open_home(&self) -> ScheduledView {
        let view = self.scheduler.lock().open_home();
        self.events.emit(EngineEvent::PresenceChanged);
        view
    }

    pub fn collapse(&self) -> ScheduledView {
        let view = self.scheduler.lock().collapse();
        self.events.emit(EngineEvent::PresenceChanged);
        view
    }

    pub fn tick(&self) -> ScheduledView {
        let mut scheduler = self.scheduler.lock();
        let before = scheduler.view();
        let view = scheduler.tick(Instant::now());
        drop(scheduler);
        if before.presence != view.presence {
            self.events.emit(EngineEvent::PresenceChanged);
        }
        view
    }

    pub fn view(&self) -> ScheduledView {
        self.scheduler.lock().view()
    }

    pub fn all(&self) -> Vec<ActivitySnapshot> {
        self.scheduler.lock().all()
    }

    pub fn set_peek(&self, hovering: bool) -> ScheduledView {
        let scheduler = self.scheduler.lock();
        let mut view = scheduler.view();
        if hovering && !view.sticky && view.presence == Presence::Resting {
            view.presence = Presence::Peek;
        }
        view
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IslandState {
    pub presence: Presence,
    pub sticky: bool,
    pub activities: Vec<ActivitySnapshot>,
}
