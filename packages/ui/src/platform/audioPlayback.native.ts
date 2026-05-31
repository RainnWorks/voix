/**
 * Audio playback — RN impl (Software Mansion react-native-audio-api).
 *
 * iOS-only on M21; macOS throws (Decision 2). For iOS, the path
 * mirrors the web impl 1:1: createBuffer(1, len, 24000) +
 * createBufferSource + scheduled-startAt gapless queue. audio-api
 * exposes BaseAudioContext.createBuffer / createBufferSource with the
 * same names + semantics as the DOM Web Audio API. The
 * `playbackTime` running watermark keeps consecutive chunks queued
 * end-to-end so model output sounds continuous.
 *
 * Shared AudioContext caveat: capture + playback each own their own
 * AudioContext today (the web impl does too) — separating means the
 * iOS audio session can be in playAndRecord throughout the session.
 * If route-change events surface mid-session and require a shared
 * context, we'll fold them together in M22.
 */

import { NativeModules, Platform } from "react-native";
import { AudioContext } from "react-native-audio-api";
import type { AudioPlayback, AudioPlaybackStartOpts } from "./types";

function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = (input[i] ?? 0) / 0x8000;
  }
  return out;
}

class IosAudioPlayback implements AudioPlayback {
  private audioContext: AudioContext | null = null;
  private playbackTime = 0;
  private sampleRateHz = 24000;

  async start(opts: AudioPlaybackStartOpts): Promise<void> {
    if (this.audioContext) return;
    this.sampleRateHz = opts.sampleRateHz;
    // Speaker context runs at the device-preferred output rate;
    // we still tag inbound buffers with 24 kHz so the engine resamples
    // to the device rate on the way to the speaker. Same trick the
    // web impl uses — pitch-correct because the BUFFER (not the
    // context) is tagged at the source rate.
    this.audioContext = new AudioContext();
    this.playbackTime = 0;
  }

  pushFrame(pcm16: Int16Array): void {
    const ctx = this.audioContext;
    if (!ctx) return;
    const buf = ctx.createBuffer(1, pcm16.length, this.sampleRateHz);
    const floats = pcm16ToFloat(pcm16);
    buf.copyToChannel(floats, 0, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    node.start(startAt);
    this.playbackTime = startAt + buf.duration;
  }

  stop(): void {
    void this.audioContext?.close();
    this.audioContext = null;
    this.playbackTime = 0;
  }
}

/**
 * macOS impl backed by VoixAudioPlayback (AVAudioEngine + AVAudioPlayerNode).
 * The native side schedules each pushFrame buffer at the running
 * `nextPlayerSampleTime` watermark so consecutive chunks play gapless
 * even if the JS round-trip has jitter.
 *
 * Encoding: we base64-encode the Int16Array's little-endian bytes
 * before crossing the bridge. RN's NativeModules don't accept raw
 * TypedArrays across the bridge in 0.81; base64 is the documented path
 * (same shape react-native-audio-api uses for its native push).
 */

type VoixAudioPlaybackModule = {
  start(sampleRateHz: number): Promise<void>;
  pushFrame(base64: string): Promise<void>;
  stop(): Promise<void>;
};

/** Int16Array → base64 of its byte representation (LE on Apple
 *  hardware, which is what the Swift side expects). `btoa` is available
 *  in Hermes; we avoid Buffer for the same reason audioCapture.native.ts
 *  does. */
function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  // Chunked to avoid the "Maximum call stack" hit on very large arrays.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  // eslint-disable-next-line no-restricted-globals
  const enc = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (!enc) {
    throw new Error(
      "btoa unavailable in RN runtime — VoixAudioPlayback frame encode failed",
    );
  }
  return enc(bin);
}

class MacosAudioPlayback implements AudioPlayback {
  private started = false;

  async start(opts: AudioPlaybackStartOpts): Promise<void> {
    if (this.started) return;
    const mod = NativeModules.VoixAudioPlayback as VoixAudioPlaybackModule | undefined;
    if (!mod) {
      throw new Error(
        "VoixAudioPlayback native module unavailable — rebuild the macOS app",
      );
    }
    await mod.start(opts.sampleRateHz);
    this.started = true;
  }

  pushFrame(pcm16: Int16Array): void {
    if (!this.started) return;
    const mod = NativeModules.VoixAudioPlayback as VoixAudioPlaybackModule | undefined;
    if (!mod) return;
    // Fire-and-forget — pushFrame's interface is sync; the native side
    // resolves immediately after scheduling.
    const b64 = int16ToBase64(pcm16);
    void mod.pushFrame(b64).catch(() => {
      // best-effort — a single dropped frame is recoverable.
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    const mod = NativeModules.VoixAudioPlayback as VoixAudioPlaybackModule | undefined;
    void mod?.stop().catch(() => {
      // best-effort
    });
  }
}

export function createAudioPlayback(): AudioPlayback {
  return Platform.OS === "macos" ? new MacosAudioPlayback() : new IosAudioPlayback();
}
