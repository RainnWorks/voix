/**
 * Energy-based VAD with hysteresis + hangover.
 *
 * Algorithm:
 *
 *   1. **RMS per frame.** For each pushed PCM16 chunk we compute the
 *      root-mean-square of its samples. RMS sits in the low thousands
 *      for normal speech on the Voice PE mic, low hundreds on quiet
 *      rooms, near zero on silence.
 *
 *   2. **EMA smoothing.** Raw RMS jitters from frame to frame; a
 *      single low-energy frame inside a word would clip the speech
 *      decision. We smooth via a one-pole low-pass with a 50 ms time
 *      constant — fast enough to react to onsets, slow enough to
 *      ride through normal inter-syllable dips.
 *
 *   3. **Hysteresis.** Two thresholds, not one. `startThreshold`
 *      (higher) trips speech-start; `endThreshold` (lower) trips
 *      speech-end. Without this the smoothed RMS bouncing around the
 *      boundary causes rapid speaking/silent flips ("speech_start"
 *      events every ~80 ms during a pause).
 *
 *   4. **Hangover.** After the smoothed RMS drops below
 *      `endThreshold`, we wait `minSilenceMs` before emitting
 *      `speech_end`. This is the "feels present without clipping"
 *      knob — too short and the model interrupts you mid-sentence
 *      when you take a breath; too long and the bench shows a 1 s
 *      lag between true end-of-speech and the auto-stop.
 *
 *   5. **Pre-roll.** `startFrames` consecutive frames above
 *      `startThreshold` are required before we emit `speech_start`.
 *      Filters out single-frame impulses (door slam, cough far from
 *      mic) that would otherwise drive a false start.
 *
 * Why not Silero / WebRTC: both are excellent and either could land
 * later behind the `Vad` interface in `types.ts`. The energy VAD is
 * lighter (no ONNX runtime, no native deps), tunable from numbers in
 * a JSON config, and good enough for tuning the *system* — getting
 * the orchestrator's auto-stop policy right before swapping in a
 * heavier impl makes that swap drop-in.
 */

import type { Vad, VadDebug, VadEvent } from "./types.ts";

/**
 * All tuning knobs in one object so a JSON config (or the bench's
 * --config flag) can override any subset without touching code.
 *
 * The defaults below are starting points for the Voice PE puck at
 * 16 kHz mic, channel-0 AGC pipeline stage. The tuning bench is for
 * walking these toward the "feels right" sweet spot.
 */
export type EnergyVadConfig = {
  /** PCM sample rate, Hz. Voice PE = 16000; phone mic = 48000. */
  sampleRateHz: number;
  /** Crossing-to-speak RMS. Higher = stricter onset. */
  startThreshold: number;
  /** Crossing-to-silence RMS. Lower than start so hysteresis works. */
  endThreshold: number;
  /** EMA smoothing time constant, ms. ~50 ms is the sweet spot —
   *  long enough to ride through brief dips inside words, short
   *  enough that speech onsets aren't lagged. */
  smoothMs: number;
  /** Frames above startThreshold required before emitting
   *  `speech_start`. Two at 20 ms/frame = 40 ms — filters single-
   *  frame impulses without noticeably lagging real speech onsets. */
  startFrames: number;
  /** Continuous silence (smoothed RMS < endThreshold) required
   *  before emitting `speech_end`. The "do I think the user is done?"
   *  knob. Build-plan acceptance: 300-600 ms. */
  minSilenceMs: number;
};

export const DEFAULT_ENERGY_VAD_CONFIG: EnergyVadConfig = {
  sampleRateHz: 16000,
  startThreshold: 800,
  endThreshold: 400,
  smoothMs: 50,
  startFrames: 2,
  minSilenceMs: 400,
};

/** Cheap RMS over a PCM16 LE buffer. Diagnostic-quality (sqrt is the
 *  whole-buffer cost, not per-sample) — same routine the realtime
 *  pipeline uses for its mic_rms log. */
