use std::collections::{HashMap, VecDeque};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::model::{ActivitySnapshot, PresentationMode};
use crate::metrics::Presence;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledView {
    pub presence: Presence,
    pub activity: Option<ActivitySnapshot>,
    pub sticky: bool,
}

#[derive(Debug, Clone)]
struct LiveActivity {
    snapshot: ActivitySnapshot,
    until: Option<Instant>,
}

#[derive(Debug, Default)]
pub struct ActivityScheduler {
    current: Option<LiveActivity>,
    parked: Option<LiveActivity>,
    queue: VecDeque<LiveActivity>,
    latest: HashMap<String, ActivitySnapshot>,
    user_expanded: bool,
}

impl ActivityScheduler {
    pub fn publish(&mut self, snapshot: ActivitySnapshot, now: Instant) -> ScheduledView {
        if self
            .latest
            .get(&snapshot.activity_id)
            .is_some_and(|existing| existing.same_face(&snapshot))
        {
            return self.view();
        }
        self.latest
            .insert(snapshot.activity_id.clone(), snapshot.clone());
        let incoming = LiveActivity {
            until: snapshot
                .lifetime_ms
                .map(|ms| now + std::time::Duration::from_millis(u64::from(ms))),
            snapshot,
        };

        if self.user_expanded {
            if incoming.snapshot.mode == PresentationMode::Presentation
                && self.can_preempt(incoming.snapshot.priority)
            {
                if let Some(current) = self.current.take()
                    && current.snapshot.activity_id != incoming.snapshot.activity_id
                {
                    self.parked = Some(current);
                }
                self.current = Some(incoming);
            } else {
                self.retain_current(incoming);
            }
            return self.view();
        }

        if self.current.is_none() {
            self.current = Some(incoming);
            return self.view();
        }

        if self.can_preempt(incoming.snapshot.priority) {
            if let Some(current) = self.current.take()
                && current.snapshot.activity_id != incoming.snapshot.activity_id
            {
                self.parked = Some(current);
            }
            self.current = Some(incoming);
        } else if incoming.snapshot.activity_id
            == self
                .current
                .as_ref()
                .map(|c| c.snapshot.activity_id.as_str())
                .unwrap_or_default()
        {
            self.current = Some(incoming);
        } else {
            self.queue.push_back(incoming);
        }

        self.view()
    }

    pub fn dismiss(&mut self, activity_id: &str) -> ScheduledView {
        self.latest.remove(activity_id);
        self.queue
            .retain(|item| item.snapshot.activity_id != activity_id);
        if self
            .current
            .as_ref()
            .is_some_and(|c| c.snapshot.activity_id == activity_id)
        {
            self.current = None;
            self.resume_parked();
        }
        if self
            .parked
            .as_ref()
            .is_some_and(|c| c.snapshot.activity_id == activity_id)
        {
            self.parked = None;
        }
        self.view()
    }

    pub fn open_home(&mut self) -> ScheduledView {
        self.user_expanded = true;
        self.view()
    }

    pub fn collapse(&mut self) -> ScheduledView {
        self.user_expanded = false;
        self.sync_current_from_latest();
        self.view()
    }

    pub fn peek(&mut self) -> ScheduledView {
        if !self.user_expanded {
            // presence is derived in view()
        }
        self.view()
    }

    pub fn tick(&mut self, now: Instant) -> ScheduledView {
        if let Some(current) = &self.current
            && let Some(until) = current.until
            && now >= until
            && !self.user_expanded
        {
            let finished_id = current.snapshot.activity_id.clone();
            if current.snapshot.mode == PresentationMode::Presentation {
                self.current = None;
                self.resume_parked();
                if self
                    .current
                    .as_ref()
                    .is_some_and(|c| c.snapshot.activity_id == finished_id)
                {
                    self.current = None;
                }
            }
        }
        self.view()
    }

    pub fn latest(&self, activity_id: &str) -> Option<&ActivitySnapshot> {
        self.latest.get(activity_id)
    }

    pub fn all(&self) -> Vec<ActivitySnapshot> {
        self.latest.values().cloned().collect()
    }

    pub fn view(&self) -> ScheduledView {
        if self.user_expanded {
            if let Some(current) = &self.current
                && current.snapshot.mode == PresentationMode::Presentation
            {
                return ScheduledView {
                    presence: Presence::Presentation,
                    activity: Some(current.snapshot.clone()),
                    sticky: true,
                };
            }
            return ScheduledView {
                presence: Presence::Expanded,
                activity: self.current.as_ref().map(|c| c.snapshot.clone()),
                sticky: true,
            };
        }

        if let Some(current) = &self.current {
            let presence = match current.snapshot.mode {
                PresentationMode::Presentation => Presence::Presentation,
                PresentationMode::Peek => Presence::Peek,
                PresentationMode::Expanded => Presence::Expanded,
                PresentationMode::Compact => Presence::Resting,
            };
            return ScheduledView {
                presence,
                activity: Some(current.snapshot.clone()),
                sticky: false,
            };
        }

        ScheduledView {
            presence: Presence::Resting,
            activity: None,
            sticky: false,
        }
    }

