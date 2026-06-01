/**
 * History store tests (B11 — coverage backfill).
 *
 * `src/history/store.ts` had no test file and sat at ~45% line
 * coverage. It's the JSONL-backed dictation/turn log: append-only on
 * disk, full in-memory mirror, writes serialised through an in-process
 * queue. The gaps that matter for data integrity are the recovery
 * paths the daemon hits in the field:
 *   • ENOENT on first boot (no history file yet) must not throw
 *   • a partially-written / corrupt JSONL line must be skipped, not
 *     abort the whole load
 *   • delete has to rewrite the file atomically AND keep the in-memory
 *     mirror consistent (the one non-append operation)
 *
 * Isolation: the store writes to the fixed `paths.historyFile`, which
 * in local dev is the developer's REAL history.jsonl. We snapshot it in
 * beforeAll and restore in afterAll so the suite never destroys real
 * data. Each test gets a fresh module instance (cachebust import) so
 * the module-level `entries`/`loaded`/`writeQueue` state starts clean.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { paths } from "../../src/storage/paths.ts";
import type { NewHistoryEntry } from "../../src/history/store.ts";

type HistoryStore = typeof import("../../src/history/store.ts");

const HISTORY = paths.historyFile;
let backup: string | null = null;

/** Fresh module instance — resets the module-level entries/loaded/queue. */
let cacheBustCounter = 0;
async function freshStore(): Promise<HistoryStore> {
  cacheBustCounter++;
  return (await import(
    `../../src/history/store.ts?cachebust=B11-${cacheBustCounter}`
  )) as HistoryStore;
}

/** A complete NewHistoryEntry with sane defaults; override per test. */
function entry(overrides: Partial<NewHistoryEntry> = {}): NewHistoryEntry {
  return {
    deviceId: "puck-a",
    sessionId: "sess-1",
    voiceId: "default-realtime",
    voiceName: "Realtime",
    modeType: "realtime",
    durationMs: 1234,
    rawText: "hello world",
    processedText: null,
    postProcessProvider: null,
    postProcessModel: null,
    contextSnapshot: [],
    transcriptPath: null,
    ...overrides,
  };
}

beforeAll(async () => {
  try {
    backup = await readFile(HISTORY, "utf8");
  } catch {
    backup = null; // no real file — nothing to protect
  }
});

afterAll(async () => {
  if (backup !== null) {
    await writeFile(HISTORY, backup);
  } else {
    await rm(HISTORY, { force: true });
  }
});

beforeEach(async () => {
  await rm(HISTORY, { force: true });
});

describe("loadHistory", () => {
  test("ENOENT (no history file yet) loads to empty without throwing", async () => {
    const store = await freshStore();
    await store.loadHistory();
    expect(store.listHistory()).toEqual([]);
  });

  test("skips malformed JSONL lines and loads the valid ones", async () => {
    const good1 = JSON.stringify({ id: "a", createdAt: "2026-01-01T00:00:00Z", rawText: "one" });
    const good2 = JSON.stringify({ id: "b", createdAt: "2026-01-02T00:00:00Z", rawText: "two" });
    // A blank line, a truncated/garbage line, and a stray whitespace
    // line all have to be tolerated.
    await writeFile(HISTORY, `${good1}\n\n{ not valid json \n   \n${good2}\n`);
    const store = await freshStore();
    await store.loadHistory();
    const ids = store.listHistory().map((e) => e.id);
    // Both valid entries survive; the two junk lines are dropped.
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});

describe("appendHistory", () => {
  test("assigns id + createdAt and persists one JSONL line to disk", async () => {
    const store = await freshStore();
    await store.loadHistory();
    const saved = await store.appendHistory(entry({ rawText: "first" }));
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBeTruthy();
    expect(saved.rawText).toBe("first");

    // The file holds exactly one parseable line equal to the entry.
    const onDisk = (await readFile(HISTORY, "utf8")).trim().split("\n");
    expect(onDisk).toHaveLength(1);
    expect(JSON.parse(onDisk[0] as string)).toMatchObject({ id: saved.id, rawText: "first" });
  });
});

describe("listHistory", () => {
  test("returns newest-first and honours voiceId filter + limit", async () => {
    const store = await freshStore();
    await store.loadHistory();
    await store.appendHistory(entry({ rawText: "1", voiceId: "vx" }));
    await store.appendHistory(entry({ rawText: "2", voiceId: "other" }));
    const third = await store.appendHistory(entry({ rawText: "3", voiceId: "vx" }));

    // Newest first across the whole set.
    expect(store.listHistory().map((e) => e.rawText)).toEqual(["3", "2", "1"]);
    // Filtered to voiceId "vx", still newest-first.
    expect(store.listHistory({ voiceId: "vx" }).map((e) => e.rawText)).toEqual(["3", "1"]);
    // Limit caps the count after the reverse, so we get the newest one.
    const limited = store.listHistory({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.id).toBe(third.id);
  });
});

describe("deleteHistoryEntry", () => {
  test("removes from memory + rewrites file, returns true; unknown id returns false", async () => {
    const store = await freshStore();
    await store.loadHistory();
    const a = await store.appendHistory(entry({ rawText: "keep" }));
    const b = await store.appendHistory(entry({ rawText: "drop" }));

    expect(await store.deleteHistoryEntry(b.id)).toBe(true);
    // In-memory mirror updated immediately.
    expect(store.getHistoryEntry(b.id)).toBeUndefined();
    expect(store.listHistory().map((e) => e.id)).toEqual([a.id]);
    // File rewritten to just the surviving entry.
    const onDisk = (await readFile(HISTORY, "utf8")).trim().split("\n");
    expect(onDisk).toHaveLength(1);
    expect(JSON.parse(onDisk[0] as string).id).toBe(a.id);

    // Deleting something that isn't there is a no-op false.
    expect(await store.deleteHistoryEntry("does-not-exist")).toBe(false);
  });
});
