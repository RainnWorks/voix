/**
 * Pipeline port — types only.
 *
 * The audio-io port (`src/audio_io/`) talks to endpoints. The pipeline
 * port talks to model providers. They meet through the interfaces
 * here: a `Pipeline` instance hides whatever upstream stack a given
 * intent + voice + provider combination needs (today: OpenAI Realtime
 * for the discuss path; tomorrow: streaming STT for the cheap dictate
 * path, traditional STT → LLM → TTS for the BYO path).
 *
 * Why two ports instead of one: the audio-io layer should never need
 * to know how many model calls produced a given speaker frame, and
 * the pipeline layer should never have to think about WS framing,
 * resource forks, half-duplex on-chip, or hello-time auth. The
 * interface in this file is the load-bearing contract that keeps
 * those concerns from leaking into each other.
 *
 * M07 deliverable. The previous all-in-one `puck/session.ts` mixed
 * both layers — moving the provider-side logic behind `Pipeline`
 * here is what made the split possible.
 */

import type { Intent } from "../audio_io/protocol.ts";
import type { Voice } from "../voices/types.ts";

/**
 * Events the pipeline emits *towards* the connection. A subset of the
 * audio-io v1 `DaemonEvent`; the connection layer maps each one onto
 * the wire format the live endpoint expects (legacy puck names today,
 * the v1 names after M08 ships).
 */
export type PipelineToConnection =
  | { type: "user_speech_start" }
  | { type: "user_speech_end" }
  | { type: "transcript_delta"; text: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "audio_start" }
  | { type: "audio_end" }
  | { type: "error"; message: string };

/**
 * Pipeline → connection bridge. The connection passes one of these
 * when it constructs the pipeline so the pipeline can send things
 * back without knowing what kind of endpoint is on the other end.
 */
export type PipelineCallbacks = {
  /** Send a typed daemon event to the endpoint. */
  sendEvent(event: PipelineToConnection): void;
  /** Send a binary speaker frame. PCM16 LE, mono, at the pipeline's
   *  native rate (24 kHz for OpenAI Realtime today). The connection
   *  resamples to the endpoint's declared `speaker.sample_rate_hz`. */
  sendSpeaker(pcm: Buffer): void;
  /** Pipeline-initiated close (idle timeout, hard ceiling, upstream
   *  error). Connection should tear down the WS. */
  close(): void;
};

/**
 * Everything a pipeline needs to start. Built by the connection layer
 * after parsing the hello + resolving the voice.
 */
export type PipelineStart = {
  /** Stable per-endpoint identifier (e.g. the ESPHome device name for
   *  a puck, a UUID for a phone). */
  deviceId: string;
  /** Unique identifier for this capture; surfaces in logs, transcript
   *  filenames, and the recordings folder. */
  sessionId: string;
  /** Resolved voice (the catalog handles `voice_id` → `Voice`). */
  voice: Voice;
  /** Why the capture is happening (dictate vs discuss). The pipeline
   *  uses this — not `voice.type` — to decide which shape it runs in.
   *  A voice with both phases can be invoked under either intent. */
  intent: Intent;
  /** Sample rate of the mic frames the connection will forward. The
   *  pipeline does its own resample if it needs a different rate
   *  upstream. */
  micSampleRateHz: number;
  /** When true, the endpoint declares it handles AEC + half-duplex
   *  on chip; pipeline skips its software echo gate. */
  halfDuplexOnChip: boolean;
  /** Provider credentials. Passed through rather than imported to
   *  keep the pipeline testable without a working env. */
  openaiApiKey: string;
  /** Pipeline → connection bridge. */
  callbacks: PipelineCallbacks;
};

/**
 * A live capture session as the daemon experiences it from the
 * provider side.
 *
 * Lifetime: `new Pipeline(start)` → `await start()` (opens upstream)
 * → many `pushMic` / `readyForInput` / `bargeIn` calls → `close()`.
 *
 * Errors during `start()` should call `callbacks.close()` and then
 * resolve (or throw, depending on how fatal). Errors mid-session
 * should call `callbacks.sendEvent({ type: "error", ... })` and
 * decide whether to teardown.
 */
export interface Pipeline {
  /** Open upstream provider connections. Resolves once `ready` can
   *  legitimately be sent to the endpoint. */
  start(): Promise<void>;
  /** A binary mic frame arrived from the endpoint. PCM16 LE, mono,
   *  sample rate matches `start.micSampleRateHz`. */
  pushMic(pcm: Buffer): void;
  /** Endpoint signalled it's ready for more input (puck's
   *  `ready_for_input`, or generic audio-io v1 idle reset). */
  readyForInput(): void;
  /** Endpoint signalled user wants to interrupt the model. */
  bargeIn(): void;
  /** Tear down upstream. Idempotent. */
  close(): void;
}

/** Factory shape — connections call this to spin up a pipeline. The
 *  default factory in `pipeline/index.ts` picks the right
 *  implementation based on intent + voice; tests can substitute. */
export type PipelineFactory = (start: PipelineStart) => Pipeline;
