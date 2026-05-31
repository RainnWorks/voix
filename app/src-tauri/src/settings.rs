//! Persisted user settings. Single struct stored as JSON in
//! tauri-plugin-store under `voix-settings.json`.
//!
//! All values are user-editable from the settings window. The HA client
//! task takes a snapshot per reconnect; updates to fields like the URL or
//! token only take effect once `restart_ha_connection` is called from JS.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Wry};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "voix-settings.json";
const STORE_KEY: &str = "settings";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Settings {
    /// e.g. `http://192.168.96.15:8123`
    pub ha_url: String,
    /// Long-lived access token from HA → Profile → Security → Create token.
    pub ha_token: String,
    /// device_ids the app should listen to. Empty = listen to all.
    pub picked_devices: Vec<String>,
    /// Per-mode behavior. Key is the voix mode_id from HA
    /// (entry.options.modes[…].name slugified). Value is the action set
    /// for that mode (clipboard, paste).
    pub modes: HashMap<String, ModeBehavior>,
    /// Behavior used when a mode has no explicit override above.
    pub default_behavior: ModeBehavior,
    /// Whether realtime transcripts should ALSO be copied to the
    /// clipboard alongside being shown in the live window. False means
    /// the live transcript window receives them but the clipboard is
    /// untouched. Each mode's per-mode behavior can still override.
    pub realtime_copy_default: bool,
    /// Same as above, but for the auto-paste action. Defaults to off
    /// because paste in realtime mode is usually noisy.
    pub realtime_paste_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ModeBehavior {
    /// Copy the captured text to the macOS clipboard.
    pub copy: bool,
    /// Simulate Cmd+V into the frontmost app after the copy. Requires
    /// macOS Accessibility permission for the Voix app.
    pub paste: bool,
    /// Show a macOS native notification when a transcript completes.
    /// Defaults to off so we don't surprise existing users with sudden
    /// banner spam after an upgrade.
    pub notify: bool,
}

impl Default for ModeBehavior {
    fn default() -> Self {
        // Sensible default: copy on, paste off, notify off. Paste needs
        // explicit user consent (via Accessibility permission anyway).
        Self { copy: true, paste: false, notify: false }
    }
}

pub fn load(app: &AppHandle<Wry>) -> Option<Settings> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(STORE_KEY)?;
    serde_json::from_value(value).ok()
}

pub fn save(app: &AppHandle<Wry>, settings: &Settings) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("store open: {e}"))?;
    let json = serde_json::to_value(settings).map_err(|e| format!("serialize: {e}"))?;
    store.set(STORE_KEY, json);
    store.save().map_err(|e| format!("store save: {e}"))?;
    Ok(())
}

impl Settings {
    /// Resolve the effective behavior for a given mode_id, falling back
    /// to the user's defaults if the mode has no explicit entry. The
    /// `is_realtime` flag selects between the dictation defaults (copy=on,
    /// paste=off) and the realtime defaults (configured separately).
    pub fn behavior_for(&self, mode_id: &str, is_realtime: bool) -> ModeBehavior {
        if let Some(b) = self.modes.get(mode_id) {
            return b.clone();
        }
        if is_realtime {
            ModeBehavior {
                copy: self.realtime_copy_default,
                paste: self.realtime_paste_default,
                notify: self.default_behavior.notify,
            }
        } else {
            self.default_behavior.clone()
        }
    }

    /// True when the configured device list is empty (= listen-all) or
    /// when the device_id is in the list.
    pub fn accepts_device(&self, device_id: &str) -> bool {
        self.picked_devices.is_empty()
            || self.picked_devices.iter().any(|d| d == device_id)
    }
}
