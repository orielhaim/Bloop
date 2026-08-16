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
        {
            let scheduler = self.scheduler.lock();
            if scheduler
                .latest(&snapshot.activity_id)
                .is_some_and(|existing| existing.same_face(&snapshot))
            {
                return scheduler.view();
            }
        }
        let view = self.scheduler.lock().publish(snapshot, Instant::now());
        self.events.emit(EngineEvent::PresenceChanged);
        view
    }

    pub fn dismiss(&self, activity_id: &str) -> ScheduledView {
        let view = self.scheduler.lock().dismiss(activity_id);
        self.events.emit(EngineEvent::ActivityDismissed {
            activity_id: activity_id.to_string(),
        });
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
        if before.presence != view.presence
            || before.activity.as_ref().map(|item| &item.activity_id)
                != view.activity.as_ref().map(|item| &item.activity_id)
        {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandState {
    pub presence: Presence,
    pub sticky: bool,
    pub activity: Option<ActivitySnapshot>,
    pub activities: Vec<ActivitySnapshot>,
}
