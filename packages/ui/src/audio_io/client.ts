/**
 * Audio I/O client — thin orchestrator (M21 step 4).
 *
 * Was a monolithic Web Audio program at this path. The capture +
 * playback + storage + WS + appInfo plumbing all moved behind
 * `../platform/`; this file now wires them together and owns the WS
 * lifecycle. Same surface (`BrowserAudioIoClient`, statuses,
 * BrowserClientEvent) so consumers (TalkButton + future RN
 * TalkButton) keep working unchanged.
 *
 * Mic path: platform/audioCapture → onFrame(Int16) → WS binary frame.
 * Speaker path: WS binary frame → Int16 → platform/audioPlayback.
 *
 * Hello capabilities: mic.sample_rate_hz reads from the capture's
 * negotiated rate post-start (web AudioContext: ~48 kHz; iOS audio-api:
 * whatever the bridge gives us). Speaker locked to 24 kHz to match
 * upstream provider native rate.
 *
 * Lifecycle:
 *   start()  → WS open + permissions + capture/playback start +
 *              hello + wait for ready
 *   stop()   → close WS + stop capture/playback
 *   onEvent  → consumer subscribes to daemon→client text events
 *
 * Device-id persistence moved to `storage` (platform). Browser tabs
 * still get a per-tab UUID under `voix.browser_device_id`; native
 * gets one under the same key in AsyncStorage.
 */

import {
  PROTOCOL_VERSION,
  type AudioIoHello,
  type Capabilities,
} from "@voix/protocol";
import {
  appInfo,
  createAudioCapture,
  createAudioPlayback,
  permissions,
  PlatformWebSocket,
  storage,
  type AudioCapture,
  type AudioPlayback,
} from "../platform";

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
/** Speaker rate the daemon ships at today (OpenAI Realtime + Aura).
 *  Declaring it matches the legacy client.ts:194 — daemon won't
 *  resample on the hot path; the local AudioContext (or RN bridge)
 *  is responsible. */
const SPEAKER_SAMPLE_RATE_HZ = 24000;
/** Mic capture buffer. 2048 @ 48 kHz ≈ 43 ms — comfortable on WS,
 *  inside protocol spec §4's 20-100 ms budget. */
const MIC_BUFFER_SIZE = 2048;

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = `browser-${generateUuid()}`;
  await storage.setItem(DEVICE_ID_KEY, fresh);
  return fresh;
}

export class BrowserAudioIoClient {
  private ws: WebSocket | null = null;
  private capture: AudioCapture | null = null;
  private playback: AudioPlayback | null = null;
  private status: BrowserClientStatus = "idle";

  constructor(private readonly opts: BrowserClientOpts) {}

  async start(): Promise<void> {
    if (this.status !== "idle") return;
    this.setStatus("connecting");
    try {
      // Permission gate first (Decision 4 order: permission → session
      // setup → mic start). Web's permissions impl is a no-op (the
      // browser-chrome dialog fires inside getUserMedia later);
      // native (iOS) prompts via AudioManager.
      const perm = await permissions.requestMicrophone();
      if (!perm.ok) {
        this.opts.onEvent({
          type: "error",
          message: `microphone permission ${perm.reason}${perm.detail ? `: ${perm.detail}` : ""}`,
        });
        this.stop();
        return;
      }

      this.playback = createAudioPlayback();
      await this.playback.start({ sampleRateHz: SPEAKER_SAMPLE_RATE_HZ });

      this.capture = createAudioCapture();
      // Web's audioContext picks its own rate; the rate we pass here
      // is honoured by native bridges and informational on web.
      await this.capture.start({
        sampleRateHz: 48000,
        bufferSize: MIC_BUFFER_SIZE,
        onFrame: (pcm16) => this.sendMicFrame(pcm16),
        // Surface async recorder failures (e.g. iOS AVAudioSession
        // interruption, hardware revoked mid-session) to the consumer
        // so the TalkButton can render a real message rather than
        // sitting on "Listening" forever (Sasha H2).
        onError: (err) => {
          this.opts.onEvent({ type: "error", message: err.message });
          this.stop();
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
    // Quirk preservation: closing WS during connect can hang on some
    // iOS versions — try/catch was at client.ts:138-141 originally.
    try {
      this.ws?.close();
    } catch {
      // best-effort
    }
    this.ws = null;
    this.capture?.stop();
    this.capture = null;
    this.playback?.stop();
    this.playback = null;
    this.setStatus("idle");
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async openWs(): Promise<void> {
    const base = await appInfo.getApiBase();
    const url = appInfo.getWsUrl(base);
    const ws = new PlatformWebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.addEventListener("open", () => {
      void this.sendHello();
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

  private async sendHello(): Promise<void> {
    if (!this.capture || !this.ws) return;
    const micRate = this.capture.sampleRate ?? 48000;
    const friendlyName = await appInfo.getFriendlyName();
    const deviceId = await getOrCreateDeviceId();
    const capabilities: Capabilities = {
      mic: { sample_rate_hz: micRate, channels: 1 },
      // Speaker is locked to 24 kHz to match the upstream provider's
      // native rate (OpenAI Realtime + Aura both ship 24 kHz PCM16).
      // The daemon resamples to whatever we declare; declaring 24 kHz
      // lets us avoid the extra hot-path resample and play exactly
      // what the model produced — pitch-correct.
      speaker: { sample_rate_hz: SPEAKER_SAMPLE_RATE_HZ },
      // getUserMedia's echoCancellation gives us hardware-ish AEC on
      // browser; iOS's playAndRecord category + AVAudioSession AEC
      // gives us the same on native. Daemon skips its software gate.
      half_duplex_on_chip: true,
    };
    const hello: AudioIoHello = {
      type: "hello",
      protocol_version: PROTOCOL_VERSION,
      token: this.opts.wsToken,
      device_id: deviceId,
      intent: this.opts.intent ?? "discuss",
      voice_id: this.opts.voiceId,
      capabilities,
      client_info: {
        kind: appInfo.clientKind,
        version: "0.1.0",
        friendly_name: friendlyName,
      },
    };
    this.ws.send(JSON.stringify(hello));
  }

  private sendMicFrame(pcm16: Int16Array): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    // ArrayBufferLike → ArrayBuffer cast under TS5.x strict-DOM lib
    // (used when packages/ui is traversed via the RN-CLI app's
    // tsconfig). The runtime payload is always a fresh
    // non-shared buffer.
    this.ws.send(pcm16.buffer as ArrayBuffer);
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
        this.setStatus("listening");
      } else if (parsed.type === "decline") {
        this.opts.onEvent({
          type: "error",
          message: `declined: ${String(parsed.reason)}${parsed.detail ? ` — ${parsed.detail}` : ""}`,
        });
      } else if (parsed.type === "audio_start") {
        this.setStatus("speaking");
      } else if (parsed.type === "audio_end") {
        this.setStatus("listening");
      }
      this.opts.onEvent({ type: "daemon", event: parsed });
      return;
    }
    // Binary frame — speaker PCM.
    if (ev.data instanceof ArrayBuffer) {
      this.playback?.pushFrame(new Int16Array(ev.data));
    }
  }

  private setStatus(next: BrowserClientStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.opts.onEvent({ type: "status", status: next });
  }
}
