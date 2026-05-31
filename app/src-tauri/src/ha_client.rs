//! HA WebSocket client.
//!
//! Connects to `<ha_url>/api/websocket`, authenticates with a long-lived
//! token, subscribes to four voix bus events, and re-emits them as
//! Tauri events for the frontend. Per-mode behavior (copy/paste) is
//! applied here so the JS layer just sees the post-action transcript.
//!
//! Reconnect strategy: exponential backoff, max 30s. A restart channel
//! lets the JS settings page kick the loop without us having to detect
//! WebSocket-level errors.

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;
use tokio::sync::mpsc::Receiver;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, info, warn};

use crate::{paste, settings::Settings, AppState};

// ─── Event payloads emitted to the frontend ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEvent {
    pub source: &'static str, // "dictation" | "realtime"
    pub role: String,         // "user" | "assistant"
    pub text: String,
    pub device_id: Option<String>,
    pub session_id: Option<String>,
    /// What the app actually did with this transcript.
    pub copied: bool,
    pub pasted: bool,
    /// ISO-8601 (UTC) timestamp generated at receive-time. Used by the
    /// live window for chronological ordering when the user scrolls.
    pub at: String,
}

/// Streaming-transcript update derived from a `state_changed` on one of
/// the per-device voix transcript sensors. The live window groups these
/// by (device_id, session_id, role) and overwrites the displayed text
/// as deltas arrive; when status flips to "complete" the turn is frozen
/// and the app applies the per-mode copy/paste action.
#[derive(Debug, Clone, Serialize)]
pub struct TranscriptStreamEvent {
    pub role: String,
    pub text: String,
    pub status: String, // "streaming" | "complete"
    pub device_id: Option<String>,
    pub session_id: Option<String>,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEvent {
    pub connected: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionEvent {
    pub kind: &'static str, // "started" | "ended"
    pub device_id: Option<String>,
    pub session_id: Option<String>,
}

// ─── Driver loop ────────────────────────────────────────────────────────────

pub async fn run(app: AppHandle<Wry>, mut restart_rx: Receiver<()>) {
    let mut backoff_s: u64 = 1;
    loop {
        // Snapshot settings for this connection attempt. If empty, sit
        // and wait — there's nothing to do until the user fills them in
        // and calls `restart_ha_connection`.
        let snapshot = {
            let state: State<AppState> = app.state();
            let s = state.settings.lock().await.clone();
            s
        };

        if snapshot.ha_url.is_empty() || snapshot.ha_token.is_empty() {
            emit_status(&app, false, Some("HA URL or token not set".into()));
            // Wait for explicit restart or settings update.
            let _ = restart_rx.recv().await;
            backoff_s = 1;
            continue;
        }

        match connect_and_pump(&app, &snapshot, &mut restart_rx).await {
            Ok(Reason::Restart) => {
                info!("ha_client: settings changed, reconnecting");
                backoff_s = 1;
            }
            Ok(Reason::Closed) => {
                warn!("ha_client: WS closed by server; backing off {}s", backoff_s);
                emit_status(&app, false, Some("WS closed by server".into()));
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(backoff_s)) => {}
                    _ = restart_rx.recv() => {}
                }
                backoff_s = (backoff_s * 2).min(30);
            }
            Err(e) => {
                warn!("ha_client: error: {e}; backing off {}s", backoff_s);
                emit_status(&app, false, Some(format!("{e}")));
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(backoff_s)) => {}
                    _ = restart_rx.recv() => {}
                }
                backoff_s = (backoff_s * 2).min(30);
            }
        }
    }
}

enum Reason {
    Closed,
    Restart,
}

