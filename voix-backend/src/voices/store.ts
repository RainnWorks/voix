/**
 * Voice catalog persistence + in-memory cache.
 *
 * Source of truth: `voices.json` on disk. Loaded eagerly at boot,
 * mutated through `upsert` / `delete`, persisted via atomic temp-then-
 * rename on every mutation.
 *
 * Single-writer semantics — the daemon is one process and mutations are
 * always called from request handlers; no need for a lock around the
 * in-memory map. If we later add a "settings sync" agent or background
 * task that also writes modes, we'll need to revisit.
 *
 * On first boot the catalog is empty → seed with `BUILTIN_VOICES` and
 * persist. On subsequent boots we MERGE: built-ins missing from disk
 * get added back (their IDs are stable; an upgrade that ships a new
 * built-in mode shouldn't require users to re-install). User edits to
 * built-ins are preserved — we only add missing entries.
 */

import { readFile, rename } from "node:fs/promises";
import { log } from "../log.ts";
import { atomicWrite } from "../storage/atomic.ts";
import { paths } from "../storage/paths.ts";
import { BUILTIN_VOICES, DEFAULT_VOICE_ID, KNOWN_BUILTIN_PROMPTS } from "./builtins.ts";
import type { Voice, VoiceUpdate } from "./types.ts";

const cache = new Map<string, Voice>();
let loaded = false;

/**
 * M02 migration: rename modes.json → voices.json on disk if only the
 * legacy file exists. Idempotent — if voices.json is already present
 * the legacy file is left alone (will be deleted manually after
 * confirming the new file holds the same data).
 *
 * Exported for the unit test under `voix-backend/tests/voices/`.
 */