export function computeRms(pcm16: Buffer): number {
  if (pcm16.length < 2) return 0;
  const n = Math.floor(pcm16.length / 2);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm16.readInt16LE(i * 2);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / n);
}

export class EnergyVad implements Vad {
  private speaking = false;
  private smoothed = 0;
  /** Time the smoothed RMS last crossed below `endThreshold` while in
   *  the "speaking" state. Used to enforce `minSilenceMs`. */
  private fellBelowAtMs: number | null = null;
  /** Consecutive frames above `startThreshold` while in "silent"
   *  state. Used to enforce `startFrames`. */
  private framesAbove = 0;
  /** Total frames in current state (for VadDebug). */
  private framesInState = 0;
  /** EMA alpha derived from smoothMs once at construction. */
  private alpha: number;
  /** Last raw RMS — exposed for debug() only. */
  private lastRms = 0;

  constructor(private readonly cfg: EnergyVadConfig = DEFAULT_ENERGY_VAD_CONFIG) {
    // One-pole low-pass: y[n] = alpha * x[n] + (1 - alpha) * y[n-1].
    // With frame_duration_ms = 20 (typical) and smoothMs = 50 the time
    // constant works out to alpha ≈ frame / (smooth + frame) ≈ 0.286.
    // Derive on first push() since we don't know frame size until then.
    this.alpha = 0;
  }

  push(pcm: Buffer, nowMs: number): VadEvent {
    const rms = computeRms(pcm);
    this.lastRms = rms;

    // Derive alpha once we know how long this frame represents. The
    // formula `alpha = dt / (tau + dt)` is the standard one-pole
    // discretisation for a time constant `tau` at sample period `dt`.
    if (this.alpha === 0) {
      const frameMs = (pcm.length / 2 / this.cfg.sampleRateHz) * 1000;
      this.alpha = frameMs / (this.cfg.smoothMs + frameMs);
    }

    this.smoothed = this.alpha * rms + (1 - this.alpha) * this.smoothed;
    this.framesInState++;

    if (this.speaking) {
      if (this.smoothed < this.cfg.endThreshold) {
        // First sub-threshold frame? Stamp the time so we can measure
        // continuous silence. Subsequent frames either keep us in this
        // window (RMS stays low) or reset it (a syllable inside the
        // hangover lifts us above end threshold).
        if (this.fellBelowAtMs === null) this.fellBelowAtMs = nowMs;
        const silentMs = nowMs - this.fellBelowAtMs;
        if (silentMs >= this.cfg.minSilenceMs) {
          this.speaking = false;
          this.framesInState = 0;
          this.framesAbove = 0;
          this.fellBelowAtMs = null;
          return { kind: "speech_end", atMs: nowMs };
        }
      } else {
        // Brief dip ended — reset the silence clock.
        this.fellBelowAtMs = null;
      }
      return { kind: "continue", speaking: true };
    }

    // Silent state — count CONSECUTIVE RAW frames above startThreshold.
    // Raw, not smoothed, because the EMA bleeds a single loud frame's
    // energy into the next few quiet ones — defeating the
    // impulse-rejection guarantee that startFrames is meant to give us.
    // (The smoothed value is the right input for end-of-speech, where
    // we want to ride through normal inter-syllable dips. But for
    // onset detection we want "N actually-loud frames in a row".)
    if (rms > this.cfg.startThreshold) {
      this.framesAbove++;
      if (this.framesAbove >= this.cfg.startFrames) {
        this.speaking = true;
        this.framesInState = 0;
        this.fellBelowAtMs = null;
        return { kind: "speech_start", atMs: nowMs };
      }
    } else {
      this.framesAbove = 0;
    }
    return { kind: "continue", speaking: false };
  }

  debug(): VadDebug {
    return {
      rms: this.lastRms,
      smoothed: this.smoothed,
      startThreshold: this.cfg.startThreshold,
      endThreshold: this.cfg.endThreshold,
      framesInState: this.framesInState,
    };
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.smoothed = 0;
    this.fellBelowAtMs = null;
    this.framesAbove = 0;
    this.framesInState = 0;
    this.lastRms = 0;
  }
}
