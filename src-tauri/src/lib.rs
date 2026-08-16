mod commands;
mod dev_watch;
mod fullscreen;
mod hover;
mod metrics;
mod settings_window;
mod tray;
mod windowing;

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use bloop_core::{Engine, ReqwestBackend};
use commands::{AppState, apply_runtime, load_settings, plugin_roots};
use hover::set_island_presence;
use specta_typescript::Typescript;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_specta::{Builder as SpectaBuilder, collect_commands};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing::subscriber::set_global_default(
        tracing_subscriber::fmt()
            .with_env_filter("bloop=info,bloop_core=info")
            .finish(),
    );

    let _specta = SpectaBuilder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::island_state,
            commands::island_open,
            commands::island_collapse,
            commands::activity_action,
            commands::get_settings,
            commands::set_settings,
            commands::set_layout,
            commands::list_plugins,
            commands::enable_plugin,
            commands::disable_plugin,
            commands::reload_plugin,
            commands::uninstall_plugin,
            commands::dismiss_activity,
            commands::list_themes,
            commands::current_theme,
            commands::apply_theme,
            commands::media_artwork,
            commands::list_monitors,
            commands::check_updates,
            set_island_presence,
        ])
        .export(
            Typescript::default(),
            concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/engine/commands.ts"),
        )
        .expect("failed to export specta bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            settings_window::show(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            set_island_presence,
            commands::island_state,
            commands::island_open,
            commands::island_collapse,
            commands::activity_action,
            commands::get_settings,
            commands::set_settings,
            commands::set_layout,
            commands::list_plugins,
            commands::enable_plugin,
            commands::disable_plugin,
            commands::reload_plugin,
            commands::uninstall_plugin,
            commands::dismiss_activity,
            commands::list_themes,
            commands::current_theme,
            commands::apply_theme,
            commands::media_artwork,
            commands::list_monitors,
            commands::check_updates,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);
            let plugin_storage = handle
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("plugin-storage.json"));
            let engine = Arc::new(
                Engine::new(settings, Arc::new(ReqwestBackend), plugin_storage).expect("engine"),
            );
            let event_subscription = engine.events.subscribe(move |event| {
                let _ = handle.emit("engine-event", event);
            });
            let roots = plugin_roots(app.handle());
            engine.load_plugins(&roots);
            #[cfg(debug_assertions)]
            dev_watch::start_plugin_watcher(engine.clone(), roots);
            app.manage(AppState {
                engine: engine.clone(),
                event_subscription,
            });

            let window = windowing::main_window(app)?;
            windowing::configure_island_window(&window, &engine.settings.get().monitor)?;
            apply_runtime(app.handle(), &engine.settings.get());
            tray::attach(app.handle())?;
            fullscreen::start(app.handle().clone());

            thread::spawn(move || {
                loop {
                    thread::sleep(Duration::from_millis(100));
                    engine.activities.tick();
                    engine.devices.tick(std::time::Instant::now());
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if matches!(event, WindowEvent::Focused(_)) {
                let _ = window.set_always_on_top(true);
            }
            if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
                let Some(state) = window.try_state::<AppState>() else {
                    return;
                };
                if let Some(island) = window.app_handle().get_webview_window("main") {
                    let _ = windowing::apply_monitor(&island, &state.engine.settings.get().monitor);
                }
                state
                    .engine
                    .events
                    .emit(bloop_core::EngineEvent::DisplayChanged);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
