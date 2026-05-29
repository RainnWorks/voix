/**
 * TTS provider abstraction.
 *
 * Third of three provider interfaces under `pipeline/providers/`. The
 * orchestrator (M13+) uses this on the traditional discuss path: the
 * LLM produces a reply, this provider turns it into PCM, the audio-io
 * port sends it to the endpoint as binary frames.
 *
 * Two modes per session:
 *
 *   1. **Push text chunks** while the LLM is still producing them.
 *      Provider streams audio back as soon as it has a phrase. This
 *      is the low-latency path the design brief cares about — a
 *      "voice should feel snappy" experience means starting the
 *      reply audio before the LLM has finished the last sentence.
 *
 *   2. **Synthesize a whole utterance** (`finish`-then-await). For
 *      callers that already have the full text (the done-phase
 *      polished entry, when we play it back as a confirmation).
 *
 * Same wire format on the audio side as the realtime pipeline: PCM16
 * LE mono at the provider's native rate. The audio-io layer
 * resamples to whatever the endpoint declared in its capabilities.
 */

export type TtsSessionConfig = {
  /** Provider-specific voice identifier. E.g. Aura's
   *  `aura-asteria-en`, ElevenLabs `Rachel`. Empty = provider default. */
  voice?: string;
  /** Optional model override. */
  model?: string;
  /** Sample rate the provider should emit (Hz). Common values:
   *  16000 for narrow telephony, 24000 for the puck's speaker chain
   *  (matches our realtime pipeline), 48000 for browser playback. */
  sampleRateHz: number;
};

/** Events the session emits towards the orchestrator. Providers
 *  translate their native event streams into these. */
export type TtsEvent =
  /** A chunk of PCM16 LE mono audio at `config.sampleRateHz`. The
   *  orchestrator forwards directly to the audio-io connection. */
  | { type: "audio"; pcm: Buffer }
  /** Provider signalled the end of a flush boundary or an utterance.
   *  After this the orchestrator can hand off to the next phase
   *  (e.g. await user mic again). */
  | { type: "utterance_end" }
  /** Recoverable error. */
  | { type: "error"; message: string }
  /** Underlying transport closed. No more events arrive. */
  | { type: "closed" };

export type TtsEventHandler = (event: TtsEvent) => void;

export interface TtsSession {
  /** Push a text chunk to be spoken. Provider may begin streaming
   *  audio back as soon as it has a phrase. */
  speak(text: string): void;
  /** Tell the provider to flush whatever's pending — emits
   *  `utterance_end` when the audio for everything pushed so far
   *  has been delivered. Useful when the orchestrator wants to wait
   *  for "the model finished its turn, the audio finished playing,
   *  now I can listen again." */
  flush(): void;
  /** Close the session cleanly. After this no more `audio` events
   *  arrive. Resolves after `closed` has been emitted. */
  finish(): Promise<void>;
  /** Tear down immediately — no flush. Idempotent. */
  close(): void;
  /** Subscribe to provider events. Multiple subscribers are fine. */
  on(handler: TtsEventHandler): void;
}

export interface TtsProvider {
  /** Stable provider name. Used in logs + voice editor picker. */
  readonly name: string;
  /** Open a streaming session. Throws if credentials are missing or
   *  the upstream rejects the handshake. */
  open(config: TtsSessionConfig): Promise<TtsSession>;
}
