/**
 * Mode catalog persistence + in-memory cache.
 *
 * Source of truth: `modes.json` on disk. Loaded eagerly at boot,
 * mutated through `upsert` / `delete`, persisted via atomic temp-then-
 * rename on every mutation.
 *
 * Single-writer semantics — the daemon is one process and mutations are
 * always called from request handlers; no need for a lock around the
 * in-memory map. If we later add a "settings sync" agent or background
 * task that also writes modes, we'll need to revisit.
 *
 * On first boot the catalog is empty → seed with `BUILTIN_MODES` and
 * persist. On subsequent boots we MERGE: built-ins missing from disk
 * get added back (their IDs are stable; an upgrade that ships a new
 * built-in mode shouldn't require users to re-install). User edits to
 * built-ins are preserved — we only add missing entries.
 */

import { readFile } from "node:fs/promises";
import { log } from "../log.ts";
import { atomicWrite } from "../storage/atomic.ts";
import { paths } from "../storage/paths.ts";
import { BUILTIN_MODES, DEFAULT_MODE_ID } from "./builtins.ts";
import type { Mode, ModeUpdate } from "./types.ts";

const cache = new Map<string, Mode>();
let loaded = false;

async function readFromDisk(): Promise<Mode[]> {
  try {
    const raw = await readFile(paths.modesFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      log.warn(`modes: ${paths.modesFile} is not a JSON array — ignoring`);
      return [];
    }
    return parsed as Mode[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log.warn("modes: failed to read modes.json:", err);
    return [];
  }
}

async function persist(): Promise<void> {
  const arr = Array.from(cache.values());
  await atomicWrite(paths.modesFile, JSON.stringify(arr, null, 2));
}

export async function loadModes(): Promise<void> {
  if (loaded) return;
  const onDisk = await readFromDisk();
  for (const m of onDisk) cache.set(m.id, m);

  // Merge in any built-in IDs that aren't already on disk. Users keep
  // their edits to existing built-ins; new built-ins shipped in a
  // future release get auto-added.
  let added = 0;
  for (const builtin of BUILTIN_MODES) {
    if (!cache.has(builtin.id)) {
      cache.set(builtin.id, builtin);
      added++;
    }
  }
  loaded = true;

  if (onDisk.length === 0) {
    log.info(`modes: first boot — seeded ${BUILTIN_MODES.length} built-in modes`);
    await persist();
  } else if (added > 0) {
    log.info(`modes: loaded ${onDisk.length} on-disk + ${added} new built-ins`);
    await persist();
  } else {
    log.info(`modes: loaded ${cache.size} modes`);
  }
}

export function listModes(): Mode[] {
  return Array.from(cache.values());
}

export function getMode(id: string | undefined | null): Mode {
  if (id) {
    const found = cache.get(id);
    if (found) return found;
  }
  // Fall back to the configured default. If the default itself is
  // somehow missing (corrupted catalog?), use the first built-in to
  // avoid throwing during a session start.
  const fallback = cache.get(DEFAULT_MODE_ID) ?? BUILTIN_MODES[0];
  if (!fallback) {
    throw new Error("modes: catalog empty and no built-in fallback");
  }
  if (id) {
    log.warn(`modes: unknown mode_id ${id} — falling back to ${fallback.id}`);
  }
  return fallback;
}

export async function upsertMode(mode: Mode): Promise<Mode> {
  cache.set(mode.id, mode);
  await persist();
  return mode;
}

export async function updateMode(id: string, patch: ModeUpdate): Promise<Mode> {
  const existing = cache.get(id);
  if (!existing) throw new Error(`modes: cannot update unknown mode ${id}`);
  const updated: Mode = { ...existing, ...patch, id, isBuiltin: existing.isBuiltin };
  cache.set(id, updated);
  await persist();
  return updated;
}

export async function deleteMode(id: string): Promise<void> {
  const existing = cache.get(id);
  if (!existing) return;
  if (existing.isBuiltin) {
    throw new Error(`modes: refusing to delete built-in mode ${id}`);
  }
  cache.delete(id);
  await persist();
}
