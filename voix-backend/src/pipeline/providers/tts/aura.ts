/**
 * Deepgram Aura streaming TTS provider.
 *
 * Wire: WebSocket to `wss://api.deepgram.com/v1/speak?...`. Auth via
 * the `Token <key>` `Authorization` header on the upgrade. We send
 * text chunks as JSON text frames (`{"type":"Speak","text":"..."}`),
 * Aura returns audio binary frames + JSON control envelopes
 * (Metadata, Flushed, Warning, etc.).
 *
 * Why Aura for the traditional discuss path:
 *   - Naturalistic voices that feel less robotic than older TTS.
 *   - Streaming output keeps perceived latency low.
 *   - Aura-Asteria-EN ≈ $0.025 / minute, in line with the other
 *     "cheap traditional" providers.
 *
 * Same injectable-factory pattern as the Deepgram STT impl — tests
 * substitute a stub WS so we don't need the network OR a real key
 * to exercise the session machinery.
 */

import type { ClientOptions } from "ws";
import { log } from "../../../log.ts";
import type {
  TtsEvent,
  TtsEventHandler,
  TtsProvider,
  TtsSession,
  TtsSessionConfig,
} from "./types.ts";

/** Minimal WS surface the Aura session needs. Same as the Deepgram
 *  STT shape; both wrap node `ws` in production. */
export type AuraWSLike = {
  readyState: number;
  send(data: ArrayBufferView | ArrayBuffer | string): void;
  close(code?: number, reason?: string): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: ArrayBuffer | Buffer | string) => void): unknown;
  on(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
};

export type AuraWSFactory = (url: string, opts: ClientOptions) => AuraWSLike;

const AURA_BASE = "wss://api.deepgram.com/v1/speak";

/** Build the query string Aura needs. The endpoint returns PCM at the
 *  requested rate; we always ask for `linear16` so the orchestrator
 *  has the daemon's house format. */
function buildAuraUrl(config: TtsSessionConfig): string {
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: String(config.sampleRateHz),
    container: "none", // raw PCM, no WAV header per chunk
    model: config.voice || config.model || "aura-asteria-en",
  });
  return `${AURA_BASE}?${params.toString()}`;
}

/**
 * Parse one Aura WS text/binary message into the TtsEvents derived
 * from it. Binary frames are raw audio chunks; text frames are
 * control envelopes (Metadata, Flushed, Warning, ...).
 *
 * Exported for unit testing — same shape as Deepgram's STT parser
 * so the test approach is symmetric.
 */
export function parseAuraMessage(raw: string | Buffer): TtsEvent[] {
  // TS narrowing via `raw instanceof Buffer` doesn't refine the union
  // (Buffer<ArrayBufferLike> generic mismatch on some toolchains), so
  // we test + early-return without relying on narrowing.
  if (typeof raw !== "string") {
    return raw.length > 0 ? [{ type: "audio", pcm: raw }] : [];
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch (err) {
    return [
      {
        type: "error",
        message: `aura: malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  if (!envelope || typeof envelope !== "object") return [];
  const env = envelope as Record<string, unknown>;
  const t = env["type"];
  if (t === "Flushed") return [{ type: "utterance_end" }];
  if (t === "Warning" || t === "Metadata") return []; // diagnostic-only, log noise
  if (typeof env["error"] === "string") {
    return [{ type: "error", message: env["error"] as string }];
  }
  return [];
}

class AuraSession implements TtsSession {
  private handlers: TtsEventHandler[] = [];
  private opened = false;
  private closed = false;
  /** Text frames sent during the handshake are queued + replayed on
   *  open. Same race condition we handle on the STT side. */
  private pendingText: string[] = [];
  private closedSignal: Promise<void>;
  private closedResolve!: () => void;

  constructor(private readonly ws: AuraWSLike) {
    this.closedSignal = new Promise((res) => {
      this.closedResolve = res;
    });
    this.ws.on("open", () => {
      this.opened = true;
      for (const text of this.pendingText) this.rawSendText(text);
      this.pendingText = [];
    });
    this.ws.on("message", (data) => {
      const events = parseAuraMessage(
        typeof data === "string"
          ? data
          : data instanceof Buffer
            ? data
            : Buffer.from(data as ArrayBuffer),
      );
      for (const ev of events) this.emit(ev);
    });
    this.ws.on("close", (code) => {
      log.info(`aura: ws closed code=${code}`);
      this.emit({ type: "closed" });
      this.closedResolve();
    });
    this.ws.on("error", (err) => {
      log.warn("aura: ws error", err);
      this.emit({ type: "error", message: err.message });
    });
  }

  speak(text: string): void {
    if (this.closed) return;
    const trimmed = text;
    if (!trimmed) return;
    const frame = JSON.stringify({ type: "Speak", text: trimmed });
    if (!this.opened) {
      // Cap the pre-open queue at ~50 KB of text — well above any
      // realistic LLM stream chunk pile-up during a 200 ms handshake.
      const totalBuffered = this.pendingText.reduce((a, c) => a + c.length, 0);
      if (totalBuffered > 50 * 1024) return;
      this.pendingText.push(frame);
      return;
    }
    this.rawSendText(frame);
  }

  flush(): void {
    if (this.closed) return;
    const frame = JSON.stringify({ type: "Flush" });
    if (!this.opened) {
      this.pendingText.push(frame);
      return;
    }
    this.rawSendText(frame);
  }

  async finish(): Promise<void> {
    if (this.closed) return;
    try {
      this.rawSendText(JSON.stringify({ type: "Close" }));
    } catch (e) {
      log.debug("aura: close-frame send failed", e);
    }
    await this.closedSignal;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(1000, "session closed");
    } catch (e) {
      log.debug("aura: close threw", e);
    }
  }

  on(handler: TtsEventHandler): void {
    this.handlers.push(handler);
  }

  private rawSendText(frame: string): void {
    if (this.closed) return;
    try {
      this.ws.send(frame);
    } catch (e) {
      log.debug("aura: send failed", e);
    }
  }

  private emit(event: TtsEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        log.warn("aura: handler threw", err);
      }
    }
  }
}

export class AuraProvider implements TtsProvider {
  readonly name = "aura";

  constructor(
    private readonly apiKey: string,
    private readonly wsFactory: AuraWSFactory,
  ) {}

  async open(config: TtsSessionConfig): Promise<TtsSession> {
    if (!this.apiKey) {
      throw new Error("aura: missing apiKey (set DEEPGRAM_API_KEY)");
    }
    const url = buildAuraUrl(config);
    const ws = this.wsFactory(url, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    return new AuraSession(ws);
  }
}

/** Production factory: wires the `ws` npm package. Lazy-imported so
 *  parser tests don't pull `ws` into the module graph. */
export async function createAuraProvider(apiKey: string): Promise<AuraProvider> {
  const ws = await import("ws");
  const factory: AuraWSFactory = (url, opts) =>
    new ws.WebSocket(url, opts) as unknown as AuraWSLike;
  return new AuraProvider(apiKey, factory);
}
