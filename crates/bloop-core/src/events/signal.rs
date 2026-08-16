use std::sync::Arc;

use parking_lot::Mutex;

/// A multicast signal with drop-based subscriptions.
///
/// Listeners are invoked without holding the internal lock, and dropping the
/// returned [`Subscription`] removes the listener. This is the single event
/// primitive used across the native capability services and the engine event
/// bus, replacing hand-rolled `Vec<Arc<dyn Fn(...)>>` listener lists.
pub struct Signal<T> {
    core: Arc<Core<T>>,
}

struct Core<T> {
    listeners: Mutex<Vec<Listener<T>>>,
    next_id: Mutex<u64>,
}

struct Listener<T> {
    id: u64,
    callback: Arc<dyn Fn(&T) + Send + Sync>,
}

impl<T: 'static> Clone for Listener<T> {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            callback: self.callback.clone(),
        }
    }
}

impl<T: 'static> Signal<T> {
    pub fn new() -> Self {
        Self {
            core: Arc::new(Core {
                listeners: Mutex::new(Vec::new()),
                next_id: Mutex::new(1),
            }),
        }
    }

    /// Register a listener. The returned subscription unsubscribes on drop.
    pub fn subscribe(&self, callback: impl Fn(&T) + Send + Sync + 'static) -> Subscription {
        let id = {
            let mut next = self.core.next_id.lock();
            let id = *next;
            *next += 1;
            id
        };
        self.core.listeners.lock().push(Listener {
            id,
            callback: Arc::new(callback),
        });
        let core = Arc::downgrade(&self.core);
        Subscription {
            unsub: Some(Box::new(move || {
                if let Some(core) = core.upgrade() {
                    core.listeners.lock().retain(|listener| listener.id != id);
                }
            })),
        }
    }

    /// Deliver a value to every listener. The lock is released before any
    /// callback runs, so listeners may subscribe/unsubscribe or emit freely.
    pub fn emit(&self, value: &T) {
        let listeners = self.core.listeners.lock().clone();
        for listener in listeners {
            (listener.callback)(value);
        }
    }

    pub fn len(&self) -> usize {
        self.core.listeners.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl<T: 'static> Default for Signal<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Clone for Signal<T> {
    fn clone(&self) -> Self {
        Self {
            core: self.core.clone(),
        }
    }
}

/// Cancels its signal subscription when dropped.
pub struct Subscription {
    unsub: Option<Box<dyn Fn() + Send + Sync>>,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(unsub) = self.unsub.take() {
            unsub();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn listeners_are_called_without_lock_held() {
        let signal = Signal::new();
        let seen = Arc::new(AtomicUsize::new(0));
        let counter = seen.clone();
        let _sub = signal.subscribe(move |value: &usize| {
            counter.fetch_add(*value, Ordering::Relaxed);
        });
        signal.emit(&3);
        signal.emit(&4);
        assert_eq!(seen.load(Ordering::Relaxed), 7);
    }

    #[test]
    fn dropping_subscription_unsubscribes() {
        let signal = Signal::new();
        let seen = Arc::new(AtomicUsize::new(0));
        let first = seen.clone();
        let sub = signal.subscribe(move |_: &usize| {
            first.fetch_add(1, Ordering::Relaxed);
        });
        signal.emit(&1);
        drop(sub);
        signal.emit(&1);
        assert_eq!(seen.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn signal_can_be_cloned_and_shared() {
        let signal = Signal::new();
        let cloned = signal.clone();
        let seen = Arc::new(AtomicUsize::new(0));
        let counter = seen.clone();
        let _sub = signal.subscribe(move |_: &usize| {
            counter.fetch_add(1, Ordering::Relaxed);
        });
        cloned.emit(&0);
        assert_eq!(seen.load(Ordering::Relaxed), 1);
    }
}
