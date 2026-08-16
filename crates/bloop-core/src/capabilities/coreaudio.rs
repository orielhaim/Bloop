use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use parking_lot::{Condvar, Mutex};

use super::{AudioBackend, AudioDevice, AudioDeviceMetadata, AudioEvent, AudioState};
use crate::error::EngineResult;

pub fn start(on_event: Arc<dyn Fn(AudioEvent) + Send + Sync>) -> Arc<dyn AudioBackend> {
    #[cfg(windows)]
    {
        CoreAudioBackend::start(on_event)
    }
    #[cfg(not(windows))]
    {
        let _ = on_event;
        Arc::new(super::NullAudio)
    }
}

/// Windows Core Audio backend.
///
/// The native audio session (endpoint volume + device notifications) lives on a
/// dedicated COM apartment thread. Queries read a cached snapshot; operations are
/// shipped to the audio thread where the COM objects are bound. Changes arrive as
/// COM callbacks (IAudioEndpointVolumeCallback / IMMNotificationClient), never as
/// polling.
#[cfg(windows)]
pub struct CoreAudioBackend {
    tx: Mutex<Option<mpsc::Sender<AudioOp>>>,
    cache: Arc<Mutex<Cached>>,
    ready: Arc<Condvar>,
}

#[cfg(windows)]
#[derive(Clone, Default)]
struct Cached {
    state: AudioState,
    output: Option<AudioDevice>,
    devices: Vec<AudioDevice>,
    ready: bool,
}

#[cfg(windows)]
enum AudioOp {
    SetVolume(f32),
    SetMute(bool),
    #[allow(dead_code)]
    Shutdown,
}

#[cfg(windows)]
impl CoreAudioBackend {
    fn start(on_event: Arc<dyn Fn(AudioEvent) + Send + Sync>) -> Arc<dyn AudioBackend> {
        let (tx, rx) = mpsc::channel();
        let cache = Arc::new(Mutex::new(Cached::default()));
        let ready = Arc::new(Condvar::new());
        let thread_cache = cache.clone();
        let thread_ready = ready.clone();
        std::thread::Builder::new()
            .name("bloop-audio".into())
            .spawn(move || run_audio_thread(rx, on_event, thread_cache, thread_ready))
            .ok();
        Arc::new(Self {
            tx: Mutex::new(Some(tx)),
            cache,
            ready,
        })
    }

    fn cached(&self) -> Cached {
        let mut guard = self.cache.lock();
        let deadline = Instant::now() + Duration::from_millis(800);
        while !guard.ready {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            if self.ready.wait_for(&mut guard, remaining).timed_out() {
                break;
            }
        }
        guard.clone()
    }

    fn send(&self, op: AudioOp) {
        if let Some(tx) = self.tx.lock().as_ref() {
            let _ = tx.send(op);
        }
    }
}

#[cfg(windows)]
impl AudioBackend for CoreAudioBackend {
    fn state(&self) -> AudioState {
        self.cached().state
    }

    fn output(&self) -> Option<AudioDevice> {
        self.cached().output
    }

    fn devices(&self) -> Vec<AudioDevice> {
        self.cached().devices
    }

    fn set_volume(&self, volume: f32) -> EngineResult<()> {
        self.send(AudioOp::SetVolume(volume.clamp(0.0, 1.0)));
        Ok(())
    }

    fn set_mute(&self, muted: bool) -> EngineResult<()> {
        self.send(AudioOp::SetMute(muted));
        Ok(())
    }
}

#[cfg(windows)]
struct AudioShared {
    session: Mutex<Option<AudioSession>>,
    on_event: Arc<dyn Fn(AudioEvent) + Send + Sync>,
    cache: Arc<Mutex<Cached>>,
}

#[cfg(windows)]
type EndpointVolume = windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
#[cfg(windows)]
type EndpointVolumeCallback =
    windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback;

#[cfg(windows)]
struct AudioSession {
    enumerator: windows::Win32::Media::Audio::IMMDeviceEnumerator,
    volume: EndpointVolume,
    volume_callback: Option<EndpointVolumeCallback>,
    #[allow(dead_code)]
    notification: Option<windows::Win32::Media::Audio::IMMNotificationClient>,
    device: AudioDevice,
}

#[cfg(windows)]
#[windows::core::implement(windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback)]
struct VolumeCallback {
    shared: Arc<AudioShared>,
}

#[cfg(windows)]
impl windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(
        &self,
        pnotify: *mut windows::Win32::Media::Audio::AUDIO_VOLUME_NOTIFICATION_DATA,
    ) -> windows::core::Result<()> {
        if pnotify.is_null() {
            return Ok(());
        }
        let data = unsafe { &*pnotify };
        let state = AudioState {
            volume: data.fMasterVolume.clamp(0.0, 1.0),
            muted: data.bMuted.as_bool(),
        };
        {
            let mut cache = self.shared.cache.lock();
            cache.state = state;
        }
        let output = self.shared.session.lock().as_ref().map(|s| s.device.clone());
        (self.shared.on_event)(AudioEvent::StateChanged { state, output });
        Ok(())
    }
}

