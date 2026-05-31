//! JS-invokable commands. Each is a thin shim — parse args, mutate
//! state, persist, ack. Heavy work happens elsewhere.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{ha_client::StatusEvent, paste, settings, AppState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaDevice {
    pub device_id: String,
    pub friendly_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaMode {
    pub mode_id: String,
    pub name: String,
    pub r#type: String,
    /// [r, g, b] when the integration has set the mode light's colour.
    /// None when the light entity hasn't been observed lit yet.
    pub color: Option<Vec<u8>>,
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<settings::Settings, String> {
    Ok(state.settings.lock().await.clone())
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle<Wry>,
    state: State<'_, AppState>,
    new_settings: settings::Settings,
) -> Result<(), String> {
    {
        let mut guard = state.settings.lock().await;
        *guard = new_settings.clone();
    }
    settings::save(&app, &new_settings)?;
    Ok(())
}

/// Tell the HA client task to drop the current socket and reconnect with
/// the latest settings. Used after the user changes URL/token.
#[tauri::command]
pub async fn restart_ha_connection(state: State<'_, AppState>) -> Result<(), String> {
    state
        .restart_tx
        .send(())
        .await
        .map_err(|e| format!("send restart: {e}"))
}

/// Test the macOS Accessibility permission for paste. Writes a known
/// string to the clipboard, then fires Cmd+V. The frontmost app (likely
/// the settings window itself when called from the button) sees the
/// paste; if nothing happens, the user hasn't granted permission yet.
#[tauri::command]
pub async fn test_paste(app: AppHandle<Wry>) -> Result<(), String> {
    app.clipboard()
        .write_text("voix paste test".to_string())
        .map_err(|e| format!("clipboard write: {e}"))?;
    tauri::async_runtime::spawn_blocking(paste::paste_now)
        .await
        .map_err(|e| format!("paste join: {e}"))??;
    Ok(())
}

/// Manual "copy to clipboard" hook for the live transcript window — the
/// user can copy any captured line on demand.
#[tauri::command]
pub async fn copy_text(app: AppHandle<Wry>, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("clipboard write: {e}"))
}

/// Returns the OS appearance ("light" or "dark"). The webview's
/// `prefers-color-scheme` is unreliable on Tauri 2 + wry on macOS (it
/// defaults to "dark" in some configurations regardless of the user's
/// actual Appearance setting), so the JS layer calls this on init and
/// applies a body class explicitly.
#[tauri::command]
pub async fn get_theme(app: AppHandle<Wry>) -> Result<String, String> {
    let theme = app
        .get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .unwrap_or(tauri::Theme::Light);
    Ok(match theme {
        tauri::Theme::Dark => "dark".into(),
        _ => "light".into(),
    })
}

/// Current HA-connection status. The JS frontend calls this on first
/// paint to avoid the emit-before-subscribe race where the WS connects
/// before the window's listener is up.
#[tauri::command]
pub async fn get_status(state: State<'_, AppState>) -> Result<StatusEvent, String> {
    Ok(state.status.lock().await.clone())
}

