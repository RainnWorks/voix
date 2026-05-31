//! macOS menu-bar tray icon.
//!
//! Single icon (template, system-tinted) that lives in the menu bar with a
//! short menu: Open Voix / Cycle Mode / Quit. Clicking the icon body
//! toggles the main window's visibility — handy when the app is running
//! but the window is closed.
//!
//! The cycle-voice menu item invokes the HA `voix.cycle_voice` service via
//! REST, same path as the JS layer uses via `call_ha_service`.

use serde_json::json;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, Wry,
};
use tracing::{debug, warn};

use crate::AppState;

pub fn setup(app: &AppHandle<Wry>) -> tauri::Result<()> {
    // include_image!() decodes the PNG at compile time via the "image-png"
    // feature on tauri — embedding the bytes directly avoids any
    // resource-dir lookup that can vary between dev and bundled builds.
    //
    // Source: voix-menubar.svg → rsvg-convert → tray-22.png. SVG uses
    // fill="currentColor" so the raster is black; combined with
    // .icon_as_template(true) below, macOS tints it for the menu bar.
    let image = tauri::include_image!("icons/tray-22.png");

    let open = MenuItem::with_id(app, "open", "Open Voix", true, None::<&str>)?;
    let cycle = MenuItem::with_id(app, "cycle", "Cycle Mode", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Voix", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &cycle, &quit])?;

    TrayIconBuilder::with_id("voix-tray")
        .icon(image)
        .icon_as_template(true) // macOS template image — system tints it
        .tooltip("Voix")
        .menu(&menu)
        .show_menu_on_left_click(false) // left-click toggles window; right opens menu
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                show_window(app);
            }
            "cycle" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = call_cycle_mode(&app).await {
                        warn!("tray: cycle_mode failed: {e}");
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            other => debug!("tray: unhandled menu id {other}"),
        })
        .build(app)?;

    Ok(())
}

fn show_window(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
    }
}

fn toggle_window(app: &AppHandle<Wry>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    match win.is_visible() {
        Ok(true) => {
            let _ = win.hide();
        }
        _ => {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

async fn call_cycle_mode(app: &AppHandle<Wry>) -> Result<(), String> {
    let state: State<AppState> = app.state();
    let s = state.settings.lock().await.clone();
    if s.ha_url.is_empty() || s.ha_token.is_empty() {
        return Err("HA URL or token not set".into());
    }
    // voix.cycle_voice (M02b canonical). The old voix.cycle_mode alias
    // also works but new callers use the canonical name.
    let url = format!(
        "{}/api/services/voix/cycle_voice",
        s.ha_url.trim_end_matches('/'),
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&s.ha_token)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("HA POST {url}: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HA cycle_voice failed: {body}"));
    }
    Ok(())
}
