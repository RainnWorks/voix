/**
 * Native base URL — relative fetches don't resolve against anything
 * useful on iOS / macOS, so the URL must be absolute. Hard-coded LAN
 * address of Tom's dev daemon for M20; M21 swaps this for a
 * user-configurable daemon URL via a settings screen.
 *
 * Pair file: apiBase.ts.
 */
// TODO(M21): user-configurable daemon URL in a settings screen.
const DEV_DAEMON_URL = "http://192.168.99.86:8765/";

export function getApiBase(): string {
  return DEV_DAEMON_URL;
}
