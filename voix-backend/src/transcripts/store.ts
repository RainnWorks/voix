/**
 * Per-session transcript file store.
 *
 * Same layout the HA-side Python version used:
 *   <root>/voix/transcripts/<deviceSlug>/<sessionId>-<role>.txt
 *
 * Cumulative across all turns in a session — appended to on each
 * completed turn, atomically rewritten on disk. The `<role>` is
 * either `user` or `assistant`. Dictation-only sessions only ever
 * have `user` files.
 *
 * A `.raw.txt` sidecar holds the pre-post-processing text for
 * dictation modes that ran an LLM rewrite. Diff against the main
 * file to see what the post-processor did.
 *
 * Kept as plain text (not JSON) — these get pasted into editors via
 * the Mac app, browsed manually over SSH, etc. JSON would be friction
 * for no gain.
 */

import { log } from "../log.ts";
import { atomicWrite } from "../storage/atomic.ts";
import { paths } from "../storage/paths.ts";

function deviceSlug(deviceId: string): string {
  return deviceId.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

type Key = `${string}:${string}:${"user" | "assistant"}`;

const completedTurns = new Map<Key, string[]>();
const partialTurn = new Map<Key, string>();

function key(deviceId: string, sessionId: string, role: "user" | "assistant"): Key {
  return `${deviceId}:${sessionId}:${role}` as Key;
}

function fullPath(deviceId: string, sessionId: string, role: "user" | "assistant"): string {
  return paths.transcriptFile(deviceSlug(deviceId), sessionId, role);
}

function rawSidecarPath(deviceId: string, sessionId: string, role: "user" | "assistant"): string {
  return paths.transcriptRawFile(deviceSlug(deviceId), sessionId, role);
}

async function rewrite(
  deviceId: string,
  sessionId: string,
  role: "user" | "assistant",
): Promise<{ path: string; charCount: number }> {
  const k = key(deviceId, sessionId, role);
  const completed = completedTurns.get(k) ?? [];
  const partial = partialTurn.get(k) ?? "";
  const body = [...completed, partial].filter(Boolean).join("\n\n");
  const path = fullPath(deviceId, sessionId, role);
  await atomicWrite(path, body);
  return { path, charCount: body.length };
}

/** Update the in-progress partial for the current turn and rewrite. */
export async function writePartial(
  deviceId: string,
  sessionId: string,
  role: "user" | "assistant",
  text: string,
): Promise<{ path: string; charCount: number }> {
  partialTurn.set(key(deviceId, sessionId, role), text);
  return await rewrite(deviceId, sessionId, role);
}

/** Promote the current turn to completed and rewrite. */
export async function writeComplete(
  deviceId: string,
  sessionId: string,
  role: "user" | "assistant",
  text: string,
): Promise<{ path: string; charCount: number }> {
  const k = key(deviceId, sessionId, role);
  if (text) {
    const arr = completedTurns.get(k) ?? [];
    arr.push(text);
    completedTurns.set(k, arr);
  }
  partialTurn.delete(k);
  return await rewrite(deviceId, sessionId, role);
}

/** Write the pre-post-processing raw transcript as a `.raw.txt` sidecar.
 *  Caller uses this when a mode had post_process_prompt applied — the
 *  main file ends up with polished text, the sidecar preserves raw. */
export async function writeRawSidecar(
  deviceId: string,
  sessionId: string,
  role: "user" | "assistant",
  rawText: string,
): Promise<string> {
  const path = rawSidecarPath(deviceId, sessionId, role);
  await atomicWrite(path, rawText);
  return path;
}

/** Free in-memory state for a session. The files stay on disk for the
 *  history UI; we just stop tracking turns. */
export function forget(deviceId: string, sessionId: string): void {
  for (const role of ["user", "assistant"] as const) {
    const k = key(deviceId, sessionId, role);
    completedTurns.delete(k);
    partialTurn.delete(k);
  }
  log.trace(`transcripts: forgot ${deviceId}/${sessionId}`);
}
