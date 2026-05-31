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

import { Platform } from "react-native";
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

class MacosAudioPlaybackStub implements AudioPlayback {
  async start(_opts: AudioPlaybackStartOpts): Promise<void> {
    throw new Error(
      "audio playback: macOS audio lands in M22 (alongside global hotkey + paste)",
    );
  }
  pushFrame(_pcm16: Int16Array): void {
    // Swallow rather than throw — the orchestrator may push a frame
    // before realising start() threw; throwing twice would surface
    // an opaque second error.
  }
  stop(): void {
    // no-op
  }
}

export function createAudioPlayback(): AudioPlayback {
  return Platform.OS === "macos" ? new MacosAudioPlaybackStub() : new IosAudioPlayback();
}
