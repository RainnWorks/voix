/**
 * Realtime provider interface (M15).
 *
 * Documents the contract a realtime impl satisfies so the orchestrator
 * can swap in alternatives behind the same shape (Gemini Live, Azure
 * Speech, future open-weights realtime models). Today the only impl is
 * `src/realtime/openai.ts`'s `OpenAIRealtimeClient`; this file is the
 * shape we'd target if/when a second realtime provider lands.
 *
 * Design rationale carried over from `realtime/openai.ts`: we DO NOT
 * translate SDK events into a generic union here. The existing
 * client's stated rule — "subscribers reach the typed emitter via
 * `client.rt.on(…)` and get the SDK's exact event type back" — is the
 * right call. A translation layer would just duplicate every
 * provider's type surface for no gain. So the interface below leaves
 * event delivery deliberately under-specified: implementations expose
 * provider-typed events directly on a `.rt` (or equivalent) member,
 * and `RealtimePipeline` knows how to wire each one it cares about.
 *
 * What IS specified here: the lifecycle (connect → updateSession →
 * sendAudio → sendToolResult → close), because the orchestrator + the
 * pipeline share that lifecycle regardless of which provider is in
 * play.
 */

import type { RealtimeFunctionTool } from "openai/resources/realtime/realtime";

/** Session config the orchestrator hands to a provider's `open()`. The
 *  field names mirror `OpenAIRealtimeClient.RealtimeSessionConfig` so
 *  the openai impl can re-export it unchanged. */
export type RealtimeProviderSessionConfig = {
  /** Provider-specific model id. e.g. "gpt-realtime-2" for OpenAI. */
  model: string;
  /** "audio" for bidir voice; "text" for transcription-only (dictation). */
  outputModalities: ["audio"] | ["text"];
  /** System prompt; empty for provider default. */
  instructions: string;
  /** Optional inner-transcription model for audio sessions. */
  transcribeModel?: string;
  /** Optional output voice for audio sessions. */
  voice?: string;
  /** VAD eagerness — "low" patient, "high" eager. */
  vadEagerness?: "low" | "medium" | "high";
  /** Tool specs to register at session start. Today these match the
   *  OpenAI realtime tool shape; a non-OpenAI provider would translate
   *  on its side. */
  tools?: RealtimeFunctionTool[];
};

/**
 * A live realtime session. Lifecycle:
 *
 *   1. provider.open(config)        → returns a session (connected)
 *   2. session.updateSession(patch) → may be called repeatedly
 *   3. session.sendAudio(pcm)       → push mic frames (24 kHz PCM16 LE)
 *   4. session.sendToolResult(...)  → reply to a function_call event
 *   5. session.close()              → tear down
 *
 * Event subscription is provider-specific. Implementations expose
 * their underlying typed emitter on `rt`; consumers (currently
 * `RealtimePipeline`) subscribe to the exact event names they care
 * about. See `src/realtime/openai.ts` for the OpenAI shape.
 */
export interface RealtimeSession {
  updateSession(patch: { instructions?: string; tools?: RealtimeFunctionTool[] }): void;
  sendAudio(pcm24k: Buffer): void;
  sendToolResult(callId: string, output: string): void;
  close(): Promise<void>;
}

export interface RealtimeProvider {
  /** Stable provider name for logs + UI labels. */
  readonly name: string;
  /** Open a streaming realtime session. Throws on auth or handshake
   *  failure. */
  open(config: RealtimeProviderSessionConfig): Promise<RealtimeSession>;
}
