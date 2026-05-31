//! Voix companion — Tauri app entry point.
//!
//! Architecture:
//!
//!   HA WebSocket  ──►  ha_client task  ──►  AppHandle::emit  ──►  Live window
//!         │                   │
//!         │                   └─►  per-mode clipboard / paste actions
//!         │
//!         └─── reconnects on disconnect with backoff
//!
//! Settings live in tauri-plugin-store at `voix-settings.json` in the
//! standard macOS app-data dir (~/Library/Application Support/co.rowm.voix/).
//! All runtime state (HA URL, token, picked devices, per-mode behavior)
//! is read from there and updated from the frontend via `update_settings`.

mod commands;
mod ha_client;
mod menu;
mod paste;
mod settings;
mod tray;

use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::Manager;

/// Shared between the HA client task and the JS-callable commands. The
/// Mutex is held only briefly to swap in new settings; the WS task takes a
/// snapshot per reconnect so it doesn't hold the lock while streaming.
#[derive(Clone)]
pub struct AppState {
    pub settings: Arc<Mutex<settings::Settings>>,
    /// Sender used by the JS layer (via `restart_ha_connection`) to ask the
    /// HA client task to drop the current socket and reconnect with the
    /// latest settings. Bounded(1) — coalescing is fine, multiple "restart"
    /// requests in flight all mean the same thing.
    pub restart_tx: tokio::sync::mpsc::Sender<()>,
    /// Latest known connection status. The HA client task writes; JS
    /// reads via `get_status` on window load. Solves the
    /// emit-before-subscribe race on first paint.
    pub status: Arc<Mutex<ha_client::StatusEvent>>,
    /// Cache of `device_id → current mode_id` populated on transcript
    /// arrival (and proactively on connect). Lets dispatch_transcript
    /// look up per-mode behavior without making a REST call every turn.
    pub device_modes: Arc<Mutex<std::collections::HashMap<String, String>>>,
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,voix_app_lib=debug")),
        )
        .init();

    // rustls 0.23 requires an explicitly-installed CryptoProvider — without
    // this any wss:// connection panics on first handshake. We pick
    // aws-lc-rs at compile time (see Cargo.toml feature) and just register
    // it as the process default here.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let (restart_tx, restart_rx) = tokio::sync::mpsc::channel::<()>(1);

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            settings: Arc::new(Mutex::new(settings::Settings::default())),
            restart_tx,
            status: Arc::new(Mutex::new(ha_client::StatusEvent {
                connected: false,
                last_error: None,
            })),
            device_modes: Arc::new(Mutex::new(std::collections::HashMap::new())),
        });

    // Native macOS menu must be installed via the builder's `.menu()`
    // callback so it's in place before the first NSWindow is created —
    // setting it later (in setup()) leaves the system menu bar empty
    // because macOS captures the menu at app-finish-launching time.
    #[cfg(target_os = "macos")]
    {
        builder = builder.menu(|handle| menu::build(handle));
    }

    builder
        .setup(move |app| {
            let handle = app.handle().clone();

            // macOS Liquid Glass on the main window. The brand guide is
            // explicit that the app should feel native — translucent
            // sidebar material is the most identifiable bit of that.
            // Applied window-wide (not just on the sidebar grid area)
            // because window-vibrancy operates at the NSWindow level;
            // the main view's solid CSS background covers everything
            // except the sidebar strip, so the material shows through
            // exactly where we want it.
            //
            // We also forward theme-changed events to JS so the body's
            // data-theme attribute follows macOS's Appearance setting
            // even when wry's `prefers-color-scheme` doesn't.
            #[cfg(target_os = "macos")]
            {
                use tauri::Emitter;
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &win,
                        NSVisualEffectMaterial::Sidebar,
                        None,
                        Some(10.0),
                    );
                    let win_for_event = win.clone();
                    win.on_window_event(move |evt| {
                        if let tauri::WindowEvent::ThemeChanged(theme) = evt {
                            let s = match theme {
                                tauri::Theme::Dark => "dark",
                                _ => "light",
                            };
                            let _ = win_for_event.emit("voix://theme-changed", s);
                        }
                    });
                }
            }

            // Load persisted settings synchronously on launch so the
            // frontend can read them via `get_settings` on first render.
            let state: tauri::State<AppState> = handle.state();
            let initial = settings::load(&handle).unwrap_or_default();
            {
                // Block briefly on the lock — we're in setup before any
                // tasks have started, so contention is impossible.
                let mut guard = state.settings.blocking_lock();
                *guard = initial.clone();
            }

            // Install the menu-bar tray icon. Single icon with a short
            // menu (Open / Cycle Mode / Quit). Errors are logged but
            // don't abort startup — the app's still useful without a
            // tray (just no quick-access menu-bar entry).
            if let Err(e) = tray::setup(&handle) {
                tracing::warn!("tray setup failed: {e}");
            }

            // Spawn the HA WebSocket subscriber. It loops forever,
            // reconnecting on failure with backoff, and emits browser-side
            // events (`voix://transcript`, `voix://session`, `voix://status`)
            // that the windows listen to.
            let app_handle_for_task = handle.clone();
            tauri::async_runtime::spawn(async move {
                ha_client::run(app_handle_for_task, restart_rx).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::restart_ha_connection,
            commands::test_paste,
            commands::copy_text,
            commands::get_status,
            commands::list_ha_devices,
            commands::list_ha_modes,
            commands::call_ha_service,
            commands::call_ha_service_with_response,
            commands::get_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
