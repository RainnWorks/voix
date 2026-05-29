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

async function readFromDisk(): Promise<Voice[]> {
  try {
    const raw = await readFile(paths.voicesFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      log.warn(`voices: ${paths.voicesFile} is not a JSON array — ignoring`);
      return [];
    }
    return parsed as Voice[];
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
    if (existing.prompt !== builtin.prompt) {
      // Update only the built-in-shipped fields. Preserve color etc.
      // which users may have customised through the LED UI.
      cache.set(builtin.id, {
        ...existing,
        prompt: builtin.prompt,
        postProcessPrompt: builtin.postProcessPrompt,
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

export async function upsertVoice(mode: Voice): Promise<Voice> {
  cache.set(mode.id, mode);
  await persist();
  return mode;
}

export async function updateVoice(id: string, patch: VoiceUpdate): Promise<Voice> {
  const existing = cache.get(id);
  if (!existing) throw new Error(`voices: cannot update unknown mode ${id}`);
  const updated: Voice = { ...existing, ...patch, id, isBuiltin: existing.isBuiltin };
  cache.set(id, updated);
  await persist();
  return updated;
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
