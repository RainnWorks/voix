/**
 * Audio capture — RN impl (Software Mansion react-native-audio-api).
 *
 * iOS-only on M21. macOS throws "implement in M22" — the audio-api
 * podspec is iOS-only (Decision 2) and shipping a no-op on macOS
 * would silently break TalkButton there.
 *
 * Audio graph: AudioContext (audio-api) → AudioRecorder.onAudioReady
 * gives us Float32 PCM at the requested rate; we convert to Int16
 * and forward via onFrame. The `audio-api` AudioContext owns the
 * iOS AVAudioSession; setting category to "playAndRecord" with
 * defaultToSpeaker + Bluetooth HFP per Decision 4.
 *
 * iOS permission gate: `AudioManager.requestRecordingPermissions()`
 * — fires the `NSMicrophoneUsageDescription` dialog the first time;
 * subsequent calls return Granted / Denied / Undetermined. The
 * `permissions.native.ts` shim calls into this same method so the
 * orchestrator's permission gate is honoured before audio nodes
 * touch the mic.
 *
 * Why AudioRecorder + RecorderAdapterNode pattern over a plain
 * createMediaStreamSource: audio-api doesn't expose a
 * MediaStream-equivalent. The Recorder hands raw PCM via
 * onAudioReady; the adapter is only needed if you want to route the
 * mic through the graph (we don't — daemon does VAD/AEC). Cleanest
 * mic-to-ws shim is `recorder.onAudioReady(...)` with no adapter
 * connected.
 */

import { Platform } from "react-native";
import {
  AudioBuffer,
  AudioContext,
  AudioManager,
  AudioRecorder,
} from "react-native-audio-api";
import type { AudioCapture, AudioCaptureStartOpts } from "./types";

/** Inlined to dodge the missing top-level re-export in
 *  react-native-audio-api 0.12.2. Mirrors the lib's
 *  `events/types.ts::OnAudioReadyEventType`. */
type AudioReadyEvent = {
  buffer: AudioBuffer;
  numFrames: number;
  when: number;
};

/** Float32 [-1.0, 1.0] → Int16 PCM. Same helper the web impl uses;
 *  duplicated here to keep each impl's import graph minimal. */
function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

class IosAudioCapture implements AudioCapture {
  private audioContext: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private negotiatedSampleRate: number | undefined;
  private started = false;

  get sampleRate(): number | undefined {
    return this.negotiatedSampleRate;
  }

  async start(opts: AudioCaptureStartOpts): Promise<void> {
    if (this.started) return;
    this.started = true;

    // AVAudioSession config — Decision 4 order: permission gate is in
    // permissions.native.ts (called by the orchestrator); here we just
    // configure the session for playAndRecord and activate it. The
    // configuration must be set BEFORE creating the AudioContext to
    // avoid the M22-recovered "audio session in wrong category" race.
    AudioManager.setAudioSessionOptions({
      iosCategory: "playAndRecord",
      iosMode: "voiceChat",
      iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
    });
    await AudioManager.setAudioSessionActivity(true);

    // AudioContext with the caller's preferred rate. audio-api accepts
    // 8 kHz - 96 kHz; if the device prefers something else it'll be
    // honoured by the recorder anyway. Track the actual rate we
    // negotiated so `sampleRate` reads truthfully.
    this.audioContext = new AudioContext({ sampleRate: opts.sampleRateHz });
    this.negotiatedSampleRate = this.audioContext.sampleRate;

    // Set up the recorder. onAudioReady fires with Float32 chunks of
    // approximately `bufferLength` frames at `sampleRate` Hz. The
    // exact values may vary per the docs; we honour what's delivered.
    this.recorder = new AudioRecorder();
    this.recorder.onAudioReady(
      {
        sampleRate: opts.sampleRateHz,
        bufferLength: opts.bufferSize,
        channelCount: 1,
      },
      (event: AudioReadyEvent) => {
        const channel = event.buffer.getChannelData(0);
        opts.onFrame(floatToPcm16(channel));
      },
    );

    const result = this.recorder.start();
    if (result.status === "error") {
      this.stop();
      throw new Error(`AudioRecorder start failed: ${result.message}`);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    try {
      this.recorder?.clearOnAudioReady();
      this.recorder?.stop();
    } catch {
      // best-effort
    }
    this.recorder = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.negotiatedSampleRate = undefined;
  }
}

class MacosAudioCaptureStub implements AudioCapture {
  get sampleRate(): number | undefined {
    return undefined;
  }
  async start(_opts: AudioCaptureStartOpts): Promise<void> {
    throw new Error(
      "audio capture: macOS audio lands in M22 (alongside global hotkey + paste)",
    );
  }
  stop(): void {
    // no-op
  }
}

export function createAudioCapture(): AudioCapture {
  return Platform.OS === "macos" ? new MacosAudioCaptureStub() : new IosAudioCapture();
}
