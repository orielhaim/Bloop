use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::EngineResult;
use crate::events::{Signal, Subscription};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    pub volume: f32,
    pub muted: bool,
}

impl AudioState {
    pub fn same_face(&self, other: &Self) -> bool {
        self.volume == other.volume && self.muted == other.muted
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            volume: 1.0,
            muted: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<AudioDeviceMetadata>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceMetadata {
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AudioEvent {
    StateChanged {
        state: AudioState,
        output: Option<AudioDevice>,
    },
    DeviceChanged {
        device: AudioDevice,
    },
}

pub trait AudioBackend: Send + Sync {
    fn state(&self) -> AudioState;
    fn output(&self) -> Option<AudioDevice>;
    fn devices(&self) -> Vec<AudioDevice>;
    fn set_volume(&self, volume: f32) -> EngineResult<()>;
    fn set_mute(&self, muted: bool) -> EngineResult<()>;
}

#[derive(Default)]
pub struct NullAudio;

impl AudioBackend for NullAudio {
    fn state(&self) -> AudioState {
        AudioState {
            volume: 1.0,
            muted: false,
        }
    }
    fn output(&self) -> Option<AudioDevice> {
        None
    }
    fn devices(&self) -> Vec<AudioDevice> {
        Vec::new()
    }
    fn set_volume(&self, _volume: f32) -> EngineResult<()> {
        Err(crate::error::EngineError::Unsupported(
            "audio is unavailable".into(),
        ))
    }
    fn set_mute(&self, _muted: bool) -> EngineResult<()> {
        Err(crate::error::EngineError::Unsupported(
            "audio is unavailable".into(),
        ))
    }
}

pub struct AudioService {
    backend: Arc<dyn AudioBackend>,
    events: Signal<AudioEvent>,
    last: parking_lot::Mutex<Option<AudioState>>,
}

impl AudioService {
    pub fn connect() -> Arc<Self> {
        let slot: Arc<parking_lot::Mutex<Option<Arc<Self>>>> =
            Arc::new(parking_lot::Mutex::new(None));
        let slot_for_backend = slot.clone();
        let backend = crate::capabilities::coreaudio::start(Arc::new(move |event| {
            if let Some(service) = slot_for_backend.lock().as_ref() {
                service.emit(event);
            }
        }));
        let service = Arc::new(Self::new(backend));
        *slot.lock() = Some(service.clone());
        service
    }

    pub fn new(backend: Arc<dyn AudioBackend>) -> Self {
        Self {
            backend,
            events: Signal::new(),
            last: parking_lot::Mutex::new(None),
        }
    }

    /// Subscribe to audio events; drop the subscription to unsubscribe.
    pub fn subscribe(
        &self,
        listener: impl Fn(&AudioEvent) + Send + Sync + 'static,
    ) -> Subscription {
        self.events.subscribe(listener)
    }

    /// Deliver a raw change reported by the native backend, suppressing events
    /// whose semantic state is identical to the last one emitted.
    pub fn emit(&self, event: AudioEvent) {
        let face = match &event {
            AudioEvent::StateChanged { state, .. } => Some(*state),
            AudioEvent::DeviceChanged { .. } => None,
        };
        let mut last = self.last.lock();
        if let Some(face) = face
            && last
                .as_ref()
                .is_some_and(|current| current.same_face(&face))
        {
            return;
        }
        if let Some(face) = face {
            *last = Some(face);
        }
        drop(last);
        self.events.emit(&event);
    }

    pub fn state(&self) -> AudioState {
        self.backend.state()
    }

    pub fn output(&self) -> Option<AudioDevice> {
        self.backend.output()
    }

    pub fn devices(&self) -> Vec<AudioDevice> {
        self.backend.devices()
    }

    pub fn set_volume(&self, volume: f32) -> EngineResult<()> {
        self.backend.set_volume(volume.clamp(0.0, 1.0))
    }

    pub fn set_mute(&self, muted: bool) -> EngineResult<()> {
        self.backend.set_mute(muted)
    }

    pub fn toggle_mute(&self) -> EngineResult<()> {
        self.backend.set_mute(!self.backend.state().muted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::EngineError;

    struct FakeAudio {
        state: parking_lot::Mutex<AudioState>,
    }

    impl FakeAudio {
        fn new(volume: f32, muted: bool) -> Self {
            Self {
                state: parking_lot::Mutex::new(AudioState { volume, muted }),
            }
        }
    }

    impl AudioBackend for FakeAudio {
        fn state(&self) -> AudioState {
            *self.state.lock()
        }
        fn output(&self) -> Option<AudioDevice> {
            Some(AudioDevice {
                id: "out-1".into(),
                name: "Speakers".into(),
                active: true,
                metadata: Some(AudioDeviceMetadata { default: true }),
            })
        }
        fn devices(&self) -> Vec<AudioDevice> {
            self.output().into_iter().collect()
        }
        fn set_volume(&self, volume: f32) -> EngineResult<()> {
            self.state.lock().volume = volume;
            Ok(())
        }
        fn set_mute(&self, muted: bool) -> EngineResult<()> {
            self.state.lock().muted = muted;
            Ok(())
        }
    }

    fn snapshot(state: AudioState) -> AudioEvent {
        AudioEvent::StateChanged {
            state,
            output: Some(AudioDevice {
                id: "out-1".into(),
                name: "Speakers".into(),
                active: true,
                metadata: Some(AudioDeviceMetadata { default: true }),
            }),
        }
    }

    #[test]
    fn initial_state_is_reported() {
        let service = AudioService::new(Arc::new(FakeAudio::new(0.72, false)));
        assert_eq!(service.state().volume, 0.72);
        assert!(!service.state().muted);
    }

    #[test]
    fn duplicate_events_are_suppressed() {
        let service = AudioService::new(Arc::new(FakeAudio::new(0.5, false)));
        let events: parking_lot::Mutex<Vec<AudioEvent>> = parking_lot::Mutex::new(Vec::new());
        let seen = Arc::new(events);
        let listener = seen.clone();
        let _sub = service.subscribe(move |event| listener.lock().push(event.clone()));

        service.emit(snapshot(AudioState {
            volume: 0.5,
            muted: false,
        }));
        service.emit(snapshot(AudioState {
            volume: 0.5,
            muted: false,
        }));
        assert_eq!(seen.lock().len(), 1);
    }

    #[test]
    fn volume_update_emits_once_per_change() {
        let service = AudioService::new(Arc::new(FakeAudio::new(0.4, false)));
        let events: parking_lot::Mutex<Vec<AudioEvent>> = parking_lot::Mutex::new(Vec::new());
        let seen = Arc::new(events);
        let listener = seen.clone();
        let _sub = service.subscribe(move |event| listener.lock().push(event.clone()));

        for volume in [0.4, 0.42, 0.44, 0.46, 0.48, 0.5] {
            service.emit(snapshot(AudioState {
                volume,
                muted: false,
            }));
        }
        assert_eq!(seen.lock().len(), 6);
    }

    #[test]
    fn mute_unmute_emit_and_operate() {
        let backend = Arc::new(FakeAudio::new(0.6, false));
        let service = AudioService::new(backend.clone());
        let events: parking_lot::Mutex<Vec<AudioEvent>> = parking_lot::Mutex::new(Vec::new());
        let seen = Arc::new(events);
        let listener = seen.clone();
        let _sub = service.subscribe(move |event| listener.lock().push(event.clone()));

        service.set_mute(true).unwrap();
        service.emit(snapshot(service.state()));
        assert!(service.state().muted);
        service.toggle_mute().unwrap();
        assert!(!service.state().muted);

        assert!(matches!(service.set_volume(1.5), Ok(())));
        assert_eq!(service.state().volume, 1.0);
        assert!(matches!(service.set_volume(-0.1), Ok(())));
        assert_eq!(service.state().volume, 0.0);
        assert_eq!(
            seen.lock().len(),
            1,
            "only the explicit mute event was forwarded"
        );
    }

    #[test]
    fn device_changes_are_always_forwarded() {
        let service = AudioService::new(Arc::new(FakeAudio::new(0.5, false)));
        let events: parking_lot::Mutex<Vec<AudioEvent>> = parking_lot::Mutex::new(Vec::new());
        let seen = Arc::new(events);
        let listener = seen.clone();
        let _sub = service.subscribe(move |event| listener.lock().push(event.clone()));

        let device = AudioDevice {
            id: "out-1".into(),
            name: "Speakers".into(),
            active: true,
            metadata: Some(AudioDeviceMetadata { default: true }),
        };
        service.emit(AudioEvent::DeviceChanged {
            device: device.clone(),
        });
        service.emit(AudioEvent::DeviceChanged { device });
        assert_eq!(seen.lock().len(), 2, "device changes are not deduplicated");
    }

    #[test]
    fn null_audio_reports_unsupported_operations() {
        let service = AudioService::new(Arc::new(NullAudio));
        assert!(matches!(
            service.set_volume(0.5),
            Err(EngineError::Unsupported(_))
        ));
        assert!(service.state().volume > 0.0);
        assert!(service.output().is_none());
    }

    /// Exercises the real Windows Core Audio session. Run with
    /// `cargo test -p bloop-core -- --ignored windows_audio`.
    #[test]
    #[ignore]
    fn windows_audio_initializes() {
        let service = AudioService::connect();
        let state = service.state();
        eprintln!("windows audio state: {state:?}");
        assert!((0.0..=1.0).contains(&state.volume));
        let devices = service.devices();
        for device in &devices {
            eprintln!("  {device:?}");
        }
        assert!(!devices.is_empty(), "expected at least one output device");
    }

    /// Verifies a volume change flows through the real backend callback into the
    /// service signal (temporarily nudges the system volume by ~1%, then
    /// restores it). Run with `cargo test -p bloop-core -- --ignored`.
    #[test]
    #[ignore]
    fn windows_audio_emits_on_change() {
        let service = AudioService::connect();
        let events = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let listener = events.clone();
        let _sub = service.subscribe(move |event: &AudioEvent| {
            listener.lock().push(event.clone());
        });
        let current = service.state();
        let target = if current.volume > 0.5 {
            current.volume - 0.01
        } else {
            current.volume + 0.01
        };
        service.set_volume(target).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1_200));
        let got = events.lock().clone();
        eprintln!("emitted events on volume change: {got:?}");
        service.set_volume(current.volume).unwrap();
        assert!(
            !got.is_empty(),
            "setting volume to {target} from {current:?} should emit an event"
        );
    }
}
