/**
 * Disk paths for daemon-owned state.
 *
 * Two layouts depending on where we're running:
 *
 *   • **HA Add-on** — Supervisor mounts a persistent `/data` volume.
 *     Everything goes under `/data/voix/`.
 *   • **Local dev** — Add-on's `/data` doesn't exist. Fall back to
 *     `${XDG_DATA_HOME-~/.local/share}/voix-backend/`. Same layout
 *     underneath so code paths stay identical.
 *
 * Files we own:
 *   • `modes.json`        — full mode catalog (user-edited + built-ins)
 *   • `history.json`      — JSONL one-entry-per-line; loaded as array on read
 *   • `transcripts/<deviceSlug>/<sessionId>-<role>.txt` — raw transcript files
 *   • `transcripts/<deviceSlug>/<sessionId>-<role>.raw.txt` — pre-post-proc sidecar
 *
 * The transcripts layout matches what the HA-side `_TranscriptStore`
 * used in Python — keeping it identical means the Mac app's existing
 * "show me a transcript" code keeps working when it later points at
 * the daemon instead of HA.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function detectDataRoot(): string {
  // HA Add-on Supervisor always mounts /data. We probe for it rather
  // than checking an env var because some HA installs don't set
  // SUPERVISOR_TOKEN even when /data exists.
  if (existsSync("/data") && process.env["SUPERVISOR_TOKEN"]) {
    return "/data";
  }
  // Local dev — XDG conventions on Linux, ~/Library on macOS would
  // also be valid but XDG_DATA_HOME works on both and keeps the
  // single-path expectation tidy.
  const xdg = process.env["XDG_DATA_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
  return join(base, "voix-backend");
}

const DATA_ROOT = detectDataRoot();

export function dataPath(...segments: string[]): string {
  return join(DATA_ROOT, "voix", ...segments);
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export const paths = {
  root: DATA_ROOT,
  modesFile: dataPath("modes.json"),
  historyFile: dataPath("history.jsonl"),
  transcriptsDir: dataPath("transcripts"),
  transcriptDir: (deviceSlug: string): string => dataPath("transcripts", deviceSlug),
  transcriptFile: (deviceSlug: string, sessionId: string, role: "user" | "assistant"): string =>
    dataPath("transcripts", deviceSlug, `${sessionId}-${role}.txt`),
  transcriptRawFile: (deviceSlug: string, sessionId: string, role: "user" | "assistant"): string =>
    dataPath("transcripts", deviceSlug, `${sessionId}-${role}.raw.txt`),
};
