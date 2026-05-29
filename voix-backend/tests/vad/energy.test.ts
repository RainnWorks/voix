/**
 * M09 VAD unit tests.
 *
 * Synthetic-waveform driven so the assertions are deterministic — we
 * generate silence + a tone of known RMS, feed the VAD frame-by-frame,
 * and verify it transitions at the right moments. The bench tool
 * (`scripts/vad-bench.ts`) is the human-in-the-loop counterpart for
 * tuning the *defaults*; this test verifies the *algorithm*.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ENERGY_VAD_CONFIG,
  type EnergyVadConfig,
  EnergyVad,
} from "../../src/vad/energy.ts";
import type { Vad, VadEvent } from "../../src/vad/types.ts";

const SAMPLE_RATE = 16000;
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = Math.floor((FRAME_MS / 1000) * SAMPLE_RATE);

/** Build one PCM16 frame of constant amplitude. */
function constFrame(amplitude: number): Buffer {
  const buf = Buffer.alloc(SAMPLES_PER_FRAME * 2);
  for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
    buf.writeInt16LE(amplitude, i * 2);
  }
  return buf;
}

/** Build one PCM16 frame of a sine tone at `hz` and peak `peak`. */
function toneFrame(hz: number, peak: number, frameIndex: number): Buffer {
  const buf = Buffer.alloc(SAMPLES_PER_FRAME * 2);
  const start = frameIndex * SAMPLES_PER_FRAME;
  for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
    const t = (start + i) / SAMPLE_RATE;
    const sample = Math.round(peak * Math.sin(2 * Math.PI * hz * t));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

/** Replay a synthetic stream and collect every non-`continue` event. */
function run(
  vad: Vad,
  frames: Buffer[],
): Array<{ event: VadEvent; frameIndex: number; atMs: number }> {
  const transitions: Array<{ event: VadEvent; frameIndex: number; atMs: number }> = [];
  for (let i = 0; i < frames.length; i++) {
    const atMs = i * FRAME_MS;
    const ev = vad.push(frames[i] ?? Buffer.alloc(0), atMs);
    if (ev.kind !== "continue") {
      transitions.push({ event: ev, frameIndex: i, atMs });
    }
  }
  return transitions;
}

const baseCfg: EnergyVadConfig = {
  ...DEFAULT_ENERGY_VAD_CONFIG,
  sampleRateHz: SAMPLE_RATE,
};

describe("EnergyVad — basic transitions", () => {
  test("pure silence never emits a speech_start", () => {
    const vad = new EnergyVad(baseCfg);
    const frames = Array.from({ length: 50 }, () => constFrame(0));
    const transitions = run(vad, frames);
    expect(transitions).toHaveLength(0);
    expect(vad.isSpeaking()).toBe(false);
  });

  test("constant tone above startThreshold triggers exactly one speech_start", () => {
    // A sine peak of 8000 has RMS = 8000/sqrt(2) ≈ 5657, well above
    // the default startThreshold (800).
    const vad = new EnergyVad(baseCfg);
    const frames = Array.from({ length: 50 }, (_, i) => toneFrame(440, 8000, i));
    const transitions = run(vad, frames);
    const starts = transitions.filter((t) => t.event.kind === "speech_start");
    expect(starts).toHaveLength(1);
    expect(vad.isSpeaking()).toBe(true);
  });

  test("tone then silence emits speech_start then speech_end within minSilenceMs", () => {
    const vad = new EnergyVad(baseCfg);
    const tone = Array.from({ length: 50 }, (_, i) => toneFrame(440, 8000, i));
    const silence = Array.from({ length: 50 }, () => constFrame(0));
    const transitions = run(vad, [...tone, ...silence]);
    const starts = transitions.filter((t) => t.event.kind === "speech_start");
    const ends = transitions.filter((t) => t.event.kind === "speech_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    // end should arrive within (minSilenceMs + smoothing slack) of the
    // tone ending. Tone ends at 50 * 20 = 1000 ms. minSilenceMs = 400,
    // plus EMA time to drop below endThreshold (~smoothMs ≈ 50ms,
    // plus a few extra frames for the smoothed value to actually
    // cross). Give 200 ms slack on top.
    const endAtMs = ends[0]!.atMs;
    expect(endAtMs).toBeGreaterThanOrEqual(1000 + baseCfg.minSilenceMs);
    expect(endAtMs).toBeLessThan(1000 + baseCfg.minSilenceMs + 600);
  });
});

describe("EnergyVad — hysteresis + hangover", () => {
  test("smoothed RMS dipping below endThreshold but recovering does NOT end speech", () => {
    // Build a stream that goes loud → ~1 frame quiet (mid-syllable
    // dip) → loud → quiet. The early dip should NOT terminate speech;
    // only the sustained quiet at the end should.
    const vad = new EnergyVad(baseCfg);
    const loud = (i: number) => toneFrame(440, 8000, i);
    const quiet = () => constFrame(0);

    const frames: Buffer[] = [];
    for (let i = 0; i < 25; i++) frames.push(loud(i));
    frames.push(quiet()); // 1-frame dip — well under minSilenceMs (=400ms)
    for (let i = 26; i < 50; i++) frames.push(loud(i));
    for (let i = 0; i < 50; i++) frames.push(quiet());

    const transitions = run(vad, frames);
    const ends = transitions.filter((t) => t.event.kind === "speech_end");
    expect(ends).toHaveLength(1);
    // Single end transition, fired during the final silence run, NOT
    // during the mid-stream dip.
    expect(ends[0]!.atMs).toBeGreaterThan(50 * FRAME_MS);
  });

  test("single-frame loud spike does NOT trigger speech_start (start_frames guard)", () => {
    const vad = new EnergyVad({ ...baseCfg, startFrames: 2 });
    const silence = Array.from({ length: 10 }, () => constFrame(0));
    const spike = [toneFrame(440, 12000, 10)];
    const moreSilence = Array.from({ length: 10 }, () => constFrame(0));
    const transitions = run(vad, [...silence, ...spike, ...moreSilence]);
    expect(transitions.filter((t) => t.event.kind === "speech_start")).toHaveLength(0);
  });

  test("two-frame loud burst DOES trigger speech_start", () => {
    const vad = new EnergyVad({ ...baseCfg, startFrames: 2 });
    const silence = Array.from({ length: 10 }, () => constFrame(0));
    const burst = Array.from({ length: 10 }, (_, i) => toneFrame(440, 12000, i));
    const transitions = run(vad, [...silence, ...burst]);
    expect(transitions.filter((t) => t.event.kind === "speech_start")).toHaveLength(1);
  });
});

describe("EnergyVad — threshold tuning sanity", () => {
  test("higher startThreshold suppresses a marginal tone", () => {
    // Tone peak 1200 → RMS ≈ 848 ≈ around the default startThreshold.
    // With a higher threshold (1500) the same tone should be silent.
    const cfg: EnergyVadConfig = { ...baseCfg, startThreshold: 1500 };
    const vad = new EnergyVad(cfg);
    const frames = Array.from({ length: 50 }, (_, i) => toneFrame(440, 1200, i));
    const transitions = run(vad, frames);
    expect(transitions).toHaveLength(0);
  });

  test("shorter minSilenceMs ends speech sooner", () => {
    const fast = new EnergyVad({ ...baseCfg, minSilenceMs: 100 });
    const slow = new EnergyVad({ ...baseCfg, minSilenceMs: 800 });
    const tone = Array.from({ length: 50 }, (_, i) => toneFrame(440, 8000, i));
    const silence = Array.from({ length: 80 }, () => constFrame(0));
    const stream = [...tone, ...silence];

    const fastEnd = run(fast, stream).find((t) => t.event.kind === "speech_end")?.atMs ?? -1;
    // Re-stream through slow (separate VAD, no shared state).
    const slowEnd = run(slow, stream).find((t) => t.event.kind === "speech_end")?.atMs ?? -1;

    expect(fastEnd).toBeGreaterThan(0);
    expect(slowEnd).toBeGreaterThan(0);
    expect(fastEnd).toBeLessThan(slowEnd);
    // Roughly the difference between the two minSilenceMs values
    // (modulo a few EMA-settling frames).
    expect(slowEnd - fastEnd).toBeGreaterThanOrEqual(500);
  });
});

describe("EnergyVad — lifecycle", () => {
  test("reset() returns the VAD to silent / fresh state", () => {
    const vad = new EnergyVad(baseCfg);
    // Drive it to speaking.
    const tone = Array.from({ length: 30 }, (_, i) => toneFrame(440, 8000, i));
    run(vad, tone);
    expect(vad.isSpeaking()).toBe(true);

    vad.reset();
    expect(vad.isSpeaking()).toBe(false);

    // After reset, a single loud frame followed by silence should NOT
    // trigger speech_start (start_frames guard reapplies).
    const transitions = run(vad, [toneFrame(440, 12000, 0), ...Array.from({ length: 10 }, () => constFrame(0))]);
    expect(transitions).toHaveLength(0);
  });

  test("debug() exposes current state snapshot", () => {
    const vad = new EnergyVad(baseCfg);
    vad.push(toneFrame(440, 8000, 0), 0);
    const dbg = vad.debug();
    expect(dbg.rms).toBeGreaterThan(0);
    expect(dbg.smoothed).toBeGreaterThan(0);
    expect(dbg.startThreshold).toBe(baseCfg.startThreshold);
    expect(dbg.endThreshold).toBe(baseCfg.endThreshold);
  });
});
