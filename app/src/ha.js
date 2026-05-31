// Thin HA REST client — now just a passthrough to Rust commands. We
// proxy through Rust to sidestep the webview's CORS policy (HA doesn't
// grant CORS to the tauri:// origin so a JS fetch fails with "load
// failed"). Rust uses reqwest which doesn't care about origins.

import { tauri } from "./tauri-shim.js";

export async function listDevices(_haUrl, _token) {
  // URL and token are pulled from settings inside Rust — we accept them
  // here for shape-compat with the old (in-JS) implementation, but the
  // current settings are the source of truth.
  return tauri.invoke("list_ha_devices");
}

export async function listModes(_haUrl, _token) {
  return tauri.invoke("list_ha_modes");
}
