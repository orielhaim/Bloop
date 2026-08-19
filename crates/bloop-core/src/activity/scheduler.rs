use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::model::ActivitySnapshot;
use crate::metrics::Presence;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledView {
    pub presence: Presence,
    pub sticky: bool,
}

#[derive(Debug, Clone)]
struct LiveActivity {
    snapshot: ActivitySnapshot,
    /// When this transient stops being relevant, if it has a freshness window.
    until: Option<Instant>,
}

/// The scheduler keeps every published Activity as state. There is no "current"
/// activity that owns the face: presentation is a decision the composition
/// engine makes from the full set of Activities. The scheduler's only jobs are
/// to retain latest state, coalesce group slots, expire transient windows, and
/// track the user's expanded intent.
#[derive(Debug, Default)]
pub struct ActivityScheduler {
    latest: HashMap<String, LiveActivity>,
    /// Latest snapshot per coalescing group, so updates to a group replace the
    /// slot instead of accumulating.
    group_slots: HashMap<String, String>,
    user_expanded: bool,
}

impl ActivityScheduler {
    pub fn publish(&mut self, snapshot: ActivitySnapshot, now: Instant) -> ScheduledView {
        let id = snapshot.activity_id.clone();

        if let Some(group) = snapshot.group.clone() {
            if let Some(slot) = self.group_slots.get(&group).cloned()
                && slot != id
            {
                self.latest.remove(&slot);
            }
            self.group_slots.insert(group, id.clone());
        }

        self.latest.insert(
            id,
            LiveActivity {
                until: snapshot
                    .attention
                    .freshness_ms
                    .or(snapshot.lifetime_ms)
                    .map(|ms| now + std::time::Duration::from_millis(u64::from(ms))),
                snapshot,
            },
        );
        self.view()
    }

    /// Extend the relevance window of a live transient activity.
    pub fn touch(&mut self, activity_id: &str, now: Instant) -> ScheduledView {
        if let Some(live) = self.latest.get_mut(activity_id) {
            if let Some(ms) = live
                .snapshot
                .attention
                .freshness_ms
                .or(live.snapshot.lifetime_ms)
            {
                live.until = Some(now + std::time::Duration::from_millis(u64::from(ms)));
            }
        }
        self.view()
    }

    pub fn dismiss(&mut self, activity_id: &str) -> ScheduledView {
        if let Some(live) = self.latest.remove(activity_id) {
            if let Some(group) = live.snapshot.group {
                self.group_slots.remove(&group);
            }
        }
        self.view()
    }

    pub fn dismiss_plugin(&mut self, plugin_id: &str) -> ScheduledView {
        let ids: Vec<String> = self
            .latest
            .values()
            .filter(|live| live.snapshot.plugin_id == plugin_id)
            .map(|live| live.snapshot.activity_id.clone())
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
        self.view()
    }

    /// Expire transient windows whose time has passed.
    pub fn tick(&mut self, now: Instant) -> ScheduledView {
        let expired: Vec<String> = self
            .latest
            .iter()
            .filter_map(|(id, live)| {
                live.until
                    .is_some_and(|until| now >= until)
                    .then(|| id.clone())
            })
            .collect();
        for id in expired {
            if let Some(live) = self.latest.remove(&id) {
                if let Some(group) = live.snapshot.group {
                    self.group_slots.remove(&group);
                }
            }
        }
        self.view()
    }

    /// Whether the scheduler state has a live transient with takeover intent.
    pub fn has_active_transient(&self) -> bool {
        self.latest.values().any(|live| {
            live.snapshot.attention.takeover_suitable
                && (live.until.is_some() || live.snapshot.is_transient())
        })
    }

    pub fn latest(&self, activity_id: &str) -> Option<&ActivitySnapshot> {
        self.latest.get(activity_id).map(|live| &live.snapshot)
    }

    pub fn all(&self) -> Vec<ActivitySnapshot> {
        self.latest
            .values()
            .map(|live| live.snapshot.clone())
            .collect()
    }

    pub fn view(&self) -> ScheduledView {
        if self.user_expanded {
            return ScheduledView {
                presence: Presence::Expanded,
                sticky: true,
            };
        }
        ScheduledView {
            presence: if self.has_active_transient() {
                Presence::Presentation
            } else {
                Presence::Resting
            },
            sticky: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::model::{ActivityLifecycle, ActivitySnapshot, Attention, Density, PresentationVariant};
    use crate::activity::UiNode;

    fn snap(
        id: &str,
        plugin_id: &str,
        lifecycle: ActivityLifecycle,
        freshness: Option<u32>,
        takeover: bool,
        group: Option<&str>,
    ) -> ActivitySnapshot {
        ActivitySnapshot {
            activity_id: id.into(),
            plugin_id: plugin_id.into(),
            instance_id: None,
            group: group.map(str::to_string),
            lifecycle,
            attention: Attention {
                takeover_suitable: takeover,
                freshness_ms: freshness,
                ..Attention::default()
            },
            deadline_ms: None,
            lifetime_ms: None,
            variants: vec![PresentationVariant {
                density: Density::Compact,
                node: Some(UiNode::Text { text: id.into(), variant: Default::default() }),
                min_width: 40,
                preferred_width: 64,
                max_width: None,
                utility: 0.6,
                min_readable_ms: None,
                coexist: true,
                label: None,
            }],
            expanded: None,
            preview: None,
            timestamp_ms: 0,
        }
    }

    #[test]
    fn resident_activities_persist_as_state() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("timer", "timer", ActivityLifecycle::Countdown, None, false, None),
            now,
        );
        scheduler.publish(
            snap("now-playing", "media", ActivityLifecycle::Ongoing, None, false, None),
            now,
        );
        let all = scheduler.all();
        assert_eq!(all.len(), 2);
        assert_eq!(scheduler.view().presence, Presence::Resting);
    }

    #[test]
    fn transient_expires_after_freshness_window() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("volume", "volume", ActivityLifecycle::Momentary, Some(200), true, None),
            now,
        );
        assert!(scheduler.has_active_transient());
        assert_eq!(scheduler.view().presence, Presence::Presentation);
        scheduler.tick(now + std::time::Duration::from_millis(250));
        assert!(!scheduler.has_active_transient());
        assert!(scheduler.all().is_empty());
        assert_eq!(scheduler.view().presence, Presence::Resting);
    }

    #[test]
    fn coalescing_group_replaces_slot() {
        let mut scheduler = ActivityScheduler::default();
        let now = Instant::now();
        scheduler.publish(
            snap("volume-a", "volume", ActivityLifecycle::Momentary, Some(200), true, Some("sys-audio")),
            now,
        );
        scheduler.publish(
            snap("volume-b", "volume", ActivityLifecycle::Momentary, Some(200), true, Some("sys-audio")),
            now,
        );
        let all = scheduler.all();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].activity_id, "volume-b");
    }

    #[test]
    fn open_and_collapse_home() {
        let mut scheduler = ActivityScheduler::default();
        scheduler.open_home();
        assert_eq!(scheduler.view().presence, Presence::Expanded);
        assert!(scheduler.view().sticky);
        scheduler.collapse();
        assert_eq!(scheduler.view().presence, Presence::Resting);
    }
}