    fn can_preempt(&self, incoming_priority: u8) -> bool {
        let Some(current) = &self.current else {
            return true;
        };
        incoming_priority > current.snapshot.priority
            || (incoming_priority == current.snapshot.priority && current.snapshot.interruptible)
            || current.snapshot.interruptible && incoming_priority >= current.snapshot.priority
    }

    fn retain_current(&mut self, incoming: LiveActivity) {
        match &self.current {
            Some(current) if current.snapshot.activity_id == incoming.snapshot.activity_id => {
                self.current = Some(incoming);
            }
            None => self.current = Some(incoming),
            Some(_) => {}
        }
    }

    fn sync_current_from_latest(&mut self) {
        let Some(current) = &self.current else {
            return;
        };
        let Some(latest) = self.latest.get(&current.snapshot.activity_id).cloned() else {
            return;
        };
        if let Some(live) = &mut self.current {
            live.snapshot = latest;
        }
    }

    fn resume_parked(&mut self) {
        if let Some(parked) = self.parked.take() {
            self.current = Some(parked);
        } else {
            self.current = self.queue.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::model::PresentationMode;

    fn snap(
        id: &str,
        priority: u8,
        mode: PresentationMode,
        lifetime: Option<u32>,
    ) -> ActivitySnapshot {
        ActivitySnapshot {
            activity_id: id.into(),
            plugin_id: "test".into(),
            priority,
            mode,
            lifetime_ms: lifetime,
            interruptible: true,
            compact: None,
            peek: None,
            presentation: None,
            expanded: None,
            preview: None,
            timestamp_ms: 0,
        }
    }

    #[test]
    fn higher_priority_preempts_and_resumes() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("now-playing", 40, PresentationMode::Compact, None),
            now,
        );
        scheduler.publish(
            snap("volume", 80, PresentationMode::Presentation, Some(1)),
            now,
        );
        let view = scheduler.view();
        assert_eq!(view.activity.unwrap().activity_id, "volume");
        scheduler.tick(now + std::time::Duration::from_millis(2));
        assert_eq!(
            scheduler.view().activity.unwrap().activity_id,
            "now-playing"
        );
    }

    #[test]
    fn user_expanded_is_sticky() {
        let mut scheduler = ActivityScheduler::default();
        scheduler.publish(
            snap("now-playing", 40, PresentationMode::Compact, None),
            Instant::now(),
        );
        scheduler.open_home();
        assert_eq!(scheduler.view().presence, Presence::Expanded);
        assert!(scheduler.view().sticky);
        scheduler.collapse();
        assert!(!scheduler.view().sticky);
    }

    #[test]
    fn expanded_keeps_same_activity_updates() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(snap("now-playing", 40, PresentationMode::Peek, None), now);
        scheduler.open_home();
        let mut playing = snap("now-playing", 40, PresentationMode::Peek, None);
        playing.peek = Some(crate::activity::UiNode::Waveform { active: true });
        scheduler.publish(playing, now);
        scheduler.collapse();
        assert!(matches!(
            scheduler.view().activity.unwrap().peek,
            Some(crate::activity::UiNode::Waveform { active: true })
        ));
    }

    #[test]
    fn timestamp_only_updates_are_ignored() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("now-playing", 40, PresentationMode::Compact, None),
            now,
        );
        let mut next = snap("now-playing", 40, PresentationMode::Compact, None);
        next.timestamp_ms = 2;
        scheduler.publish(next, now);
        assert_eq!(scheduler.view().activity.unwrap().timestamp_ms, 0);
    }

    #[test]
    fn face_changes_replace_same_activity() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("now-playing", 40, PresentationMode::Compact, None),
            now,
        );
        scheduler.publish(snap("now-playing", 40, PresentationMode::Peek, None), now);
        assert_eq!(
            scheduler.view().activity.unwrap().mode,
            PresentationMode::Peek
        );
    }

    #[test]
    fn dismiss_removes_activity() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("now-playing", 40, PresentationMode::Compact, None),
            now,
        );
        scheduler.dismiss("now-playing");
        assert!(scheduler.view().activity.is_none());
    }
}
