/**
 * Deepgram streaming STT provider.
 *
 * Wire: WebSocket to `wss://api.deepgram.com/v1/listen?...`. Auth via
 * the `Token <key>` `Authorization` header on the upgrade. We send
 * raw PCM16 LE as binary frames; Deepgram returns JSON events on
 * text frames.
 *
 * Why Deepgram for the cheap-discuss + dictate path:
 *   - Low first-byte latency (typically 100-300 ms for partials).
 *   - Cheap (sub-cent per minute on streaming today).
 *   - Server-side endpointing is solid; we still run our own VAD
 *     for orchestration but Deepgram's `speech_final` is a useful
 *     second signal.
 *
 * The constructor takes a `wsFactory` rather than hard-coding `ws`
 * so tests can substitute a stub WS without going near the network.
 * Production callers use `createDeepgramProvider()` which wires the
 * default factory.
 */

import type { ClientOptions, WebSocket as WSWebSocket } from "ws";
import { log } from "../../../log.ts";
import type {
  SttEvent,
  SttEventHandler,
  SttProvider,
  SttSession,
  SttSessionConfig,
} from "./types.ts";

/** Minimal WS surface the Deepgram session needs. Lets tests stub
 *  with a fake; production wires the `ws` package. */
export type DeepgramWSLike = {
  readyState: number;
  send(data: ArrayBufferView | ArrayBuffer | string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: ArrayBuffer | Buffer | string) => void): unknown;
  on(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
};

export type DeepgramWSFactory = (url: string, opts: ClientOptions) => DeepgramWSLike;

const DEEPGRAM_BASE = "wss://api.deepgram.com/v1/listen";

/** Build the URL query Deepgram needs to know how to interpret what
 *  we're streaming. PCM16 LE @ sample_rate, mono, with interim results
 *  + smart formatting. */
function buildDeepgramUrl(config: SttSessionConfig): string {
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: String(config.sampleRateHz),
    channels: "1",
    interim_results: String(config.interim),
    smart_format: "true",
    model: config.model || "nova-3",
  });
  if (config.language) params.set("language", config.language);
  return `${DEEPGRAM_BASE}?${params.toString()}`;
}

/**
 * Parse one Deepgram WS message. Returns the SttEvents derived from
 * it (zero or more). Exported for the unit test so we can verify the
 * mapping against captured payload fixtures without spinning up a WS.
 *
 * Deepgram payload shape (the bits we read):
 *   {
 *     type: "Results",
 *     is_final: boolean,
 *     speech_final: boolean,
 *     channel: { alternatives: [{ transcript: string }] }
 *   }
 * Plus: { type: "Metadata", ... } at session start (ignored),
 *       { type: "SpeechStarted", ... } when their VAD fires (ignored —
 *       we use our own VAD), { type: "UtteranceEnd", ... } at gap
 *       boundary (ignored), error envelopes on auth/server problems.
 */
export function parseDeepgramMessage(raw: string): SttEvent[] {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch (err) {
    return [
      {
        type: "error",
        message: `deepgram: malformed JSON message: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    ];
  }
  if (!envelope || typeof envelope !== "object") return [];
  const env = envelope as Record<string, unknown>;
  if (env["type"] === "Results") {
    const channel = env["channel"] as { alternatives?: Array<{ transcript?: string }> } | undefined;
    const transcript = channel?.alternatives?.[0]?.transcript ?? "";
    const isFinal = env["is_final"] === true;
    const speechFinal = env["speech_final"] === true;
    if (!transcript) return [];
    if (isFinal) {
      return [{ type: "final", text: transcript, isEndpoint: speechFinal }];
    }
    return [{ type: "partial", text: transcript }];
  }
  // Plain string error payloads or { error: "..." } envelopes.
  if (typeof env["error"] === "string") {
    return [{ type: "error", message: env["error"] as string }];
  }
  return [];
}

class DeepgramSession implements SttSession {
  private handlers: SttEventHandler[] = [];
  private opened = false;
  private closed = false;
  private pendingAudio: Buffer[] = [];
  /** Resolves on the first `closed` event the impl emits — used by
   *  `finish()` to await Deepgram's flush. */
  private closedSignal: Promise<void>;
  private closedResolve!: () => void;

  constructor(private readonly ws: DeepgramWSLike) {
    this.closedSignal = new Promise((res) => {
      this.closedResolve = res;
    });
    this.ws.on("open", () => {
      this.opened = true;
      // Replay anything queued during the handshake.
      for (const chunk of this.pendingAudio) this.rawSend(chunk);
      this.pendingAudio = [];
    });
    this.ws.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      const events = parseDeepgramMessage(text);
      for (const ev of events) this.emit(ev);
    });
    this.ws.on("close", (code) => {
      log.info(`deepgram: ws closed code=${code}`);
      this.emit({ type: "closed" });
      this.closedResolve();
    });
    this.ws.on("error", (err) => {
      log.warn("deepgram: ws error", err);
      this.emit({ type: "error", message: err.message });
    });
  }

  sendAudio(pcm: Buffer): void {
    if (this.closed || pcm.length === 0) return;
    if (!this.opened) {
      // Buffer until the handshake completes; the open handler
      // drains. Bounded — keep at most ~5 seconds of 16 kHz mono
      // PCM16 (160 KB) to avoid pinning memory if Deepgram never
      // opens. After that, drop.
      const totalBuffered = this.pendingAudio.reduce((a, c) => a + c.length, 0);
      if (totalBuffered > 160 * 1024) return;
      this.pendingAudio.push(Buffer.from(pcm));
      return;
    }
    this.rawSend(pcm);
  }

  async finish(): Promise<void> {
    if (this.closed) return;
    // Deepgram's documented end-of-stream signal is an empty binary
    // frame OR a text frame `{ "type": "CloseStream" }`. Empty binary
    // is more permissive across SDK versions.
    try {
      this.rawSend(Buffer.alloc(0));
    } catch (e) {
      log.debug("deepgram: empty-frame finish send failed", e);
    }
    await this.closedSignal;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(1000, "session closed");
    } catch (e) {
      log.debug("deepgram: close threw", e);
    }
  }

  on(handler: SttEventHandler): void {
    this.handlers.push(handler);
  }

  private rawSend(data: Buffer): void {
    if (this.closed) return;
    try {
      this.ws.send(data);
    } catch (e) {
      log.debug("deepgram: send failed", e);
    }
  }

  private emit(event: SttEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        log.warn("deepgram: handler threw", err);
      }
    }
  }
}

export class DeepgramProvider implements SttProvider {
  readonly name = "deepgram";

  constructor(
    private readonly apiKey: string,
    private readonly wsFactory: DeepgramWSFactory,
  ) {}

  async open(config: SttSessionConfig): Promise<SttSession> {
    if (!this.apiKey) {
      throw new Error("deepgram: missing apiKey (set DEEPGRAM_API_KEY)");
    }
    const url = buildDeepgramUrl(config);
    const ws = this.wsFactory(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    return new DeepgramSession(ws);
  }
}

/** Production factory: wires the `ws` npm package. Lazy-imported so
 *  tests that exercise only the parser + session machinery don't pull
 *  ws in. */
export async function createDeepgramProvider(apiKey: string): Promise<DeepgramProvider> {
  const ws = await import("ws");
  const factory: DeepgramWSFactory = (url, opts) =>
    new ws.WebSocket(url, opts) as unknown as DeepgramWSLike;
  return new DeepgramProvider(apiKey, factory);
}

/** Re-export the `WSWebSocket` type so callers that hold a session
 *  can talk in `ws` types without importing the package directly. */
export type { WSWebSocket };
