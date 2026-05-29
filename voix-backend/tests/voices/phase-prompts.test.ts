/**
 * M03 schema test: `talkingPrompt` + `donePrompt` two-phase prompts.
 *
 * The `normalisePhasePrompts` helper in `voices/store.ts` is the
 * boundary that turns "voice with only legacy `prompt`" /
 * "voice with only new `talkingPrompt`" / "voice with both" into a
 * single canonical in-memory shape with both pairs of fields
 * populated and in sync.
 */

import { describe, expect, test } from "bun:test";
import { normalisePhasePrompts } from "../../src/voices/store.ts";
import type { Voice } from "../../src/voices/types.ts";

function legacyVoice(overrides: Partial<Voice> & { id: string }): Voice {
  // Cast through unknown so we can construct partial shapes that omit
  // M03 fields (mimicking voices.json written before this milestone).
  return overrides as Voice;
}

describe("normalisePhasePrompts", () => {
  test("legacy-only: prompt → talkingPrompt, postProcessPrompt → donePrompt", () => {
    const v = normalisePhasePrompts(
      legacyVoice({
        id: "x",
        prompt: "you are voix.",
        postProcessPrompt: "rewrite as email.",
      }),
    );
    expect(v.talkingPrompt).toBe("you are voix.");
    expect(v.donePrompt).toBe("rewrite as email.");
    // Mirror back — legacy fields preserved.
    expect(v.prompt).toBe("you are voix.");
    expect(v.postProcessPrompt).toBe("rewrite as email.");
  });

  test("new-only: talkingPrompt and donePrompt are kept, legacy mirrored", () => {
    const v = normalisePhasePrompts(
      legacyVoice({
        id: "x",
        talkingPrompt: "talking",
        donePrompt: "done",
      }),
    );
    expect(v.talkingPrompt).toBe("talking");
    expect(v.donePrompt).toBe("done");
    expect(v.prompt).toBe("talking");
    expect(v.postProcessPrompt).toBe("done");
  });

  test("both present: new field wins over legacy", () => {
    const v = normalisePhasePrompts(
      legacyVoice({
        id: "x",
        prompt: "OLD",
        postProcessPrompt: "OLD",
        talkingPrompt: "NEW",
        donePrompt: "NEW",
      }),
    );
    expect(v.talkingPrompt).toBe("NEW");
    expect(v.donePrompt).toBe("NEW");
    expect(v.prompt).toBe("NEW");
    expect(v.postProcessPrompt).toBe("NEW");
  });

  test("neither present: both end up empty string", () => {
    const v = normalisePhasePrompts(legacyVoice({ id: "x" }));
    expect(v.talkingPrompt).toBe("");
    expect(v.donePrompt).toBe("");
    expect(v.prompt).toBe("");
    expect(v.postProcessPrompt).toBe("");
  });

  test("empty new field, populated legacy: legacy wins via the truthy check", () => {
    // An empty string in `talkingPrompt` should NOT clobber a populated
    // `prompt` — that would silently lose the user's existing prompt
    // when an older client wrote `prompt` and a newer one wrote
    // `talkingPrompt: ""`. The truthy check on `talkingPrompt` is the
    // guard.
    const v = normalisePhasePrompts(
      legacyVoice({ id: "x", prompt: "kept", talkingPrompt: "" }),
    );
    expect(v.talkingPrompt).toBe("kept");
    expect(v.prompt).toBe("kept");
  });
});
