/**
 * Web base URL — the document was served from somewhere (HA ingress
 * prefix, root, dev server), and the browser's fetch resolves
 * relative URLs against that. Return empty so callers can do
 * `fetch(getApiBase() + "api/voices", ...)` and stay relative.
 *
 * Pair file: apiBase.native.ts.
 */
export function getApiBase(): string {
  return "";
}