async fn connect_and_pump(
    app: &AppHandle<Wry>,
    s: &Settings,
    restart_rx: &mut Receiver<()>,
) -> Result<Reason> {
    let ws_url = ha_ws_url(&s.ha_url).context("invalid HA URL")?;
    debug!("ha_client: connecting {ws_url}");

    let (mut ws, _) = connect_async(&ws_url)
        .await
        .with_context(|| format!("connect {ws_url}"))?;

    // ─── auth ──────────────────────────────────────────────────────────────
    // HA sends `auth_required` first; we reply with `auth`, expect `auth_ok`.
    expect_msg(&mut ws, "auth_required").await?;
    ws.send(Message::Text(
        json!({"type": "auth", "access_token": s.ha_token}).to_string().into(),
    ))
    .await
    .context("send auth")?;
    expect_msg(&mut ws, "auth_ok").await.context("auth_ok")?;

    info!("ha_client: connected + authed");
    emit_status(app, true, None);

    // ─── subscribe to voix events + HA state_changed ────────────────────
    // state_changed is high-volume but cheap to filter — we only act on
    // entity_ids starting with `select.voix_mode_` to keep the device→mode
    // cache live so per-mode behavior reflects the current selection.
    let mut next_id: u64 = 1;
    for event_type in [
        "voix_dictation_captured",
        "voix_realtime_user_transcript",
        "voix_realtime_assistant_transcript",
        "voix_transcript_delta",
        "voix_realtime_session_started",
        "voix_realtime_session_ended",
        "state_changed",
    ] {
        ws.send(Message::Text(
            json!({
                "id": next_id,
                "type": "subscribe_events",
                "event_type": event_type,
            })
            .to_string()
            .into(),
        ))
        .await
        .with_context(|| format!("subscribe {event_type}"))?;
        next_id += 1;
    }

    // ─── pump ──────────────────────────────────────────────────────────────
    loop {
        tokio::select! {
            // Restart channel — user changed settings or asked for a forced
            // reconnect. Drop this socket; outer loop will rebuild.
            _ = restart_rx.recv() => {
                let _ = ws.send(Message::Close(None)).await;
                return Ok(Reason::Restart);
            }
            // Inbound WS frame.
            msg = ws.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => return Err(anyhow!("ws read: {e}")),
                    None => return Ok(Reason::Closed),
                };
                match msg {
                    Message::Text(txt) => {
                        if let Err(e) = handle_event(app, &txt).await {
                            warn!("ha_client: handle_event: {e}");
                        }
                    }
                    Message::Ping(p) => {
                        let _ = ws.send(Message::Pong(p)).await;
                    }
                    Message::Close(_) => return Ok(Reason::Closed),
                    _ => {}
                }
            }
        }
    }
}

async fn handle_event(app: &AppHandle<Wry>, raw: &str) -> Result<()> {
    let v: Value = serde_json::from_str(raw).context("parse event json")?;
    if v.get("type").and_then(|t| t.as_str()) != Some("event") {
        return Ok(()); // result frames, pongs, etc.
    }
    let event = v
        .get("event")
        .ok_or_else(|| anyhow!("event frame missing .event"))?;
    let event_type = event
        .get("event_type")
        .and_then(|t| t.as_str())
        .ok_or_else(|| anyhow!("event missing event_type"))?
        .to_string();
    let data = event.get("data").cloned().unwrap_or(Value::Null);

    match event_type.as_str() {
        "voix_dictation_captured" => {
            dispatch_transcript(app, "dictation", "user", data, false).await?;
        }
        "voix_realtime_user_transcript" => {
            dispatch_transcript(app, "realtime", "user", data, true).await?;
        }
        "voix_realtime_assistant_transcript" => {
            dispatch_transcript(app, "realtime", "assistant", data, true).await?;
        }
        "voix_transcript_delta" => {
            forward_transcript_delta(app, &data).await;
        }
        "voix_realtime_session_started" => {
            emit_session(app, "started", &data);
        }
        "voix_realtime_session_ended" => {
            emit_session(app, "ended", &data);
        }
        "state_changed" => {
            // Only used to keep the per-device mode cache fresh now.
            // Transcript streaming moved to voix_transcript_delta.
            update_mode_cache(app, &data).await;
        }
        _ => {}
    }
    Ok(())
}

