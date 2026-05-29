/**
 * STT provider abstraction.
 *
 * One of three provider interfaces under `pipeline/providers/`. The
 * orchestrator (M13+) picks an STT impl per (voice, intent) and feeds
 * it mic audio; this file is the contract every impl satisfies.
 *
 * Lifetime: orchestrator calls `provider.open(config)` once per
 * capture → returns an `SttSession` → orchestrator pushes
 * `sendAudio(pcm)` while the user speaks → calls `finish()` when VAD
 * fires `speech_end` → drains the final transcript via the event
 * stream → calls `close()`. Open WS underneath stays open the whole
 * time; impls are responsible for any per-session keepalive.
 *
 * The orchestrator never sees provider-specific shapes (Deepgram's
 * `is_final` flag, OpenAI's `transcript.completed` event). Impls
 * translate to the common `SttEvent` shape below.
 */

/** PCM16 LE mono — the daemon's house format. Anything beyond that
 *  (codec, channel layout) the impl handles internally. */
export type SttSessionConfig = {
  /** Sample rate (Hz) of the PCM the orchestrator will push. Provider
   *  resamples internally if its API needs a different rate. */
  sampleRateHz: number;
  /** BCP-47 language hint, e.g. "en", "en-US". Empty / undefined =
   *  provider's default (often auto-detect). */
  language?: string;
  /** When true, the provider should emit `partial` events with
   *  incremental hypotheses while the user is speaking. When false,
   *  only `final` events arrive at endpoint moments. The voice
   *  editor exposes this as an "show live transcript" toggle. */
  interim: boolean;
  /** Optional model override. Each provider has its own naming —
   *  Deepgram = "nova-3" / "nova-2-general", OpenAI =
   *  "gpt-4o-transcribe", etc. Empty = provider default. */
  model?: string;
};

/** Events the session emits towards the orchestrator. Providers
 *  translate their native event streams into these. */
export type SttEvent =
  /** Incremental hypothesis. The text may be rewritten on
   *  subsequent partials — orchestrators should render for live
   *  captions and ignore for the canonical transcript. */
  | { type: "partial"; text: string }
  /** Finalised segment of speech. Concatenate finals in order to
   *  build the canonical transcript. `isEndpoint` is true when the
   *  provider detected end-of-utterance (Deepgram `speech_final`,
   *  OpenAI `transcript.completed`). */
  | { type: "final"; text: string; isEndpoint: boolean }
  /** Recoverable error. Orchestrator decides whether to surface
   *  to the user + close the session. */
  | { type: "error"; message: string }
  /** Provider closed the underlying transport. After this no more
   *  events arrive. */
  | { type: "closed" };

export type SttEventHandler = (event: SttEvent) => void;

/** Active streaming session. One per capture. */
export interface SttSession {
  /** Push a mic frame. PCM16 LE mono at the configured sample rate.
   *  Safe to call zero or many times. */
  sendAudio(pcm: Buffer): void;
  /** Signal end of audio (e.g. VAD speech_end). Provider should
   *  flush any in-flight partial into a final event, then emit
   *  `closed`. Resolves once the final has been emitted. */
  finish(): Promise<void>;
  /** Tear down immediately — no flush. Idempotent. */
  close(): void;
  /** Subscribe to provider events. Multiple subscribers are fine. */
  on(handler: SttEventHandler): void;
}

export interface SttProvider {
  /** Provider name. Used in logs + voice editor's STT provider
   *  picker. Stable — written into per-voice settings as the key
   *  the daemon resolves at session-open time. */
  readonly name: string;
  /** Open a streaming session. Throws if credentials are missing or
   *  upstream rejects the handshake. */
  open(config: SttSessionConfig): Promise<SttSession>;
}
