/**
 * Native base URL — relative fetches don't resolve against anything
 * useful on iOS / macOS, so the URL must be absolute. Hard-coded LAN
 * address of Tom's dev daemon for M20; M21 swaps this for a
 * user-configurable daemon URL via a settings screen.
 *
 * Pair file: apiBase.ts.
 */
// TODO(M21): user-configurable daemon URL in a settings screen.

// =============================================================================
// FIX BEFORE FIRST USE ON ANY MACHINE THAT IS NOT TOM'S DEV BOX.
//
// This URL points at the M20-era developer setup (Tom's MacBook on
// 192.168.99.x). On a fresh DHCP lease, a different LAN, or any other
// machine, the daemon will be unreachable and every fetch fails silently
// from the user's perspective.
//
// M21 lands a settings screen that lets the user enter / persist their
// daemon URL; until then, edit this constant directly.
// =============================================================================
const DEV_DAEMON_URL = "http://192.168.99.86:8765/";

export function getApiBase(): string {
  return DEV_DAEMON_URL;
}
