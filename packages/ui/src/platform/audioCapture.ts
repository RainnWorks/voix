/**
 * Audio capture — web impl.
 *
 * Lifted from `audio_io/client.ts:115-265` (the getUserMedia +
 * AudioContext + ScriptProcessorNode portion). Behaviour identical:
 *
 *   getUserMedia (Float32) → ScriptProcessorNode (deprecated but
 *   ubiquitous and gives us a 2048-sample buffer trivially) →
 *   Float32 → Int16 PCM → AudioCaptureFrameHandler.
 *
 * The AudioContext is owned by the capture impl; pairs with the
 * playback impl through the orchestrator's lifecycle. Each
 * createAudioCapture() returns a fresh instance — sessions don't
 * share state.
 *
 * AudioWorklet upgrade is the M21 deferred work (Decision 9 §3 risk
 * register's "ScriptProcessorNode debt"). Keeping ScriptProcessor for
 * now is a deliberate continuity choice — moving to Worklet means an
 * extra .js file Vite has to ship and an extra Metro bundler quirk
 * to debug; not the milestone for it.
 */

import type {
  AudioCapture,
  AudioCaptureStartOpts,
} from "./types";

/** Float32 [-1.0, 1.0] → Int16 PCM. Standard linear scale + clamp.
 *  Lifted from client.ts:87. */
function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

class WebAudioCapture implements AudioCapture {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private started = false;

  get sampleRate(): number | undefined {
    return this.audioContext?.sampleRate;
  }

  async start(opts: AudioCaptureStartOpts): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Note: opts.sampleRateHz is informational on web — the browser
    // gives us the AudioContext's native rate (typically 48 kHz) and
    // we declare THAT in the hello. Resampling on the daemon side
    // makes the declared-vs-actual difference safe.
    this.audioContext = new AudioContext();
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const src = this.audioContext.createMediaStreamSource(this.mediaStream);
    // bufferSize: caller's hint. 2048 @ 48 kHz ≈ 43 ms (the legacy
    // default); honour the caller for tunability.
    const node = this.audioContext.createScriptProcessor(opts.bufferSize, 1, 1);
    node.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      opts.onFrame(floatToPcm16(ch));
    };
    src.connect(node);
    // ScriptProcessor needs to be in the audio graph to fire its
    // onaudioprocess callback. Route to a zero-gain so it ticks
    // without emitting sound. (Legacy comment from client.ts:255.)
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(this.audioContext.destination);
    this.scriptNode = node;
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.scriptNode?.disconnect();
    this.scriptNode = null;
    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    this.mediaStream = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }
}

export function createAudioCapture(): AudioCapture {
  return new WebAudioCapture();
}
