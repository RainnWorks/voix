/**
 * JSONL-backed history store.
 *
 * Append-only on disk, full in-memory mirror for fast listing. The
 * file format is one JSON object per line so a sysadmin can `tail -f`
 * during debugging and `wc -l` for "how many dictations this month".
 *
 * Concurrency: writes are serialised by an in-process queue. The
 * daemon is single-process so we don't need filesystem-level locking,
 * but two near-simultaneous session-ends could otherwise interleave
 * partial lines.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { log } from "../log.ts";
import { paths } from "../storage/paths.ts";
import type { HistoryEntry } from "./types.ts";

const entries: HistoryEntry[] = [];
let loaded = false;
let writeQueue: Promise<void> = Promise.resolve();

export async function loadHistory(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await readFile(paths.historyFile, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as HistoryEntry);
      } catch {
        log.warn(`history: skipping malformed line: ${trimmed.slice(0, 80)}…`);
      }
    }
    log.info(`history: loaded ${entries.length} entries`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.info("history: no history file yet — starting fresh");
    } else {
      log.warn("history: failed to read:", err);
    }
  }
  loaded = true;
}

export type NewHistoryEntry = Omit<HistoryEntry, "id" | "createdAt">;

export async function appendHistory(partial: NewHistoryEntry): Promise<HistoryEntry> {
  const entry: HistoryEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...partial,
  };
  entries.push(entry);
  // Serialise file writes through a chained promise queue. Each
  // append is one fs.appendFile (atomic at the syscall level under
  // ext4/tmpfs), so we don't need to worry about partial writes.
  writeQueue = writeQueue.then(async () => {
    try {
      await mkdir(dirname(paths.historyFile), { recursive: true });
      await appendFile(paths.historyFile, `${JSON.stringify(entry)}\n`);
    } catch (err) {
      log.warn("history: append failed:", err);
    }
  });
  await writeQueue;
  return entry;
}

export function listHistory(opts?: {
  voiceId?: string;
  deviceId?: string;
  limit?: number;
}): HistoryEntry[] {
  let out = entries;
  if (opts?.voiceId) out = out.filter((e) => e.voiceId === opts.voiceId);
  if (opts?.deviceId) out = out.filter((e) => e.deviceId === opts.deviceId);
  // Newest first, matching what every history UI in the world
  // expects.
  out = [...out].reverse();
  if (opts?.limit && opts.limit > 0) out = out.slice(0, opts.limit);
  return out;
}

export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return entries.find((e) => e.id === id);
}
