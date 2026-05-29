/**
 * M05 protocol test: `resolveCapture` maps incoming hellos onto the
 * canonical `intent` + `voice_id` shape regardless of which vocabulary
 * (new or legacy) the client used.
 *
 * The matrix:
 *   new fields only           → use them as-is
 *   legacy fields only        → map mode → intent, mode_id → voice_id
 *   both                      → new wins
 *   neither                   → intent defaults to "discuss", voice_id undefined
 */

import { describe, expect, test } from "bun:test";
import { type PuckHello, resolveCapture } from "../../src/puck/protocol.ts";

function hello(extra: Partial<PuckHello>): PuckHello {
  return {
    type: "hello",
    token: "tok",
    device_id: "puck-x",
    ...extra,
  };
}

describe("resolveCapture", () => {
  test("new fields used as-is", () => {
    const { intent, voiceId } = resolveCapture(
      hello({ intent: "dictate", voice_id: "default-email" }),
    );
    expect(intent).toBe("dictate");
    expect(voiceId).toBe("default-email");
  });

  test("legacy fields map: realtime → discuss, mode_id → voice_id", () => {
    const { intent, voiceId } = resolveCapture(
      hello({ mode: "realtime", mode_id: "default-realtime" }),
    );
    expect(intent).toBe("discuss");
    expect(voiceId).toBe("default-realtime");
  });

  test("legacy fields map: dictation → dictate", () => {
    const { intent } = resolveCapture(hello({ mode: "dictation", mode_id: "default-email" }));
    expect(intent).toBe("dictate");
  });

  test("new fields win over legacy when both present", () => {
    const { intent, voiceId } = resolveCapture(
      hello({
        intent: "dictate",
        voice_id: "new-voice",
        mode: "realtime",
        mode_id: "old-voice",
      }),
    );
    expect(intent).toBe("dictate");
    expect(voiceId).toBe("new-voice");
  });

  test("neither set: intent defaults to discuss, voice_id undefined", () => {
    const { intent, voiceId } = resolveCapture(hello({}));
    expect(intent).toBe("discuss");
    expect(voiceId).toBeUndefined();
  });

  test("only intent set: voice_id stays undefined (daemon will fall back to default)", () => {
    const { intent, voiceId } = resolveCapture(hello({ intent: "dictate" }));
    expect(intent).toBe("dictate");
    expect(voiceId).toBeUndefined();
  });

  test("only voice_id set: intent defaults to discuss", () => {
    const { intent, voiceId } = resolveCapture(hello({ voice_id: "default-email" }));
    expect(intent).toBe("discuss");
    expect(voiceId).toBe("default-email");
  });
});