#[cfg(windows)]
#[windows::core::implement(windows::Win32::Media::Audio::IMMNotificationClient)]
struct DeviceCallback {
    shared: Arc<AudioShared>,
}

#[cfg(windows)]
impl windows::Win32::Media::Audio::IMMNotificationClient_Impl for DeviceCallback_Impl {
    fn OnDefaultDeviceChanged(
        &self,
        flow: windows::Win32::Media::Audio::EDataFlow,
        role: windows::Win32::Media::Audio::ERole,
        _id: &windows::core::PCWSTR,
    ) -> windows::core::Result<()> {
        use windows::Win32::Media::Audio::{eConsole, eRender};
        if flow == eRender && role == eConsole {
            self.rebind_default();
        }
        Ok(())
    }

    fn OnDeviceStateChanged(
        &self,
        _id: &windows::core::PCWSTR,
        _state: windows::Win32::Media::Audio::DEVICE_STATE,
    ) -> windows::core::Result<()> {
        Ok(())
    }

    fn OnDeviceAdded(&self, _id: &windows::core::PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }

    fn OnDeviceRemoved(&self, _id: &windows::core::PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }

    fn OnPropertyValueChanged(
        &self,
        _id: &windows::core::PCWSTR,
        _key: &windows::Win32::Foundation::PROPERTYKEY,
    ) -> windows::core::Result<()> {
        Ok(())
    }
}

#[cfg(windows)]
impl DeviceCallback_Impl {
    fn rebind_default(&self) {
        use windows::Win32::Media::Audio::{eConsole, eRender};
        use windows::Win32::System::Com::CLSCTX_ALL;

        let (enumerator, device) = {
            let session = self.shared.session.lock();
            let Some(session) = session.as_ref() else {
                return;
            };
            match unsafe { session.enumerator.GetDefaultAudioEndpoint(eRender, eConsole) } {
                Ok(device) => (session.enumerator.clone(), device),
                Err(_) => return,
            }
        };
        let Ok(audio_device) = describe_device(&device, true) else {
            return;
        };

        // Unregister the previous volume callback from the previous endpoint.
        {
            let session = self.shared.session.lock();
            let volume = session.as_ref().map(|s| s.volume.clone());
            let callback = session.as_ref().and_then(|s| s.volume_callback.clone());
            if let (Some(volume), Some(callback)) = (volume, callback) {
                let _ = unsafe { volume.UnregisterControlChangeNotify(&callback) };
            }
        }

        let volume = match unsafe {
            device.Activate::<EndpointVolume>(CLSCTX_ALL, None)
        } {
            Ok(volume) => volume,
            Err(_) => return,
        };
        let callback: EndpointVolumeCallback = VolumeCallback {
            shared: self.shared.clone(),
        }
        .into();
        if unsafe { volume.RegisterControlChangeNotify(&callback) }.is_err() {
            return;
        }

        {
            let mut session = self.shared.session.lock();
            if let Some(session) = session.as_mut() {
                session.volume = volume;
                session.volume_callback = Some(callback);
                session.device = audio_device.clone();
            }
        }
        let devices = enumerate_devices(&enumerator, &audio_device.id);
        {
            let mut cache = self.shared.cache.lock();
            cache.output = Some(audio_device.clone());
            cache.devices = devices;
        }
        (self.shared.on_event)(AudioEvent::DeviceChanged { device: audio_device });
    }
}

#[cfg(windows)]
fn describe_device(
    device: &windows::Win32::Media::Audio::IMMDevice,
    default: bool,
) -> Result<AudioDevice, ()> {
    let id = device_id(device)?;
    let name = device_name(device).unwrap_or_else(|| id.clone());
    Ok(AudioDevice {
        id,
        name,
        active: default,
        metadata: Some(AudioDeviceMetadata { default }),
    })
}

#[cfg(windows)]
fn run_audio_thread(
    rx: mpsc::Receiver<AudioOp>,
    on_event: Arc<dyn Fn(AudioEvent) + Send + Sync>,
    cache: Arc<Mutex<Cached>>,
    ready: Arc<Condvar>,
) {
    use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let shared = Arc::new(AudioShared {
        session: Mutex::new(None),
        on_event,
        cache: cache.clone(),
    });
    if let Err(error) = setup_audio(&shared) {
        tracing::error!(%error, "failed to initialize audio notifications");
    }
    {
        let mut guard = cache.lock();
        guard.ready = true;
        ready.notify_all();
    }
    pump_messages(rx, &shared);
    unsafe {
        CoUninitialize();
    }
}