/// Live-streaming display update from the bridge's voix_transcript_delta
/// event. Payload carries `current_turn` (the in-progress turn's full
/// cumulative text), which the JS layer overwrites the line body with.
/// No file I/O, no service call — the delta event has everything we need.
async fn forward_transcript_delta(app: &AppHandle<Wry>, data: &Value) {
    let role = match data.get("role").and_then(|v| v.as_str()) {
        Some(r) => r.to_string(),
        None => return,
    };
    let current_turn = data
        .get("current_turn")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if current_turn.is_empty() {
        return;
    }
    let device_id = data
        .get("device_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let session_id = data
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(ref d) = device_id {
        let s = {
            let state: State<AppState> = app.state();
            let s = state.settings.lock().await.clone();
            s
        };
        if !s.accepts_device(d) {
            return;
        }
    }

    let payload = TranscriptStreamEvent {
        role,
        text: current_turn,
        status: "streaming".to_string(),
        device_id,
        session_id,
        at: chrono_iso_now(),
    };
    app.emit("voix://transcript-stream", &payload).ok();
}

/// Keep the device→mode cache fresh by sniffing state_changed for
/// `select.voix_mode_*` entities. We only care about the new state.
async fn update_mode_cache(app: &AppHandle<Wry>, data: &Value) {
    let Some(eid) = data.get("entity_id").and_then(|v| v.as_str()) else { return };
    let Some(device_id) = eid.strip_prefix("select.voix_mode_") else { return };
    let Some(new_state) = data
        .get("new_state")
        .and_then(|s| s.get("state"))
        .and_then(|v| v.as_str())
    else { return };
    let state: State<AppState> = app.state();
    let mut cache = state.device_modes.lock().await;
    cache.insert(device_id.to_string(), new_state.to_string());
    debug!("ha_client: mode cache {device_id} → {new_state}");
}

async fn dispatch_transcript(
    app: &AppHandle<Wry>,
    source: &'static str,
    role: &str,
    data: Value,
    is_realtime: bool,
) -> Result<()> {
    let text = data
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return Ok(());
    }
    let device_id = data
        .get("device_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let session_id = data
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Settings snapshot for the device filter + behavior lookup.
    let s = {
        let state: State<AppState> = app.state();
        let s = state.settings.lock().await.clone();
        s
    };

    if let Some(ref d) = device_id {
        if !s.accepts_device(d) {
            debug!("ha_client: dropping transcript from {d} (not in picked_devices)");
            return Ok(());
        }
    }

    // Per-mode behavior: look up the device's current mode_id so we use
    // the per-row checkbox the user set in the Modes table. The mode
    // cache is warmed on connect + refreshed lazily here when missing.
    let mode_id = match &device_id {
        Some(d) => current_mode_id(app, &s, d).await.unwrap_or_default(),
        None => String::new(),
    };
    let behavior = s.behavior_for(&mode_id, is_realtime);

    let mut copied = false;
    let mut pasted = false;
    if behavior.copy {
        if let Err(e) = app.clipboard().write_text(text.clone()) {
            warn!("ha_client: clipboard write failed: {e}");
        } else {
            copied = true;
        }
    }
    if behavior.paste {
        // osascript is a child process, so we run it on a blocking
        // thread to keep the async runtime free.
        let res = tauri::async_runtime::spawn_blocking(paste::paste_now).await;
        match res {
            Ok(Ok(())) => pasted = true,
            Ok(Err(e)) => warn!("ha_client: paste failed: {e}"),
            Err(e) => warn!("ha_client: paste join failed: {e}"),
        }
    }
    if behavior.notify {
        // Truncate the body — macOS notifications cap at a few lines
        // before they're ellipsised anyway, and large notification
        // bodies can be slow to render.
        let preview: String = text.chars().take(220).collect();
        let title = match (source, role) {
            ("dictation", _) => "Voix dictation",
            ("realtime", "user") => "You said",
            ("realtime", "assistant") => "Voix replied",
            _ => "Voix",
        };
        if let Err(e) = app
            .notification()
            .builder()
            .title(title)
            .body(preview)
            .show()
        {
            warn!("ha_client: notification failed: {e}");
        }
    }

    // Mirror to the streaming channel with status=complete so the live
    // window's in-progress line flips to the final/canonical text and
    // freezes. Dictation uses the separate `voix://transcript` →
    // appendCompleted path so we skip the stream mirror in that case
    // (otherwise we'd see both a streaming line AND a dictation line).
    if is_realtime {
        let stream_payload = TranscriptStreamEvent {
            role: role.to_string(),
            text: text.clone(),
            status: "complete".to_string(),
            device_id: device_id.clone(),
            session_id: session_id.clone(),
            at: chrono_iso_now(),
        };
        app.emit("voix://transcript-stream", &stream_payload).ok();
    }

    let payload = TranscriptEvent {
        source,
        role: role.to_string(),
        text,
        device_id,
        session_id,
        copied,
        pasted,
        at: chrono_iso_now(),
    };
    app.emit("voix://transcript", &payload).ok();
    Ok(())
}

/// Resolve a device's current mode_id. Reads from the in-memory cache
/// first; on miss, queries HA REST `/api/states/select.voix_mode_<slug>`
/// and stashes the result. Failures return None — the caller falls
/// back to the user's default behavior.
async fn current_mode_id(
    app: &AppHandle<Wry>,
    s: &Settings,
    device_id: &str,
) -> Option<String> {
    let state: State<AppState> = app.state();
    {
        let cache = state.device_modes.lock().await;
        if let Some(v) = cache.get(device_id) {
            return Some(v.clone());
        }
    }
    if s.ha_url.is_empty() || s.ha_token.is_empty() {
        return None;
    }
    let entity = format!("select.voix_mode_{device_id}");
    let url = format!(
        "{}/api/states/{}",
        s.ha_url.trim_end_matches('/'),
        entity
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&s.ha_token)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        warn!("ha_client: mode lookup {entity}: {}", resp.status());
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    let mode_id = v.get("state").and_then(|x| x.as_str())?.to_string();
    let mut cache = state.device_modes.lock().await;
    cache.insert(device_id.to_string(), mode_id.clone());
    Some(mode_id)
}

fn emit_session(app: &AppHandle<Wry>, kind: &'static str, data: &Value) {
    let payload = SessionEvent {
        kind,
        device_id: data
            .get("device_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        session_id: data
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    };
    app.emit("voix://session", &payload).ok();
}

fn emit_status(app: &AppHandle<Wry>, connected: bool, last_error: Option<String>) {
    let payload = StatusEvent {
        connected,
        last_error,
    };
    // Cache for late-loading windows that ask via `get_status`.
    let state: State<AppState> = app.state();
    if let Ok(mut s) = state.status.try_lock() {
        *s = payload.clone();
    } else {
        // try_lock failed → use blocking_lock briefly. Caller is on a tokio
        // task and we don't await across this, so it's safe.
        let mut s = state.status.blocking_lock();
        *s = payload.clone();
    }
    app.emit("voix://status", &payload).ok();
}

async fn expect_msg(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    expected_type: &str,
) -> Result<Value> {
    loop {
        let msg = ws.next().await.ok_or_else(|| anyhow!("WS closed early"))??;
        match msg {
            Message::Text(txt) => {
                let v: Value = serde_json::from_str(&txt)?;
                let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if ty == expected_type {
                    return Ok(v);
                }
                if ty == "auth_invalid" {
                    return Err(anyhow!(
                        "HA rejected token: {}",
                        v.get("message").and_then(|m| m.as_str()).unwrap_or("?")
                    ));
                }
                debug!("ha_client: ignoring {ty} while waiting for {expected_type}");
            }
            Message::Ping(p) => {
                let _ = ws.send(Message::Pong(p)).await;
            }
            Message::Close(_) => return Err(anyhow!("WS closed during {expected_type}")),
            _ => {}
        }
    }
}

/// Translate an HA REST URL ("http(s)://host:port[/path]") into the WS
/// path "/api/websocket".
fn ha_ws_url(rest_url: &str) -> Result<String> {
    let mut u = url::Url::parse(rest_url.trim_end_matches('/'))?;
    match u.scheme() {
        "http" => u.set_scheme("ws").map_err(|_| anyhow!("set ws scheme"))?,
        "https" => u.set_scheme("wss").map_err(|_| anyhow!("set wss scheme"))?,
        "ws" | "wss" => {}
        other => return Err(anyhow!("unsupported HA scheme: {other}")),
    }
    u.set_path("/api/websocket");
    Ok(u.to_string())
}

/// Tiny ISO-8601 timestamp helper. Avoids pulling chrono just for this.
fn chrono_iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs() as i64;
    let nanos = dur.subsec_nanos();
    // RFC3339-ish: YYYY-MM-DDTHH:MM:SS.mmmZ via a hand-rolled formatter.
    // We don't need full chrono correctness — this is just for ordering.
    let (y, mo, d, h, mi, se) = epoch_to_ymdhms(secs);
    format!(
        "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{se:02}.{ms:03}Z",
        ms = nanos / 1_000_000
    )
}

/// Civil-from-days (Howard Hinnant's algorithm), inlined. Good for any
/// gregorian date well past our app's lifetime.
fn epoch_to_ymdhms(epoch_secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = epoch_secs.div_euclid(86_400);
    let sod = epoch_secs.rem_euclid(86_400) as u32;
    let h = sod / 3600;
    let mi = (sod % 3600) / 60;
    let se = sod % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = (y + if mo <= 2 { 1 } else { 0 }) as i32;
    (y, mo, d, h, mi, se)
}
