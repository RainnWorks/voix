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

/**
 * Typed error from `setApiBase` when the input isn't a valid daemon
 * URL. DaemonUrlInput catches this to surface a distinct "malformed"
 * indicator separately from "unreachable" — so a user with a typo
 * sees actionable copy instead of being told their network is down
 * (Priya H3, M23 fix-pass).
 */
export class InvalidDaemonUrlError extends Error {
  readonly code = "invalid-daemon-url" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidDaemonUrlError";
  }
}

/**
 * Validate a candidate daemon URL string. Requires `http://` or
 * `https://` prefix, a parseable URL, and a non-empty host. Returns
 * the original string unchanged on pass; throws InvalidDaemonUrlError
 * on fail. Use this as a guard BEFORE attempting a reachability probe
 * (probing a malformed URL just yields a confusing "unreachable").
 */
export function validateDaemonUrl(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    throw new InvalidDaemonUrlError("Daemon URL is empty.");
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new InvalidDaemonUrlError("Daemon URL must start with http:// or https://.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidDaemonUrlError("Daemon URL couldn't be parsed.");
  }
  if (!parsed.host) {
    throw new InvalidDaemonUrlError("Daemon URL has no host.");
  }
  return url;
}

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

  /**
   * Persist the daemon URL. Throws InvalidDaemonUrlError if the URL
   * is malformed (no protocol, no host, unparseable). Callers should
   * catch and surface a "Malformed URL" state distinct from
   * "Unreachable" (Priya H3).
   */
  async setApiBase(url: string): Promise<void> {
    const validated = validateDaemonUrl(url);
    apiBaseCache = validated;
    await storage.setItem(API_BASE_KEY, validated);
  },

  getWsUrl(base: string): string {
    const trimmed = base.replace(/\/$/, "");
    const wsBase = trimmed.replace(/^http/, "ws");
    return `${wsBase}/ws`;
  },

  clientKind: Platform.OS === "macos" ? "laptop-mic" : "phone-sat",
};
