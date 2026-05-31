/**
 * Platform shim — interface layer (M21 Decision 1).
 *
 * This file is impl-free. It declares the contracts every per-target
 * impl satisfies. Web impls live in `<name>.ts`; native impls live in
 * `<name>.native.ts`. Metro picks the `.native.ts` on iOS / macOS,
 * Vite's `ignoreNativeSuffixes` filters those out of the browser
 * bundle.
 *
 * Why a shared types file: keeps the contract visible at one path so
 * a consumer can read the surface without bouncing between targets.
 * Every impl `import type { ... } from "./types"`.
 *
 * Stable surface, defined here so consumers can `import { AudioCapture,
 * storage, getApiBase } from "@voix/ui/.../platform"` and never see a
 * platform-specific type.
 */

import type { Capabilities, ClientInfo, ClientKind } from "@voix/protocol";

// ─── Audio capture ──────────────────────────────────────────────────

/**
 * One callback per audio chunk pulled from the mic. PCM16 little-endian
 * mono, sample-rate as declared in the start() options. The impl owns
 * Float32→Int16 conversion + buffering; consumers only see Int16 ready
 * to put on the wire.
 */
export type AudioCaptureFrameHandler = (pcm16: Int16Array) => void;

export type AudioCaptureStartOpts = {
  /** Target sample rate. Web impl uses the AudioContext's native rate
   *  (typically 48 kHz on browsers). Native impl honours this value as
   *  the bridge's `sampleRate` option. */
  sampleRateHz: number;
  /** Buffer size in samples. Web maps this to ScriptProcessorNode's
   *  bufferSize; native sets the bridge's read-callback chunk size.
   *  20–43 ms is the sweet spot — see protocol spec §4. */
  bufferSize: number;
  /** Called once per captured chunk, on whatever thread / loop the
   *  impl uses. Consumers MUST be cheap; do not block. */
  onFrame: AudioCaptureFrameHandler;
  /** Surfaced for async failures that arrive after start() resolves —
   *  e.g. native recorder error events on iOS (AVAudioSession
   *  interruption, hardware unavailable). The orchestrator routes
   *  these through its error event. Optional; web impl never fires. */
  onError?: (err: Error) => void;
};

/**
 * Mic abstraction. start() acquires the device + opens the audio
 * graph; stop() releases everything. Re-entry safe: start while
 * already started no-ops; stop while idle no-ops. Concrete impls live
 * in `audioCapture.{ts,native.ts}` and are constructed via
 * `createAudioCapture()` to give the consumer one symbol to import.
 */
export interface AudioCapture {
  /** Acquire the device + start emitting frames via onFrame. */
  start(opts: AudioCaptureStartOpts): Promise<void>;
  /** Release the device + tear down the audio graph. */
  stop(): void;
  /** Latest known sample rate the impl is producing. Read after
   *  start() resolves; undefined until then. */
  readonly sampleRate: number | undefined;
}

// ─── Audio playback ─────────────────────────────────────────────────

export type AudioPlaybackStartOpts = {
  /** Sample rate of the incoming PCM16. Web tags AudioBuffer with this
   *  rate (AudioContext resamples to its native output rate); native
   *  bridge sets the engine input rate to match. */
  sampleRateHz: number;
};

/**
 * Speaker abstraction. The consumer hands the impl a contiguous PCM16
 * little-endian chunk; the impl schedules it gaplessly relative to the
 * last chunk. start() opens the audio graph; pushFrame() queues; stop()
 * tears down and drops any unscheduled chunks.
 */
export interface AudioPlayback {
  /** Open the audio graph; idempotent. */
  start(opts: AudioPlaybackStartOpts): Promise<void>;
  /** Queue PCM16 for gapless playback. Called once per binary frame
   *  from the daemon. Safe to call before start() resolves — impls
   *  may buffer or drop, but MUST NOT throw. */
  pushFrame(pcm16: Int16Array): void;
  /** Tear down. */
  stop(): void;
}

// ─── Storage ────────────────────────────────────────────────────────

/**
 * Promise-shaped key/value store. Web wraps localStorage; native wraps
 * AsyncStorage. Both impls expose the same async surface so consumers
 * don't branch.
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// ─── App info (friendly name + WS / API base) ───────────────────────

/**
 * Where the daemon lives + what to call this endpoint. Web reads from
 * `document.title` + `window.location`; native reads device name and
 * a persisted apiBase.
 *
 * `getApiBase()` is async on both targets — web wraps its sync return
 * in a Promise so consumer code is identical.
 */
export interface AppInfo {
  /** Human-readable name sent in `hello.client_info.friendly_name`. */
  getFriendlyName(): Promise<string>;
  /** Base URL for daemon REST + WS. Web returns "" (relative); native
   *  returns the persisted absolute URL. Trailing slash optional. */
  getApiBase(): Promise<string>;
  /** Override + persist the daemon URL. No-op on web. */
  setApiBase(url: string): Promise<void>;
  /** Build the WS URL from a given base, preserving HA-ingress prefix
   *  on web and stripping http(s) → ws(s) on both. */
  getWsUrl(base: string): string;
  /** ClientInfo.kind to advertise in hello. `"browser-tab"` on web,
   *  `"phone-sat"` on iOS, `"laptop-mic"` on macOS — values from the
   *  protocol's `ClientKind` union. */
  readonly clientKind: ClientKind;
}

// ─── Permissions ────────────────────────────────────────────────────

export type PermissionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "denied" | "restricted" | "undetermined" | "unknown";
      detail?: string;
    };

/**
 * Permission gate before opening the mic. Web returns ok:true without
 * a prompt — getUserMedia handles the browser-level dialog itself.
 * Native (iOS) prompts via AudioManager.requestRecordingPermissions().
 */
export interface Permissions {
  requestMicrophone(): Promise<PermissionResult>;
}

// ─── Inline audio (history playback) ────────────────────────────────

/**
 * Inline audio player for conversation history. The web impl ships a
 * native HTML5 `<audio>` tag; the iOS impl fetches the WAV, decodes,
 * and plays via AudioBufferSource; macOS throws until M22.
 *
 * This is structural — the consumer renders <InlineAudioPlayer src={...}/>
 * and never sees the impl. It's a React component, not a class; so
 * the interface lives in the impl files, not here.
 */

// ─── Hello capabilities (reused across platforms) ───────────────────

/**
 * Convenience type alias surfacing the protocol's `Capabilities` +
 * `ClientInfo` at the platform layer. Lets consumers build a hello
 * without a second @voix/protocol import.
 */
export type HelloCapabilities = Capabilities;
export type HelloClientInfo = ClientInfo;
