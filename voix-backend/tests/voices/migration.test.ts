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
 *
 * Also covers M-Arch Wave A #15: pre-Wave-A voices.json (with
 * `postProcessProvider` typed as the closed `"openai" | "openrouter"`
 * literal) loads back through `normalisePhasePrompts` unchanged after
 * the type opened to `string`. New open-shape provider names also
 * round-trip — confirming the catalog doesn't reject anything that
 * used to be valid AND doesn't reject the post-#2 open shape.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrateModesToVoices, normalisePhasePrompts } from "../../src/voices/store.ts";
import { paths } from "../../src/storage/paths.ts";
import type { Voice } from "../../src/voices/types.ts";

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

/**
 * M-Arch Wave A #15: voices written under the pre-Wave-A schema (with
 * `postProcessProvider: "openai" | "openrouter"` as a closed literal
 * union) must round-trip through `normalisePhasePrompts` after the
 * type opened to `string`. Confirms the open shape didn't reject
 * anything that used to be valid AND new provider names persist
 * verbatim. Pass-through only — no migration, no field rewrite.
 */
describe("M-Arch Wave A #15 — pre-Wave-A voices.json pass-through", () => {
  beforeEach(reset);
  afterEach(reset);

  /** Build a pre-Wave-A voice record verbatim. The cast through
   *  `unknown` mimics what would have been on disk before
   *  `postProcessProvider` opened up — the literal union typed it as
   *  `"openai" | "openrouter"` then; today it's `string`. The runtime
   *  shape is identical. */
  function preWaveAVoice(provider: string): Partial<Voice> & { id: string } {
    return {
      id: `pre-wave-a-${provider}`,
      name: `Pre-Wave-A (${provider})`,
      type: "dictation",
      talkingPrompt: "",
      donePrompt: "rewrite as email.",
      prompt: "",
      postProcessPrompt: "rewrite as email.",
      voice: "alloy",
      model: "gpt-realtime-2",
      color: [255, 51, 204],
      brightness: 0.4,
      effect: "None",
      sttProvider: "openai-realtime",
      sttModel: "gpt-4o-mini-transcribe",
      includeEntities: [],
      includePersons: [],
      addendum: "",
      // The load-bearing field: provider name straight onto an open `string`.
      postProcessProvider: provider,
      postProcessModel: "gpt-4o-mini",
      routingHint: "",
      isBuiltin: false,
      tone: null,
    };
  }

  test("postProcessProvider='openai' round-trips through normalisePhasePrompts", () => {
    const raw = preWaveAVoice("openai");
    const v = normalisePhasePrompts(raw);
    expect(v.postProcessProvider).toBe("openai");
    expect(v.id).toBe("pre-wave-a-openai");
    // donePrompt mirrors postProcessPrompt for backwards-compat;
    // legacy fields are preserved verbatim on the way back out.
    expect(v.donePrompt).toBe("rewrite as email.");
    expect(v.postProcessPrompt).toBe("rewrite as email.");
  });

  test("postProcessProvider='openrouter' round-trips through normalisePhasePrompts", () => {
    const raw = preWaveAVoice("openrouter");
    const v = normalisePhasePrompts(raw);
    expect(v.postProcessProvider).toBe("openrouter");
  });

  test("post-Wave-A open shape: arbitrary provider name (e.g. 'anthropic') round-trips", () => {
    // After Wave A #2 the type opened to `string`; the catalog must
    // not reject names that weren't in the legacy closed union. This
    // is the load-bearing assertion for the "any new provider is a
    // boot-time registration, not a type edit" property.
    const raw = preWaveAVoice("anthropic");
    const v = normalisePhasePrompts(raw);
    expect(v.postProcessProvider).toBe("anthropic");
  });

  test("disk → load → disk: file contents on the way back out match the input record", async () => {
    // End-to-end: stage a pre-Wave-A file with two voices (one per
    // legacy provider name + one with a new open-shape name), force
    // a fresh module load, and confirm every voice survives — both
    // its identity and its provider field.
    const onDisk = [
      preWaveAVoice("openai"),
      preWaveAVoice("openrouter"),
      preWaveAVoice("anthropic"),
    ];
    await writeFile(paths.voicesFile, JSON.stringify(onDisk), "utf8");
    const modulePath = `../../src/voices/store.ts?cachebust=${Date.now()}-mArchA15`;
    const fresh = (await import(modulePath)) as typeof import("../../src/voices/store.ts");
    await fresh.loadVoices();
    const all = fresh.listVoices();
    for (const expected of onDisk) {
      const got = all.find((v) => v.id === expected.id);
      expect(got).toBeDefined();
      expect(got?.postProcessProvider).toBe(expected.postProcessProvider as string);
      expect(got?.isBuiltin).toBe(false);
    }
    // And the persisted file (loadVoices may have re-written to add
    // built-ins) still contains all three open-named voices.
    const persisted = JSON.parse(await readFile(paths.voicesFile, "utf8")) as Voice[];
    expect(persisted.find((v) => v.id === "pre-wave-a-openai")?.postProcessProvider).toBe("openai");
    expect(persisted.find((v) => v.id === "pre-wave-a-openrouter")?.postProcessProvider).toBe(
      "openrouter",
    );
    expect(persisted.find((v) => v.id === "pre-wave-a-anthropic")?.postProcessProvider).toBe(
      "anthropic",
    );
  });

  test("normaliseTone / normalisePhasePrompts don't reject pre-Wave-A nulls/empties", () => {
    // Sanity: anything that used to be valid in the pre-Wave-A shape
    // still passes through. The classic "no tone field" case
    // (recorded before M23) and the empty-string sttProvider case
    // both survive.
    const raw: Partial<Voice> & { id: string } = {
      id: "edge-case",
      name: "Edge",
      type: "dictation",
      // No talkingPrompt/donePrompt — only the legacy fields.
      prompt: "talk",
      postProcessPrompt: "done",
      // Empty STT provider (the pre-Wave-A default for some legacy
      // user-created voices).
      sttProvider: "",
      sttModel: "",
      postProcessProvider: "openai",
      postProcessModel: "",
      isBuiltin: false,
      // No tone field at all (mimic the pre-M23 schema).
    };
    // No throw, no rejection, both pairs of prompt fields populated.
    const v = normalisePhasePrompts(raw);
    expect(v.talkingPrompt).toBe("talk");
    expect(v.donePrompt).toBe("done");
    expect(v.prompt).toBe("talk");
    expect(v.postProcessPrompt).toBe("done");
    expect(v.tone).toBe(null);
    expect(v.sttProvider).toBe("");
    expect(v.postProcessProvider).toBe("openai");
  });
});