#[cfg(windows)]
fn setup_audio(shared: &Arc<AudioShared>) -> Result<(), String> {
    use windows::Win32::Media::Audio::{eConsole, eRender};
    use windows::Win32::System::Com::CLSCTX_ALL;

    let enumerator: windows::Win32::Media::Audio::IMMDeviceEnumerator = unsafe {
        windows::Win32::System::Com::CoCreateInstance(
            &windows::core::GUID::from_u128(0xbcde0395_e52f_467c_8e3d_c4579291692e),
            None,
            CLSCTX_ALL,
        )
    }
    .map_err(|error| error.to_string())?;
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
        .map_err(|error| error.to_string())?;
    let output = describe_device(&device, true).map_err(|()| {
        "unable to describe default audio device".to_string()
    })?;
    let volume: EndpointVolume = unsafe { device.Activate::<EndpointVolume>(CLSCTX_ALL, None) }
        .map_err(|error| error.to_string())?;

    let level = unsafe { volume.GetMasterVolumeLevelScalar() }
        .map_err(|error| error.to_string())?;
    let muted = unsafe { volume.GetMute() }.map_err(|error| error.to_string())?;
    let state = AudioState {
        volume: level.clamp(0.0, 1.0),
        muted: muted.as_bool(),
    };

    let volume_callback: EndpointVolumeCallback = VolumeCallback {
        shared: shared.clone(),
    }
    .into();
    unsafe { volume.RegisterControlChangeNotify(&volume_callback) }
        .map_err(|error| error.to_string())?;
    let notification: windows::Win32::Media::Audio::IMMNotificationClient = DeviceCallback {
        shared: shared.clone(),
    }
    .into();
    unsafe { enumerator.RegisterEndpointNotificationCallback(&notification) }
        .map_err(|error| error.to_string())?;

    let devices = enumerate_devices(&enumerator, &output.id);
    *shared.session.lock() = Some(AudioSession {
        enumerator,
        volume,
        volume_callback: Some(volume_callback),
        notification: Some(notification),
        device: output.clone(),
    });
    let mut cache = shared.cache.lock();
    cache.state = state;
    cache.output = Some(output);
    cache.devices = devices;
    Ok(())
}

#[cfg(windows)]
fn enumerate_devices(
    enumerator: &windows::Win32::Media::Audio::IMMDeviceEnumerator,
    default_id: &str,
) -> Vec<AudioDevice> {
    use windows::Win32::Media::Audio::{DEVICE_STATE_ACTIVE, eRender};
    let collection = match unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) } {
        Ok(collection) => collection,
        Err(_) => return Vec::new(),
    };
    let count = match unsafe { collection.GetCount() } {
        Ok(count) => count,
        Err(_) => return Vec::new(),
    };
    let mut devices = Vec::with_capacity(count as usize);
    for index in 0..count {
        let device = match unsafe { collection.Item(index) } {
            Ok(device) => device,
            Err(_) => continue,
        };
        let Some(id) = device_id(&device).ok() else {
            continue;
        };
        let name = device_name(&device).unwrap_or_else(|| id.clone());
        let active = id == default_id;
        devices.push(AudioDevice {
            id,
            name,
            active,
            metadata: Some(AudioDeviceMetadata { default: active }),
        });
    }
    devices
}

#[cfg(windows)]
fn device_id(device: &windows::Win32::Media::Audio::IMMDevice) -> Result<String, ()> {
    use windows::Win32::System::Com::CoTaskMemFree;
    unsafe {
        let raw = device.GetId().map_err(|_| ())?;
        let id = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void));
        Ok(id)
    }
}

#[cfg(windows)]
fn device_name(device: &windows::Win32::Media::Audio::IMMDevice) -> Option<String> {
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Com::STGM_READ;
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    unsafe {
        let store: IPropertyStore = device.OpenPropertyStore(STGM_READ).ok()?;
        let key = windows::Win32::Foundation::PROPERTYKEY {
            fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
            pid: 14,
        };
        let mut propvar = store.GetValue(&key).ok()?;
        let vt = propvar.Anonymous.Anonymous.vt;
        let name = if vt == VT_LPWSTR {
            propvar
                .Anonymous
                .Anonymous
                .Anonymous
                .pwszVal
                .to_string()
                .ok()
        } else {
            None
        };
        let _ = PropVariantClear(&mut propvar);
        name
    }
}

#[cfg(windows)]
fn pump_messages(rx: mpsc::Receiver<AudioOp>, shared: &Arc<AudioShared>) {
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PM_REMOVE, PeekMessageW, TranslateMessage, WM_QUIT,
    };
    let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
    loop {
        let mut quit = false;
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() } {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if msg.message == WM_QUIT {
                quit = true;
            }
        }
        if quit {
            return;
        }
        match rx.try_recv() {
            Ok(AudioOp::SetVolume(volume)) => {
                if let Some(session) = shared.session.lock().as_ref() {
                    let _ = unsafe { session.volume.SetMasterVolumeLevelScalar(volume, std::ptr::null()) };
                }
            }
            Ok(AudioOp::SetMute(muted)) => {
                if let Some(session) = shared.session.lock().as_ref() {
                    let _ = unsafe { session.volume.SetMute(muted, std::ptr::null()) };
                }
            }
            Ok(AudioOp::Shutdown) => return,
            Err(mpsc::TryRecvError::Disconnected) => return,
            Err(mpsc::TryRecvError::Empty) => {}
        }
        std::thread::sleep(Duration::from_millis(8));
    }
}
