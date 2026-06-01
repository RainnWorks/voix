/**
 * App info — web impl.
 *
 * Lifts the document-relative URL + title sources from
 * `client.ts:79` (window.location) + `client.ts:202` (document.title)
 * + `lib/apiBase.ts` (empty-string relative-fetch root).
 *
 * - `getApiBase()` returns "" so callers can do
 *   `fetch(getApiBase() + "api/voices", ...)` and the browser
 *   resolves relative to the served document (HA ingress prefix
 *   survives).
 * - `setApiBase()` is a no-op on web — the daemon URL is wherever the
 *   document was served from; there's nothing to persist.
 * - `getWsUrl(base)` honours the HA-ingress trick: derive from the
 *   document's location so `/api/hassio_ingress/<token>/` stays in
 *   the path; `http(s)` → `ws(s)` flip.
 * - `getFriendlyName()` returns `document.title`.
 * - `clientKind = "browser-tab"`.
 */

import type { AppInfo } from "./types";

/**
 * Web's API base is whatever the document was served from (relative
 * fetch root = ""), so there's no dev-box default to reset to. Exported
 * for import parity with the native impl — DaemonUrlInput hides the
 * reset link on web (`!isWeb`), so this value is never actually used as
 * a reset target here.
 */
export const DEFAULT_DAEMON_URL = "";

/**
 * Typed error from `setApiBase` when the input isn't a valid daemon
 * URL. Web's `setApiBase` is a no-op (daemon URL is wherever the
 * document was served from) but consumers may still import the
 * validator + error type for surface parity with native — keeps the
 * import path uniform regardless of build target (Priya H3).
 */
export class InvalidDaemonUrlError extends Error {
  readonly code = "invalid-daemon-url" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidDaemonUrlError";
  }
}

/** Parity surface for web. Same shape as native. */
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
    if (typeof document !== "undefined" && document.title) {
      return document.title;
    }
    return "browser";
  },

  async getApiBase(): Promise<string> {
    return "";
  },

  async setApiBase(_url: string): Promise<void> {
    // No-op on web. The document was served from the daemon (or its
    // HA-ingress proxy); the API base is whatever browser-relative
    // resolution gives us.
  },

  /**
   * For the web target the `base` argument is ignored — we always
   * derive from the document's current location so the HA ingress
   * prefix (if any) survives. The signature accepts a `base` for
   * surface parity with the native impl, where the user-supplied
   * URL IS the source of truth.
   */
  getWsUrl(_base: string): string {
    if (typeof window === "undefined") return "ws://localhost:8765/ws";
    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const path = loc.pathname.replace(/\/$/, "");
    return `${protocol}//${loc.host}${path}/ws`;
  },

  clientKind: "browser-tab",
};