export async function migrateModesToVoices(): Promise<"none" | "migrated" | "skipped"> {
  try {
    await readFile(paths.voicesFile, "utf8");
    return "skipped"; // voices.json already exists, nothing to do
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  try {
    await readFile(paths.legacyModesFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "none";
    throw err;
  }
  await rename(paths.legacyModesFile, paths.voicesFile);
  log.warn(`voices: migrated legacy modes.json → voices.json (${paths.voicesFile})`);
  return "migrated";
}

/**
 * M03 phase-prompt normalisation.
 *
 * Voices on disk may have only the legacy `prompt` / `postProcessPrompt`
 * fields (everything written before M03), or only the new
 * `talkingPrompt` / `donePrompt` fields (forward-compat), or both
 * (steady state). Normalise so both pairs are populated in memory,
 * with the new fields taking precedence when both are present.
 *
 * Exported for the unit test under `tests/voices/`.
 */
export function normalisePhasePrompts(v: Partial<Voice> & { id: string }): Voice {
  // Cast through unknown so we can read fields that may or may not be
  // present on the on-disk record without TS complaining.
  const raw = v as Record<string, unknown>;
  const talkingPrompt =
    typeof raw["talkingPrompt"] === "string" && raw["talkingPrompt"] !== ""
      ? (raw["talkingPrompt"] as string)
      : typeof raw["prompt"] === "string"
        ? (raw["prompt"] as string)
        : "";
  const donePrompt =
    typeof raw["donePrompt"] === "string" && raw["donePrompt"] !== ""
      ? (raw["donePrompt"] as string)
      : typeof raw["postProcessPrompt"] === "string"
        ? (raw["postProcessPrompt"] as string)
        : "";
  return {
    ...(v as Voice),
    talkingPrompt,
    donePrompt,
    // Mirror the new fields back into the legacy ones so any code that
    // still reads `prompt` / `postProcessPrompt` (the UI editor, until
    // M04) sees the same value.
    prompt: talkingPrompt,
    postProcessPrompt: donePrompt,
  };
}

async function readFromDisk(): Promise<Voice[]> {
  try {
    const raw = await readFile(paths.voicesFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      log.warn(`voices: ${paths.voicesFile} is not a JSON array — ignoring`);
      return [];
    }
    return (parsed as Array<Partial<Voice> & { id: string }>).map(normalisePhasePrompts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log.warn("voices: failed to read voices.json:", err);
    return [];
  }
}

async function persist(): Promise<void> {
  const arr = Array.from(cache.values());
  await atomicWrite(paths.voicesFile, JSON.stringify(arr, null, 2));
}

export async function loadVoices(): Promise<void> {
  if (loaded) return;
  await migrateModesToVoices();
  const onDisk = await readFromDisk();
  for (const m of onDisk) cache.set(m.id, m);

  // Built-in modes: add missing ones AND refresh existing ones whose
  // user fields are still untouched. A mode is "untouched" if its
  // current prompt matches some prior built-in prompt (anything in
  // KNOWN_BUILTIN_PROMPTS) — the user hasn't typed their own. This
  // lets daemon upgrades roll out new system prompts without wiping
  // legit user customizations.
  let added = 0;
  let refreshed = 0;
  for (const builtin of BUILTIN_VOICES) {
    const existing = cache.get(builtin.id);
    if (!existing) {
      cache.set(builtin.id, builtin);
      added++;
      continue;
    }
    if (!existing.isBuiltin) continue; // user-renamed a builtin → leave it
    const userTouched = !KNOWN_BUILTIN_PROMPTS.has(existing.prompt);
    if (userTouched) continue;
    if (
      existing.talkingPrompt !== builtin.talkingPrompt ||
      existing.donePrompt !== builtin.donePrompt
    ) {
      // Update only the built-in-shipped fields. Preserve color etc.
      // which users may have customised through the LED UI. Set both
      // pairs so a downgraded daemon still sees a consistent voice.
      cache.set(builtin.id, {
        ...existing,
        talkingPrompt: builtin.talkingPrompt,
        donePrompt: builtin.donePrompt,
        prompt: builtin.talkingPrompt,
        postProcessPrompt: builtin.donePrompt,
        routingHint: builtin.routingHint,
      });
      refreshed++;
    }
  }
  loaded = true;

  if (onDisk.length === 0) {
    log.info(`voices: first boot — seeded ${BUILTIN_VOICES.length} built-in modes`);
    await persist();
  } else if (added > 0 || refreshed > 0) {
    log.info(
      `voices: loaded ${onDisk.length} on-disk` +
        `${added > 0 ? ` + ${added} new built-ins` : ""}` +
        `${refreshed > 0 ? ` + ${refreshed} refreshed built-in prompts` : ""}`,
    );
    await persist();
  } else {
    log.info(`voices: loaded ${cache.size} modes`);
  }
}

export function listVoices(): Voice[] {
  return Array.from(cache.values());
}

export function getVoice(id: string | undefined | null): Voice {
  if (id) {
    const found = cache.get(id);
    if (found) return found;
  }
  // Fall back to the configured default. If the default itself is
  // somehow missing (corrupted catalog?), use the first built-in to
  // avoid throwing during a session start.
  const fallback = cache.get(DEFAULT_VOICE_ID) ?? BUILTIN_VOICES[0];
  if (!fallback) {
    throw new Error("voices: catalog empty and no built-in fallback");
  }
  if (id) {
    log.warn(`voices: unknown mode_id ${id} — falling back to ${fallback.id}`);
  }
  return fallback;
}

export async function upsertVoice(voice: Voice): Promise<Voice> {
  const normalised = normalisePhasePrompts(voice);
  cache.set(normalised.id, normalised);
  await persist();
  return normalised;
}

export async function updateVoice(id: string, patch: VoiceUpdate): Promise<Voice> {
  const existing = cache.get(id);
  if (!existing) throw new Error(`voices: cannot update unknown voice ${id}`);
  // Patch logic: detect whether the caller intends to set new-style or
  // legacy fields. When only the legacy field is touched, treat it as
  // an alias for the new one (and vice versa); when both are touched,
  // the new-style field wins. Without this, a UI still pinned to
  // `prompt` would write `prompt` while leaving stale `talkingPrompt`
  // in place — readers would see the OLD talking prompt.
  const merged: Voice = { ...existing, ...patch, id, isBuiltin: existing.isBuiltin };
  if ("prompt" in patch && !("talkingPrompt" in patch)) {
    merged.talkingPrompt = patch.prompt ?? "";
  }
  if ("postProcessPrompt" in patch && !("donePrompt" in patch)) {
    merged.donePrompt = patch.postProcessPrompt ?? "";
  }
  const normalised = normalisePhasePrompts(merged);
  cache.set(id, normalised);
  await persist();
  return normalised;
}

export async function deleteVoice(id: string): Promise<void> {
  const existing = cache.get(id);
  if (!existing) return;
  if (existing.isBuiltin) {
    throw new Error(`voices: refusing to delete built-in mode ${id}`);
  }
  cache.delete(id);
  await persist();
}
