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
        let same_face = self
            .latest
            .get(&snapshot.activity_id)
            .is_some_and(|existing| existing.same_face(&snapshot));
        if same_face {
            // A no-op update to a live transient presentation still extends it.
            self.touch(&snapshot.activity_id, now);
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

        // Refresh the currently live presentation in place (same activity or
        // same coalescing slot) and extend its timeout.
        let current_coalesces = self
            .current
            .as_ref()
            .is_some_and(|current| same_activity_or_slot(&current.snapshot, &incoming.snapshot));
        if current_coalesces {
            self.current = Some(incoming);
            return self.view();
        }

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

        // An update to an activity that is parked or queued mutates that entry
        // instead of preempting, so the latest state is what resumes later.
        if let Some(queued) = self
            .queue
            .iter_mut()
            .find(|item| item.snapshot.activity_id == incoming.snapshot.activity_id)
        {
            *queued = incoming;
            return self.view();
        }
        if let Some(parked) = self.parked.as_mut()
            && parked.snapshot.activity_id == incoming.snapshot.activity_id
        {
            *parked = incoming;
            return self.view();
        }

        if self.can_preempt(incoming.snapshot.priority) {
            if let Some(current) = self.current.take()
                && current.snapshot.activity_id != incoming.snapshot.activity_id
            {
                self.parked = Some(current);
            }
            self.current = Some(incoming);
        } else {
            self.queue.push_back(incoming);
        }

        self.view()
    }

    /// Extend the presentation of `activity_id` if it is currently live.
    pub fn touch(&mut self, activity_id: &str, now: Instant) -> ScheduledView {
        if let Some(current) = self.current.as_mut()
            && current.snapshot.activity_id == activity_id
            && let Some(lifetime_ms) = current.snapshot.lifetime_ms
        {
            current.until = Some(now + std::time::Duration::from_millis(u64::from(lifetime_ms)));
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

    pub fn dismiss_plugin(&mut self, plugin_id: &str) -> ScheduledView {
        let ids: Vec<String> = self
            .latest
            .values()
            .filter(|snapshot| snapshot.plugin_id == plugin_id)
            .map(|snapshot| snapshot.activity_id.clone())
            .collect();
        for id in ids {
            self.dismiss(&id);
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
                // A one-shot transient is done; it should not linger in the
                // catalog or feed occupant retention.
                self.latest.remove(&finished_id);
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
        if incoming_priority > current.snapshot.priority {
            return true;
        }
        incoming_priority == current.snapshot.priority && current.snapshot.interruptible
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

fn same_activity_or_slot(left: &ActivitySnapshot, right: &ActivitySnapshot) -> bool {
    left.activity_id == right.activity_id
        || (left.coalescing_key.is_some() && left.coalescing_key == right.coalescing_key)
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
            coalescing_key: None,
            preferred_size: None,
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

    #[test]
    fn dismiss_plugin_removes_all_activities_for_that_plugin() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("now-playing", 40, PresentationMode::Compact, None),
            now,
        );
        scheduler.dismiss_plugin("test");
        assert!(scheduler.view().activity.is_none());
        assert!(scheduler.all().is_empty());
    }

    #[test]
    fn updates_extend_presentation_timeout() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("volume", 60, PresentationMode::Presentation, Some(200)),
            now,
        );
        let view = scheduler.view();
        assert_eq!(view.activity.unwrap().activity_id, "volume");

        // An update just inside the window keeps the presentation alive.
        scheduler.publish(
            snap("volume", 60, PresentationMode::Presentation, Some(200)),
            now + std::time::Duration::from_millis(150),
        );
        scheduler.tick(now + std::time::Duration::from_millis(300));
        assert_eq!(scheduler.view().activity.unwrap().activity_id, "volume");

        // After the refreshed window elapses with no updates, it expires.
        scheduler.tick(now + std::time::Duration::from_millis(500));
        assert!(scheduler.view().activity.is_none());
    }

    #[test]
    fn same_face_update_still_extends_timeout() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("volume", 60, PresentationMode::Presentation, Some(100)),
            now,
        );
        scheduler.touch("volume", now + std::time::Duration::from_millis(90));
        scheduler.tick(now + std::time::Duration::from_millis(150));
        assert_eq!(
            scheduler.view().activity.unwrap().activity_id,
            "volume",
            "a touch extends the presentation even for identical faces"
        );
        scheduler.tick(now + std::time::Duration::from_millis(250));
        assert!(scheduler.view().activity.is_none());
    }

    #[test]
    fn parked_activity_gets_latest_state_on_resume() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(snap("now-playing", 40, PresentationMode::Peek, None), now);
        scheduler.publish(
            snap("volume", 60, PresentationMode::Presentation, Some(50)),
            now,
        );
        assert_eq!(scheduler.view().activity.unwrap().activity_id, "volume");

        // While volume presents, now-playing updates its snapshot.
        let mut next = snap("now-playing", 40, PresentationMode::Peek, None);
        next.peek = Some(crate::activity::UiNode::Text {
            text: "latest".into(),
            variant: crate::activity::TextVariant::Title,
        });
        scheduler.publish(next, now);

        scheduler.tick(now + std::time::Duration::from_millis(60));
        let resumed = scheduler.view().activity.unwrap();
        assert_eq!(resumed.activity_id, "now-playing");
        assert_eq!(
            resumed.peek,
            Some(crate::activity::UiNode::Text {
                text: "latest".into(),
                variant: crate::activity::TextVariant::Title,
            })
        );
    }

    #[test]
    fn coalescing_key_merges_slots() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        let mut slot_a = snap("volume-a", 60, PresentationMode::Presentation, Some(100));
        slot_a.coalescing_key = Some("system-audio".into());
        scheduler.publish(slot_a, now);
        assert_eq!(scheduler.view().activity.unwrap().activity_id, "volume-a");

        let mut slot_b = snap("volume-b", 60, PresentationMode::Presentation, Some(100));
        slot_b.coalescing_key = Some("system-audio".into());
        scheduler.publish(slot_b, now);
        assert_eq!(
            scheduler.view().activity.unwrap().activity_id,
            "volume-b",
            "same coalescing slot replaces instead of queuing"
        );
    }

    #[test]
    fn distinct_coalescing_slots_do_not_merge() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        let mut first = snap("volume", 60, PresentationMode::Presentation, Some(100));
        first.coalescing_key = Some("system-audio".into());
        scheduler.publish(first, now);
        let mut second = snap("bluetooth", 60, PresentationMode::Presentation, Some(100));
        second.coalescing_key = Some("system-devices".into());
        scheduler.publish(second, now);
        assert_eq!(scheduler.view().activity.unwrap().activity_id, "bluetooth");
        scheduler.tick(now + std::time::Duration::from_millis(150));
        assert_eq!(scheduler.view().activity.unwrap().activity_id, "volume");
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;
    use std::time::Duration;

    fn snap(
        id: &str,
        priority: u8,
        mode: PresentationMode,
        lifetime: Option<u32>,
    ) -> ActivitySnapshot {
        ActivitySnapshot {
            activity_id: id.into(),
            plugin_id: "prop".into(),
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
            coalescing_key: None,
            preferred_size: None,
        }
    }

    proptest! {
        /// A one-shot transient presentation must never reappear after it
        /// expires, no matter how many later ticks run.
        #[test]
        fn expired_transient_never_returns(
            priority in 1u8..255,
            lifetime_ms in 1u32..10_000u32,
        ) {
            let mut scheduler = ActivityScheduler::default();
            let now = Instant::now();
            scheduler.publish(
                snap("volume", priority, PresentationMode::Presentation, Some(lifetime_ms)),
                now,
            );
            for step in 0..20u64 {
                let at = now + Duration::from_millis(lifetime_ms as u64 + 1 + step * 137);
                scheduler.tick(at);
                let view = scheduler.view();
                if let Some(activity) = &view.activity {
                    assert_ne!(
                        activity.activity_id, "volume",
                        "expired transient must not be current at {step}"
                    );
                } else {
                    assert_eq!(view.presence, Presence::Resting);
                }
            }
        }

        /// View invariants hold for arbitrary interleavings of publishes and
        /// ticks: presence always matches the current activity's mode, and an
        /// absent activity implies the resting presence.
        #[test]
        fn view_consistency_under_random_operations(
            priorities in proptest::collection::vec(1u8..200u8, 1..8),
            modes in proptest::collection::vec(0u8..3u8, 1..8),
            lifetimes in proptest::collection::vec(0u32..2_000u32, 1..8),
            tick_deltas in proptest::collection::vec(0u64..5_000u64, 1..8),
        ) {
            let mut scheduler = ActivityScheduler::default();
            let base = Instant::now();
            for index in 0..8 {
                let mode = match modes.get(index).copied().unwrap_or(0) {
                    0 => PresentationMode::Compact,
                    1 => PresentationMode::Peek,
                    _ => PresentationMode::Presentation,
                };
                let lifetime = lifetimes
                    .get(index)
                    .copied()
                    .filter(|ms| *ms > 0 && mode == PresentationMode::Presentation)
                    .map(|ms| ms as u32);
                scheduler.publish(
                    snap(
                        &format!("a{index}"),
                        priorities.get(index).copied().unwrap_or(40),
                        mode,
                        lifetime,
                    ),
                    base,
                );
                let view = scheduler.view();
                match (&view.activity, view.presence) {
                    (Some(activity), presence) => {
                        let expected = match activity.mode {
                            PresentationMode::Compact => Presence::Resting,
                            PresentationMode::Peek => Presence::Peek,
                            PresentationMode::Presentation => Presence::Presentation,
                            PresentationMode::Expanded => Presence::Expanded,
                        };
                        assert_eq!(presence, expected, "presence must match current mode");
                    }
                    (None, presence) => assert_eq!(presence, Presence::Resting),
                }
                scheduler.tick(
                    base + Duration::from_millis(
                        tick_deltas.get(index).copied().unwrap_or(0) + index as u64,
                    ),
                );
            }
        }

        /// Updating the same activity many times never grows the queue, and the
        /// current view always reflects the latest published face.
        #[test]
        fn same_activity_updates_do_not_queue(
            updates in 1..40usize,
        ) {
            let mut scheduler = ActivityScheduler::default();
            let base = Instant::now();
            scheduler.publish(
                snap("volume", 60, PresentationMode::Presentation, Some(2_000)),
                base,
            );
            for _ in 0..updates {
                scheduler.publish(
                    snap("volume", 60, PresentationMode::Presentation, Some(2_000)),
                    base,
                );
                assert_eq!(
                    scheduler.queue.len(),
                    0,
                    "repeated updates must not accumulate in the queue"
                );
                assert_eq!(
                    scheduler.view().activity.as_ref().map(|a| &a.activity_id),
                    Some(&"volume".to_string())
                );
            }
        }
    }
}
