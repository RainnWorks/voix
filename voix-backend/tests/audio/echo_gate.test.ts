/**
 * EchoGate tests (B11 — coverage backfill).
 *
 * `src/audio/echo_gate.ts` was at 0% function coverage despite being
 * load-bearing: it's the half-duplex gate that stops model audio from
 * bleeding back into the mic and triggering the "Conversation already
 * has an active response" echo loop (see CLAUDE.md "Common failure
 * modes"). Pure, deterministic logic — no network, no disk — so the
 * gaps here are the cheapest high-value coverage in the daemon.
 *
 * The gate is time-based: `observeSpeaker` records a ref that expires
 * `WINDOW_S` (1.0s) after the chunk's last sample finishes playing,
 * and `shouldForward` drops mic while any ref is unexpired. The tests
 * lean on the playback-duration maths (24 kHz mono PCM16 = 48 000
 * bytes/s) plus the 1s tail window to drive every branch without
 * sleeping a full second where avoidable.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { EchoGate } from "../../src/audio/echo_gate.ts";

describe("EchoGate", () => {
  let nowSpy: ReturnType<typeof spyOn> | null = null;

  /** Pin Date.now() so the playback-window maths is deterministic. */
  function freezeClock(start: number): (t: number) => void {
    let current = start;
    nowSpy = spyOn(Date, "now").mockImplementation(() => current);
    return (t: number) => {
      current = t;
    };
  }

  beforeEach(() => {
    nowSpy = null;
  });
  afterEach(() => {
    nowSpy?.mockRestore();
  });

  test("forwards mic when no speaker audio has been observed", () => {
    const gate = new EchoGate();
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(true);
  });

  test("empty buffers are no-ops: observeSpeaker ignores them, shouldForward passes", () => {
    const gate = new EchoGate();
    // An empty speaker chunk must NOT close the gate.
    gate.observeSpeaker(Buffer.alloc(0));
    expect(gate.shouldForward(Buffer.alloc(0)).forward).toBe(true);
    // And a real mic chunk still forwards because no ref was recorded.
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(true);
  });

  test("drops mic immediately after observing speaker audio (gate closed)", () => {
    const setNow = freezeClock(1_000_000);
    const gate = new EchoGate();
    // 9600 bytes = 4800 samples = 200 ms of playback at 24 kHz.
    gate.observeSpeaker(Buffer.alloc(9600));
    // Same instant — playback hasn't even started draining, ref is live.
    setNow(1_000_000);
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(false);
  });

  test("re-opens after the playback duration + WINDOW_S tail elapses", () => {
    const setNow = freezeClock(2_000_000);
    const gate = new EchoGate();
    // 9600 bytes → 200 ms playback. Ref expires at now + 200 ms, and gc
    // keeps gating until 1.0s (WINDOW_S) past that expiry.
    gate.observeSpeaker(Buffer.alloc(9600));
    // 200 ms playback + 999 ms < 1000 ms tail → still gated.
    setNow(2_000_000 + 200 + 999);
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(false);
    // Past the full 1.0s tail after playback end → gate re-opens.
    setNow(2_000_000 + 200 + 1001);
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(true);
  });

  test("a larger chunk closes the gate for proportionally longer", () => {
    const setNow = freezeClock(3_000_000);
    const gate = new EchoGate();
    // 96000 bytes = 48000 samples = 2000 ms of playback at 24 kHz.
    gate.observeSpeaker(Buffer.alloc(96000));
    // 1.5s in — still within the 2.0s playback burst, gated.
    setNow(3_000_000 + 1500);
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(false);
    // After playback (2000 ms) + full tail (1000 ms) → re-opens.
    setNow(3_000_000 + 2000 + 1001);
    expect(gate.shouldForward(Buffer.alloc(640)).forward).toBe(true);
  });

  test("stats() reports idle, then forwarded/dropped counts and percentage", () => {
    const setNow = freezeClock(4_000_000);
    const gate = new EchoGate();
    expect(gate.stats()).toBe("echo_gate: idle");

    // Two forwards while the gate is open (no refs).
    gate.shouldForward(Buffer.alloc(640));
    gate.shouldForward(Buffer.alloc(640));

    // Close the gate, then two drops.
    gate.observeSpeaker(Buffer.alloc(9600));
    setNow(4_000_000); // same instant — ref live
    gate.shouldForward(Buffer.alloc(640));
    gate.shouldForward(Buffer.alloc(640));

    // 2 forwarded + 2 dropped → 50.0% dropped.
    expect(gate.stats()).toBe("echo_gate: forwarded=2 dropped=2 (50.0% dropped)");
  });
});
