/**
 * Browser Audio I/O client (M18).
 *
 * The web UI becomes an Audio I/O endpoint: opens a WS to the daemon's
 * /ws route, sends the v1 capability handshake hello with
 * `client_info.kind = "browser-tab"`, streams mic PCM16 LE up, plays
 * back speaker PCM16 LE down.
 *
 * Mic path:
 *   getUserMedia (Float32) → AudioWorklet/ScriptProcessorNode
 *   → Float32 → Int16 PCM → WS binary frame.
 *
 * We declare the AudioContext's native sample rate (typically 48 kHz)
 * to the daemon's hello capabilities; the daemon resamples to its
 * upstream provider rate. Same on the speaker side.
 *
 * Speaker path:
 *   WS binary frame → Int16 PCM → Float32 → AudioBufferSource →
 *   AudioContext.destination.
 *
 * Lifecycle:
 *   start()  → opens WS + getUserMedia + waits for ready
 *   stop()   → tears down WS + tracks + audio context
 *   onEvent  → consumer subscribes to daemon→client text events
 *              (transcript_delta, transcript, user_speech_*, etc.)
 *
 * Tab-id persistence: a per-browser UUID lives in localStorage under
 * `voix.browser_device_id` so the same tab gets the same Surfaces
 * row across refreshes. Generated lazily on first start().
 */

export type BrowserClientEvent =
  | { type: "status"; status: BrowserClientStatus }
  | { type: "daemon"; event: Record<string, unknown> }
  | { type: "error"; message: string };

export type BrowserClientStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "speaking"
  | "listening"
  | "closing";

export type BrowserClientOpts = {
  voiceId?: string;
  intent?: "dictate" | "discuss";
  wsToken: string;
  onEvent: (ev: BrowserClientEvent) => void;
};

const DEVICE_ID_KEY = "voix.browser_device_id";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for ancient browsers.
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = `browser-${generateUuid()}`;
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return `browser-${generateUuid()}`;
  }
}

/** Build the WS URL relative to the document's current location so
 *  the HA ingress prefix (if any) survives. The same trick the api
 *  client uses for fetch paths. */
function wsUrlFromDocument(): string {
  if (typeof window === "undefined") return "ws://localhost:8765/ws";
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  // strip trailing slash, then append `/ws`
  const path = loc.pathname.replace(/\/$/, "");
  return `${protocol}//${loc.host}${path}/ws`;
}

/** Float32 [-1.0, 1.0] → Int16 PCM. Standard linear scale + clamp. */
function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Int16 PCM → Float32 [-1.0, 1.0]. */
function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = (input[i] ?? 0) / 0x8000;
  }
  return out;
}

