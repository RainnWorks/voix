/**
 * Voice Activity Detection — interface + result types.
 *
 * The pipeline orchestrator (Phase 4) uses a VAD to drive auto-stop
 * on the dictate path and turn-taking on the traditional discuss
 * path. Today's realtime path lets OpenAI's server-side VAD do this
 * work; the traditional path needs us to own it.
 *
 * One `Vad` instance per capture session. Caller pushes mic frames
 * (PCM16 LE, mono) at a fixed sample rate; VAD emits a state change
 * event whenever it crosses the start-of-speech or end-of-speech
 * boundary.
 *
 * M09 ships an energy-based implementation behind this interface +
 * a bench tool (`scripts/vad-bench.ts`) for tuning the thresholds.
 * Better impls (Silero ONNX, WebRTC VAD) can land later behind the
 * same interface without touching the orchestrator.
 */

/**
 * A single VAD decision emitted at frame boundaries. Most frames
 * carry `kind: "continue"` (the VAD's state didn't change); the
 * interesting ones are `speech_start` and `speech_end`.
 */
export type VadEvent =
  | { kind: "continue"; speaking: boolean }
  | { kind: "speech_start"; atMs: number }
  | { kind: "speech_end"; atMs: number };

/**
 * Diagnostic snapshot of the VAD's internal state — exposed for the
 * tuning bench so it can log per-frame RMS + the smoothed value
 * without having to re-derive them. Production callers can ignore.
 */
export type VadDebug = {
  /** Raw RMS of the most recent frame. */
  rms: number;
  /** Smoothed RMS used for the threshold compare. */
  smoothed: number;
  /** Current speech-start / speech-end thresholds (may move if the
   *  impl supports adaptive noise floor). */
  startThreshold: number;
  endThreshold: number;
  /** Frames spent in the current state since the last transition. */
  framesInState: number;
};

export interface Vad {
  /** Push one mic frame. Returns the event for this frame.
   *  `nowMs` should be a monotonic timestamp (typically the
   *  cumulative duration of audio fed so far). */
  push(pcm: Buffer, nowMs: number): VadEvent;
  /** Return diagnostic snapshot. Cheap; safe to call every frame. */
  debug(): VadDebug;
  /** Whether the VAD currently believes someone is speaking. */
  isSpeaking(): boolean;
  /** Reset to silent state. Use between captures. */
  reset(): void;
}