/// Enumerate voix-controlled Voice PE devices via HA's REST API. Runs
/// in Rust to bypass the webview's CORS rules — HA doesn't return CORS
/// headers for `tauri://` origins so a plain JS fetch() would fail.
#[tauri::command]
pub async fn list_ha_devices(state: State<'_, AppState>) -> Result<Vec<HaDevice>, String> {
    let states = ha_get_states(state).await?;
    let mut out: Vec<HaDevice> = states
        .iter()
        .filter_map(|s| {
            let eid = s.get("entity_id")?.as_str()?;
            let slug = eid.strip_prefix("select.voix_mode_")?;
            let friendly = s
                .get("attributes")
                .and_then(|a| a.get("friendly_name"))
                .and_then(|f| f.as_str())
                .unwrap_or(slug);
            Some(HaDevice {
                device_id: slug.to_string(),
                friendly_name: friendly.to_string(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.friendly_name.cmp(&b.friendly_name));
    Ok(out)
}

/// Enumerate voix modes — one `light.voix_mode_<id>` entity per mode.
/// Returns name, type (from `behavior` attribute on the matching per-device
/// select if available, otherwise inferred from the id), colour, and the
/// full prompt/voice/model fields when those have been read into the
/// light entity's attributes (they are not yet — Wave 3 may add that;
/// for now the editor reads via `get_ha_mode_details` per-mode).
#[tauri::command]
pub async fn list_ha_modes(state: State<'_, AppState>) -> Result<Vec<HaMode>, String> {
    // Prefer the integration's `voix.list_voices` service: it returns the
    // canonical voice_ids straight from entry.options[modes] (e.g.
    // "default-realtime"), which is the key the update_voice service
    // expects. The older path scanned `light.voix_voice_*` entity_ids
    // and stripped the prefix — but HA slugifies entity_ids
    // (hyphens → underscores), so the reversed id ("default_realtime")
    // never matched the real catalog key, silently dropping every
    // update_voice call.
    //
    // The service was renamed from voix.list_modes → voix.list_voices
    // in HA's M02b (vocabulary alignment with the daemon + UI). The
    // old service stays registered for one release, but new callers
    // (including this one) use the canonical name. Response shape:
    // the rows live under `voices:` (was `modes:`) and each row's id
    // key is `voice_id` (was `mode_id`).
    let s = state.settings.lock().await.clone();
    if s.ha_url.is_empty() || s.ha_token.is_empty() {
        return Err("HA URL or token not set".into());
    }
    let url = format!(
        "{}/api/services/voix/list_voices?return_response=true",
        s.ha_url.trim_end_matches('/'),
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&s.ha_token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("HA POST {url}: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("voix.list_voices failed: {body}"));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse list_voices response: {e}"))?;
    let rows = body
        .get("service_response")
        .and_then(|r| r.get("voices"))
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();

    let mut out: Vec<HaMode> = rows
        .into_iter()
        .filter_map(|row| {
            // Field key renamed mode_id → voice_id in M02b.
            let mode_id = row.get("voice_id")?.as_str()?.to_string();
            let name = row
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&mode_id)
                .to_string();
            let r#type = row
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("realtime")
                .to_string();
            let color = row
                .get("color")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_i64().map(|n| n as u8))
                        .collect::<Vec<u8>>()
                })
                .filter(|v| v.len() == 3);
            Some(HaMode {
                mode_id,
                name,
                r#type,
                color,
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Call an arbitrary HA service. Used by the app to invoke
/// `voix.create_voice` / `update_voice` / `delete_voice` / `set_voice`
/// plus `light.turn_on` for voice colour. Routed through Rust to bypass
/// the webview CORS issue.
#[tauri::command]
pub async fn call_ha_service(
    state: State<'_, AppState>,
    domain: String,
    service: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let s = state.settings.lock().await.clone();
    if s.ha_url.is_empty() || s.ha_token.is_empty() {
        return Err("HA URL or token not set".into());
    }
    let url = format!(
        "{}/api/services/{}/{}",
        s.ha_url.trim_end_matches('/'),
        domain,
        service
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&s.ha_token)
        .json(&data)
        .send()
        .await
        .map_err(|e| format!("HA POST {url}: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HA service failed: {body}"));
    }
    Ok(())
}

/// Call an HA service that returns response data (`supports_response=ONLY`
/// or `OPTIONAL`). HA's REST API requires `?return_response=true` for
/// optional-response services; for ONLY-response it's accepted always.
/// Returns the response body as JSON.
#[tauri::command]
pub async fn call_ha_service_with_response(
    state: State<'_, AppState>,
    domain: String,
    service: String,
    data: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let s = state.settings.lock().await.clone();
    if s.ha_url.is_empty() || s.ha_token.is_empty() {
        return Err("HA URL or token not set".into());
    }
    let url = format!(
        "{}/api/services/{}/{}?return_response=true",
        s.ha_url.trim_end_matches('/'),
        domain,
        service
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&s.ha_token)
        .json(&data)
        .send()
        .await
        .map_err(|e| format!("HA POST {url}: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HA service failed: {body}"));
    }
    // HA wraps service responses as {"changed_states": [...], "service_response": {...}}.
    // We return the whole thing so callers can pick what they need.
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("parse HA service response: {e}"))
}

async fn ha_get_states(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let s = state.settings.lock().await.clone();
    if s.ha_url.is_empty() || s.ha_token.is_empty() {
        return Err("HA URL or token not set".into());
    }
    let url = format!("{}/api/states", s.ha_url.trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&s.ha_token)
        .send()
        .await
        .map_err(|e| format!("HA GET states: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HA {}: {}", resp.status(), url));
    }
    resp.json::<Vec<serde_json::Value>>()
        .await
        .map_err(|e| format!("parse HA states: {e}"))
}