export class BrowserAudioIoClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private playbackTime = 0; // next scheduled start for incoming audio
  private status: BrowserClientStatus = "idle";

  constructor(private readonly opts: BrowserClientOpts) {}

  async start(): Promise<void> {
    if (this.status !== "idle") return;
    this.setStatus("connecting");
    try {
      this.audioContext = new AudioContext();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.openWs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.onEvent({ type: "error", message: msg });
      this.stop();
    }
  }

  stop(): void {
    if (this.status === "idle") return;
    this.setStatus("closing");
    try {
      this.ws?.close();
    } catch {
      // best-effort
    }
    this.scriptNode?.disconnect();
    this.scriptNode = null;
    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    this.mediaStream = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.playbackTime = 0;
    this.setStatus("idle");
  }

  // ─── Internals ────────────────────────────────────────────────────

  private openWs(): void {
    const url = wsUrlFromDocument();
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.sendHello();
    });
    ws.addEventListener("message", (ev) => this.handleMessage(ev));
    ws.addEventListener("close", () => {
      // Daemon closed (decline, idle timeout, etc.). Tear down audio.
      this.stop();
    });
    ws.addEventListener("error", () => {
      this.opts.onEvent({ type: "error", message: "WebSocket error" });
    });
  }

  private sendHello(): void {
    if (!this.audioContext || !this.ws) return;
    const micRate = this.audioContext.sampleRate;
    const hello = {
      type: "hello",
      protocol_version: 1,
      token: this.opts.wsToken,
      device_id: getOrCreateDeviceId(),
      intent: this.opts.intent ?? "discuss",
      voice_id: this.opts.voiceId,
      capabilities: {
        mic: { sample_rate_hz: micRate, channels: 1 },
        // Speaker is locked to 24 kHz to match the upstream provider's
        // native rate (OpenAI Realtime + Aura both ship 24 kHz PCM16).
        // The daemon side now resamples speaker frames to whatever we
        // declare (B1 fix), but declaring 24 kHz lets us avoid the
        // extra resample on the daemon's hot path and play exactly
        // what the model produced — pitch-correct.
        speaker: { sample_rate_hz: 24000 },
        // getUserMedia's echoCancellation gives us hardware-ish AEC
        // on the browser side; daemon skips its software gate.
        half_duplex_on_chip: true,
      },
      client_info: {
        kind: "browser-tab",
        version: "0.1.0",
        friendly_name: typeof document !== "undefined" ? document.title : "browser",
      },
    };
    this.ws.send(JSON.stringify(hello));
  }

  private handleMessage(ev: MessageEvent): void {
    if (typeof ev.data === "string") {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (parsed.type === "ready") {
        this.setStatus("ready");
        this.startMicPump();
      } else if (parsed.type === "decline") {
        this.opts.onEvent({
          type: "error",
          message: `declined: ${String(parsed.reason)}${parsed.detail ? ` — ${parsed.detail}` : ""}`,
        });
      }
      this.opts.onEvent({ type: "daemon", event: parsed });
      return;
    }
    // Binary frame — speaker PCM.
    if (ev.data instanceof ArrayBuffer) {
      this.playSpeaker(new Int16Array(ev.data));
    }
  }

  /** Connect the mic to a ScriptProcessorNode that batches Float32
   *  samples, converts to Int16, and ships via WS. ScriptProcessor
   *  is deprecated in favour of AudioWorklet but works everywhere
   *  without a separate worklet file; we'll upgrade when we ship
   *  the M18 audit's recommendations. */
  private startMicPump(): void {
    if (!this.audioContext || !this.mediaStream || !this.ws) return;
    const src = this.audioContext.createMediaStreamSource(this.mediaStream);
    // bufferSize 2048 @ 48 kHz ≈ 43 ms per chunk — comfortable for WS.
    const node = this.audioContext.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const ch = e.inputBuffer.getChannelData(0);
      const pcm = floatToPcm16(ch);
      // ArrayBufferLike → ArrayBuffer cast: under TS5.x strict-DOM lib
      // (used when packages/ui is traversed via the RN-CLI app's
      // tsconfig in M20), WebSocket.send rejects ArrayBufferLike. The
      // runtime payload is always a fresh non-shared buffer.
      this.ws.send(pcm.buffer as ArrayBuffer);
    };
    src.connect(node);
    // ScriptProcessor needs to be in the audio graph to fire its
    // onaudioprocess callback, even though we don't want it to make
    // sound. Route to destination via a zero-gain so it ticks
    // without emitting.
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(this.audioContext.destination);
    this.scriptNode = node;
    this.setStatus("listening");
  }

  /** Schedule a chunk of speaker audio to play back on the audio
   *  context. We maintain a running "next scheduled start time" so
   *  consecutive chunks queue end-to-end without gaps. */
  private playSpeaker(pcm: Int16Array): void {
    if (!this.audioContext) return;
    // The hello declares speaker.sample_rate_hz = 24000; the daemon
    // forwards 24 kHz PCM untouched. We tag the buffer at 24 kHz so
    // the AudioContext (typically 48 kHz native) resamples on the
    // way to the output device — pitch-correct.
    const buf = this.audioContext.createBuffer(1, pcm.length, 24000);
    // copyToChannel expects Float32Array<ArrayBuffer>. The helper
    // returns a generic Float32Array; assigning the converted values
    // into the buffer's channel-0 view sidesteps the type narrowing.
    const channel = buf.getChannelData(0);
    const floats = pcm16ToFloat(pcm);
    for (let i = 0; i < floats.length; i++) channel[i] = floats[i] ?? 0;
    const node = this.audioContext.createBufferSource();
    node.buffer = buf;
    node.connect(this.audioContext.destination);
    const now = this.audioContext.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    node.start(startAt);
    this.playbackTime = startAt + buf.duration;
    this.setStatus("speaking");
  }

  private setStatus(next: BrowserClientStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.opts.onEvent({ type: "status", status: next });
  }
}
