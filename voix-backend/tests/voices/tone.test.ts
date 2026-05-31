/**
 * M23 schema test: `tone` snippet field on `Voice`.
 *
 * Covers:
 *   • normaliseTone clamps and trims correctly
 *   • normalisePhasePrompts reads tone off raw on-disk records
 *   • updateVoice clamps + trims via the PATCH path
 *   • upsertVoice clamps + trims via the POST path
 *   • Migration safety: built-in voices get their tone refreshed when
 *     the on-disk value is null (Risk 5); user voices NEVER get the
 *     auto-fill regardless of their on-disk tone state (Risk 1).
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  loadVoices,
  normalisePhasePrompts,
  normaliseTone,
  upsertVoice,
  updateVoice,
} from "../../src/voices/store.ts";
import { BUILTIN_TONES } from "../../src/voices/builtins.ts";
import { paths } from "../../src/storage/paths.ts";
import type { Voice } from "../../src/voices/types.ts";

const ROOT = paths.voicesFile.replace(/voices\.json$/, "");

async function reset(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  await rm(paths.voicesFile, { force: true });
  await rm(paths.legacyModesFile, { force: true });
  // The store caches a `loaded` flag at module scope so each test that
  // wants a fresh load needs the on-disk file pre-staged. We can't
  // un-load the in-memory cache from here without a helper, but each
  // test below either drives normalisation directly or stages a
  // fresh-fork by writing voices.json then asserting only on disk.
}

describe("normaliseTone", () => {
  test("returns null for non-strings", () => {
    expect(normaliseTone(null)).toBe(null);
    expect(normaliseTone(undefined)).toBe(null);
    expect(normaliseTone(42)).toBe(null);
    expect(normaliseTone({})).toBe(null);
  });

  test("trims whitespace and returns null for empty", () => {
    expect(normaliseTone("")).toBe(null);
    expect(normaliseTone("   ")).toBe(null);
    expect(normaliseTone("  hi  ")).toBe("hi");
  });

  test("clamps to 80 chars after trim", () => {
    const eighty = "x".repeat(80);
    const ninety = "x".repeat(90);
    expect(normaliseTone(eighty)).toBe(eighty);
    expect(normaliseTone(ninety)).toBe(eighty);
    expect(normaliseTone("  " + ninety + "  ")?.length).toBe(80);
  });
});

describe("normalisePhasePrompts (tone)", () => {
  test("missing tone in on-disk record → null", () => {
    const raw = normalisePhasePrompts({ id: "x" } as Voice & { id: string });
    expect(raw.tone).toBe(null);
  });

  test("string tone is trimmed + clamped on read", () => {
    const raw = normalisePhasePrompts({
      id: "x",
      tone: "  hello  ",
    } as unknown as Voice & { id: string });
    expect(raw.tone).toBe("hello");
  });

  test("explicit null tone stays null", () => {
    const raw = normalisePhasePrompts({
      id: "x",
      tone: null,
    } as unknown as Voice & { id: string });
    expect(raw.tone).toBe(null);
  });
});

describe("tone migration on loadVoices", () => {
  beforeEach(reset);
  afterEach(reset);

  test("built-in voice with null tone gets seeded (Risk 5)", async () => {
    // Stage a voices.json with the realtime built-in but tone=null
    // (simulates a pre-M23 install that just upgraded).
    const preM23 = [
      {
        id: "default-realtime",
        name: "Realtime",
        type: "realtime",
        prompt: "any user-touched prompt — should not block tone refresh",
        talkingPrompt: "any user-touched prompt — should not block tone refresh",
        donePrompt: "",
        postProcessPrompt: "",
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
        postProcessProvider: "openai",
        postProcessModel: "gpt-4o-mini",
        routingHint: "",
        isBuiltin: true,
        tone: null,
      },
    ];
    await writeFile(paths.voicesFile, JSON.stringify(preM23), "utf8");

    // Force a fresh load via dynamic import (sidesteps the loaded
    // flag in the cached module). Reloading the same path is safe
    // because we reset the file before each test.
    const modulePath = `../../src/voices/store.ts?cachebust=${Date.now()}`;
    const fresh = (await import(modulePath)) as typeof import("../../src/voices/store.ts");
    await fresh.loadVoices();
    const seeded = fresh.listVoices().find((v) => v.id === "default-realtime");
    expect(seeded?.tone).toBe(BUILTIN_TONES["default-realtime"] ?? null);
  });

  test("user voice (isBuiltin:false) NEVER auto-fills tone (Risk 1)", async () => {
    // Stage a voices.json with a user voice — must end up with tone:null
    // even though it has no tone field on disk.
    const onDisk = [
      {
        id: "user-custom",
        name: "Mine",
        type: "dictation",
        prompt: "user prompt",
        talkingPrompt: "user prompt",
        donePrompt: "",
        postProcessPrompt: "",
        voice: "",
        model: "",
        color: [3, 169, 244],
        brightness: 0.4,
        effect: "None",
        sttProvider: "openai-realtime",
        sttModel: "gpt-4o-mini-transcribe",
        includeEntities: [],
        includePersons: [],
        addendum: "",
        postProcessProvider: "openai",
        postProcessModel: "gpt-4o-mini",
        routingHint: "user routing hint",
        isBuiltin: false,
      },
    ];
    await writeFile(paths.voicesFile, JSON.stringify(onDisk), "utf8");
    const modulePath = `../../src/voices/store.ts?cachebust=${Date.now()}-user`;
    const fresh = (await import(modulePath)) as typeof import("../../src/voices/store.ts");
    await fresh.loadVoices();
    const user = fresh.listVoices().find((v) => v.id === "user-custom");
    expect(user?.tone).toBe(null);
    expect(user?.isBuiltin).toBe(false);

    // And the persisted disk record (after migration) still has the
    // user voice present.
    const persisted = JSON.parse(await readFile(paths.voicesFile, "utf8")) as Voice[];
    const persistedUser = persisted.find((v) => v.id === "user-custom");
    expect(persistedUser).toBeDefined();
    expect(persistedUser?.tone ?? null).toBe(null);
  });
});

describe("updateVoice + upsertVoice clamp tone", () => {
  beforeEach(reset);
  afterEach(reset);

  test("PATCH with oversize tone clamps to 80 chars", async () => {
    const modulePath = `../../src/voices/store.ts?cachebust=${Date.now()}-patch`;
    const fresh = (await import(modulePath)) as typeof import("../../src/voices/store.ts");
    await fresh.loadVoices();
    const tooLong = "x".repeat(150);
    const updated = await fresh.updateVoice("default-realtime", { tone: tooLong });
    expect(updated.tone?.length).toBe(80);
  });

  test("PATCH with whitespace-only tone becomes null", async () => {
    const modulePath = `../../src/voices/store.ts?cachebust=${Date.now()}-blank`;
    const fresh = (await import(modulePath)) as typeof import("../../src/voices/store.ts");
    await fresh.loadVoices();
    const updated = await fresh.updateVoice("default-realtime", { tone: "   " });
    expect(updated.tone).toBe(null);
  });

  test("upsertVoice trims tone on creation", async () => {
    const modulePath = `../../src/voices/store.ts?cachebust=${Date.now()}-upsert`;
    const fresh = (await import(modulePath)) as typeof import("../../src/voices/store.ts");
    await fresh.loadVoices();
    const created = await fresh.upsertVoice({
      id: "user-tone-test",
      name: "Test",
      type: "dictation",
      prompt: "",
      talkingPrompt: "",
      donePrompt: "",
      postProcessPrompt: "",
      voice: "",
      model: "",
      color: [3, 169, 244],
      brightness: 0.4,
      effect: "None",
      sttProvider: "openai-realtime",
      sttModel: "gpt-4o-mini-transcribe",
      includeEntities: [],
      includePersons: [],
      addendum: "",
      postProcessProvider: "openai",
      postProcessModel: "gpt-4o-mini",
      routingHint: "",
      isBuiltin: false,
      tone: "  trim me  ",
    });
    expect(created.tone).toBe("trim me");
  });
});

// loadVoices used implicitly above; reference so it isn't reported as
// unused on a strict check.
void loadVoices;
void upsertVoice;
void updateVoice;
