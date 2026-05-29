/**
 * M02 migration test: `modes.json` → `voices.json`.
 *
 * The voices catalog used to be persisted at `dataPath("modes.json")`.
 * The store's `migrateModesToVoices()` helper renames it on first boot
 * if the legacy file is the only one present.
 *
 * Covers three branches:
 *   • voices.json already exists → skipped (legacy left alone)
 *   • only modes.json exists → renamed
 *   • neither exists → none
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrateModesToVoices } from "../../src/voices/store.ts";
import { paths } from "../../src/storage/paths.ts";

const ROOT = paths.voicesFile.replace(/voices\.json$/, "");

async function reset(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  await rm(paths.voicesFile, { force: true });
  await rm(paths.legacyModesFile, { force: true });
}

describe("migrateModesToVoices", () => {
  beforeEach(reset);
  afterEach(reset);

  test("returns 'none' when neither file exists", async () => {
    const result = await migrateModesToVoices();
    expect(result).toBe("none");
  });

  test("returns 'skipped' when voices.json already exists", async () => {
    await writeFile(paths.voicesFile, "[]", "utf8");
    await writeFile(paths.legacyModesFile, '[{"id":"x"}]', "utf8");
    const result = await migrateModesToVoices();
    expect(result).toBe("skipped");
    // Both files still present, voices.json untouched.
    const voices = await readFile(paths.voicesFile, "utf8");
    expect(voices).toBe("[]");
    const modes = await readFile(paths.legacyModesFile, "utf8");
    expect(modes).toBe('[{"id":"x"}]');
  });

  test("renames modes.json → voices.json when only the legacy file exists", async () => {
    const payload = '[{"id":"default-realtime","name":"Realtime"}]';
    await writeFile(paths.legacyModesFile, payload, "utf8");
    const result = await migrateModesToVoices();
    expect(result).toBe("migrated");
    // The legacy file is gone.
    await expect(readFile(paths.legacyModesFile, "utf8")).rejects.toThrow();
    // The new file holds the exact payload.
    const after = await readFile(paths.voicesFile, "utf8");
    expect(after).toBe(payload);
  });

  test("idempotent: re-running after a migration is a no-op", async () => {
    await writeFile(paths.legacyModesFile, "[]", "utf8");
    await migrateModesToVoices(); // first run renames
    const result = await migrateModesToVoices(); // second run sees voices.json present
    expect(result).toBe("skipped");
  });
});
