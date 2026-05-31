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

    // Sasha H1 fix: pin the recorder's sample rate at the device's
    // preferred rate so the hello capability declares what the recorder
    // *actually* delivers. The caller's opts.sampleRateHz is informational
    // only — Bluetooth HFP forces 16 kHz, sim coreaudio may differ, etc.
    // getDevicePreferredSampleRate() returns whatever AVAudioSession is
    // currently routed to; using that as a single source of truth means
    // hello.mic.sample_rate_hz === the rate of every frame we emit.
    //
    // audio-api docs:
    // https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager
    const deviceRate = AudioManager.getDevicePreferredSampleRate();

    // AudioContext locked at the device rate so any future graph nodes
    // run at the same rate as the recorder. Avoids implicit resampling.
    this.audioContext = new AudioContext({ sampleRate: deviceRate });
    this.negotiatedSampleRate = deviceRate;

    // Set up the recorder at the SAME rate as the AudioContext.
    // audio-api docs note "exact values may vary depending on device
    // capabilities" — but since we asked for the device's own
    // preferred rate, it should honour it exactly.
    this.recorder = new AudioRecorder();
    this.recorder.onAudioReady(
      {
        sampleRate: deviceRate,
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
