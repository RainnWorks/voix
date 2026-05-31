/**
 * Audio playback — web impl.
 *
 * Lifted from `audio_io/client.ts:270-291` (the
 * createBufferSource + scheduled-startAt gapless-queue path).
 *
 * Each chunk arrives as a binary frame from the daemon. We tag the
 * AudioBuffer with the speaker's declared sample rate (24 kHz today —
 * the OpenAI Realtime / Aura native rate). The AudioContext (typically
 * 48 kHz output) resamples on the way to the device — pitch-correct.
 *
 * The running `playbackTime` keeps chunks queued end-to-end so the
 * model's output sounds continuous instead of clicky. Resets on stop().
 */

import type {
  AudioPlayback,
  AudioPlaybackStartOpts,
} from "./types";

/** Int16 PCM → Float32 [-1.0, 1.0]. Lifted from client.ts:97. */
function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = (input[i] ?? 0) / 0x8000;
  }
  return out;
}

class WebAudioPlayback implements AudioPlayback {
  private audioContext: AudioContext | null = null;
  private playbackTime = 0;
  private sampleRateHz = 24000;

  async start(opts: AudioPlaybackStartOpts): Promise<void> {
    if (this.audioContext) return;
    this.sampleRateHz = opts.sampleRateHz;
    this.audioContext = new AudioContext();
    this.playbackTime = 0;
  }

  pushFrame(pcm16: Int16Array): void {
    const ctx = this.audioContext;
    if (!ctx) return;
    const buf = ctx.createBuffer(1, pcm16.length, this.sampleRateHz);
    const channel = buf.getChannelData(0);
    const floats = pcm16ToFloat(pcm16);
    for (let i = 0; i < floats.length; i++) channel[i] = floats[i] ?? 0;
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

export function createAudioPlayback(): AudioPlayback {
  return new WebAudioPlayback();
}
