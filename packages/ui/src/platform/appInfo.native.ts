/**
 * App info — RN impl.
 *
 * - `getFriendlyName()` — device name via `react-native-device-info`,
 *   suffixed with the platform OS so a stray entry in the daemon's
 *   Surfaces table is recognisable. Falls back to `Platform.OS` if
 *   DeviceInfo throws (sim without name set, sandboxed simulator).
 *
 * - `getApiBase()` / `setApiBase()` — persisted via the platform's
 *   storage adapter (AsyncStorage on native). First read pulls from
 *   storage, then caches in-process so the hot path is sync-ish.
 *   Default is the M20 dev daemon at `192.168.99.86:8765` — Tom
 *   overrides via `__dev__.setApiBase()` (registered in @voix/ui's
 *   barrel) until M23 ships a settings screen.
 *
 * - `getWsUrl(base)` — strip trailing slash, swap http(s) → ws(s),
 *   append `/ws`. Native ignores the document-location trick the web
 *   impl uses because RN has no document.
 *
 * - `clientKind` per the protocol's `ClientKind` union:
 *     iOS    → "phone-sat"
 *     macOS  → "laptop-mic" (M22 — once macOS gets real audio it's the
 *              right taxonomy bucket; closes Sasha M21 finding M2).
 */

import { Platform } from "react-native";
import DeviceInfo from "react-native-device-info";
import { storage } from "./storage";
import type { AppInfo } from "./types";

/**
 * Default daemon URL for fresh installs. Tom's M20-era dev box on
 * `192.168.99.x`. Overridable via `setApiBase()`; consumers reading
 * `getApiBase()` get the persisted value, not this constant.
 */
const DEFAULT_DEV_DAEMON_URL = "http://192.168.99.86:8765/";

const API_BASE_KEY = "voix.api_base";

let apiBaseCache: string | null = null;

export const appInfo: AppInfo = {
  async getFriendlyName(): Promise<string> {
    try {
      const name = await DeviceInfo.getDeviceName();
      return `${name} (${Platform.OS})`;
    } catch {
      return `voix-${Platform.OS}`;
    }
  },

  async getApiBase(): Promise<string> {
    if (apiBaseCache !== null) return apiBaseCache;
    const stored = await storage.getItem(API_BASE_KEY);
    apiBaseCache = stored ?? DEFAULT_DEV_DAEMON_URL;
    return apiBaseCache;
  },

  async setApiBase(url: string): Promise<void> {
    apiBaseCache = url;
    await storage.setItem(API_BASE_KEY, url);
  },

  getWsUrl(base: string): string {
    const trimmed = base.replace(/\/$/, "");
    const wsBase = trimmed.replace(/^http/, "ws");
    return `${wsBase}/ws`;
  },

  clientKind: Platform.OS === "macos" ? "laptop-mic" : "phone-sat",
};
