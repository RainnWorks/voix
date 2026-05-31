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

import { NativeEventEmitter, NativeModules, Platform } from "react-native";
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
  // M22 step 10: interruption observer (Sasha pushback #1). iOS audio
  // session interruptions (incoming phone call, Siri, route change to
  // an unavailable device) route through opts.onError so the
  // orchestrator surfaces a typed kind: "audio" error in TalkButton.
  private interruptionSubscription: { remove: () => void } | null = null;

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

    // Sasha H2 fix: recorder.start() always returns {status:"success"}
    // in callback-only mode (we don't call enableFileOutput()), so the
    // previous `result.status === "error"` branch was dead code. Use
    // the lib's onError event + an isRecording() poll to surface
    // native-side start failures: AVAudioSession activation failures,
    // hardware unavailable, mic permission revoked between gate and
    // start, etc.
    //
    // audio-api docs (AudioRecorder.onError + isRecording):
    // https://github.com/software-mansion/react-native-audio-api/blob/main/packages/react-native-audio-api/src/core/AudioRecorder.ts
    let nativeError: Error | null = null;
    this.recorder.onError((event) => {
      const err = new Error(`AudioRecorder error: ${event.message}`);
      nativeError = err;
      // Surface to the caller. The orchestrator may have already
      // resolved start(); this is the only signal it gets for failures
      // that fire after start() returned.
      try {
        opts.onError?.(err);
      } catch {
        // best-effort
      }
    });

    // M22 step 10: iOS interruption observer (Sasha pushback #1). The
    // AudioManager's "interruption" event fires when the OS yanks the
    // audio session (phone call, Siri, alarm). We route that through
    // opts.onError so the orchestrator emits a typed kind: "audio"
    // error and TalkButton renders the right recovery copy.
    //
    // We listen for BOTH "began" (the interruption started — current
    // session is dead) and "ended" with shouldResume:false (the
    // interruption ended but the OS won't auto-resume — same outcome).
    AudioManager.observeAudioInterruptions(true);
    this.interruptionSubscription = AudioManager.addSystemEventListener(
      "interruption",
      (event: { type: string; shouldResume: boolean }) => {
        if (event.type === "began") {
          opts.onError?.(
            new Error(
              "audio interrupted — the system took over the mic (call, Siri, alarm).",
            ),
          );
        }
        // We don't auto-restart on "ended" — the orchestrator already
        // tore down on the "began" error and the user can re-press
        // the talk button.
      },
    );

    this.recorder.start();

    // Wait briefly for either an onError event or for isRecording() to
    // flip true. iOS native start is asynchronous despite the JS
    // surface being synchronous; polling at 50 ms ticks up to ~2 s is
    // a pragmatic substitute for the missing "onStart" event.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (nativeError) {
        this.stop();
        throw nativeError;
      }
      if (this.recorder.isRecording()) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (nativeError) {
      this.stop();
      throw nativeError;
    }
    if (!this.recorder.isRecording()) {
      this.stop();
      throw new Error(
        "AudioRecorder failed to start within 2s — check AVAudioSession activation, mic permission, or hardware availability",
      );
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    try {
      this.recorder?.clearOnError();
      this.recorder?.clearOnAudioReady();
      this.recorder?.stop();
    } catch {
      // best-effort
    }
    this.recorder = null;
    this.interruptionSubscription?.remove();
    this.interruptionSubscription = null;
    try {
      AudioManager.observeAudioInterruptions(false);
    } catch {
      // best-effort
    }
    void this.audioContext?.close();
    this.audioContext = null;
    this.negotiatedSampleRate = undefined;

    // Sasha medium fix: deactivate the iOS audio session so it doesn't
    // stay in playAndRecord after the user releases TalkButton — an
    // active playAndRecord session ducks other apps' audio routing
    // (background music, system sounds) until the next category
    // change. Per audio-api docs, setAudioSessionActivity(false) is
    // the documented deactivation path; there's no separate
    // "deactivate" API.
    //
    // audio-api docs:
    // https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager
    //
    // Fire-and-forget — stop() is sync per the AudioCapture interface
    // and the deactivation is not order-critical against further
    // teardown.
    void AudioManager.setAudioSessionActivity(false).catch(() => {
      // best-effort
    });
  }
}

/**
 * macOS implementation backed by the in-tree VoixAudioCapture TurboModule
 * (clients/app/macos/VoixNative/Sources/VoixAudioCapture.swift).
 *
 * The native side runs an AVAudioEngine input tap at the device's native
 * rate (read post-engine.start() — Sasha H1 fix), batches Float32 → PCM16
 * on a userInteractive queue, and emits base64-encoded frames via the
 * "voixAudioCapture.frame" event.
 *
 * This class decodes the base64 → Int16Array and hands each chunk to
 * opts.onFrame. The contract matches IosAudioCapture identically so the
 * orchestrator + TalkButton don't branch on platform.
 */

/** base64 → Uint8Array. Native string with `atob` is fine in RN-macOS
 *  (Hermes provides it via the JS env). We avoid Buffer to keep the web
 *  bundle clean — that's the whole reason this file is `.native.ts`. */
function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line no-restricted-globals
  const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64);
  if (bin === undefined) {
    throw new Error(
      "atob unavailable in RN runtime — VoixAudioCapture frame decode failed",
    );
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reinterpret a byte array as Int16LE. Native VoixAudioCapture
 *  emits little-endian native PCM16; on Apple Silicon + Intel that's
 *  always LE. */
function bytesToInt16LE(bytes: Uint8Array): Int16Array {
  // Copy into a new ArrayBuffer aligned for Int16 — re-using bytes.buffer
  // can land on an odd offset depending on the base64 decoder's slab.
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return new Int16Array(buf);
}

type VoixAudioCaptureModule = {
  start(): Promise<{ sampleRate: number }>;
  stop(): Promise<void>;
  getSampleRate(): Promise<number | null>;
};

class MacosAudioCapture implements AudioCapture {
  private negotiatedSampleRate: number | undefined;
  private started = false;
  private subscription: { remove: () => void } | null = null;
  private errorSubscription: { remove: () => void } | null = null;

  get sampleRate(): number | undefined {
    return this.negotiatedSampleRate;
  }

  async start(opts: AudioCaptureStartOpts): Promise<void> {
    if (this.started) return;
    const mod = NativeModules.VoixAudioCapture as VoixAudioCaptureModule | undefined;
    if (!mod) {
      throw new Error(
        "VoixAudioCapture native module unavailable — rebuild the macOS app",
      );
    }

    // Wire frame + error listeners BEFORE start() so we don't miss a
    // race-condition error fired during native engine.start().
    const emitter = new NativeEventEmitter(
      NativeModules.VoixAudioCapture as unknown as Parameters<
        typeof NativeEventEmitter
      >[0],
    );
    this.subscription = emitter.addListener(
      "voixAudioCapture.frame",
      (event: { base64: string; frames: number; sampleRate: number }) => {
        try {
          const bytes = base64ToBytes(event.base64);
          const pcm = bytesToInt16LE(bytes);
          opts.onFrame(pcm);
        } catch (err) {
          // Don't let a single bad frame kill the stream — log and
          // continue. The error path below catches stop-the-world failures.
          opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );
    this.errorSubscription = emitter.addListener(
      "voixAudioCapture.error",
      (event: { message: string }) => {
        opts.onError?.(new Error(`VoixAudioCapture: ${event.message}`));
      },
    );

    try {
      const result = await mod.start();
      this.negotiatedSampleRate = result.sampleRate;
      this.started = true;
    } catch (err) {
      this.subscription?.remove();
      this.subscription = null;
      this.errorSubscription?.remove();
      this.errorSubscription = null;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  stop(): void {
    if (!this.started) {
      // Clean up any listeners installed but engine-start failed.
      this.subscription?.remove();
      this.subscription = null;
      this.errorSubscription?.remove();
      this.errorSubscription = null;
      return;
    }
    this.started = false;
    this.subscription?.remove();
    this.subscription = null;
    this.errorSubscription?.remove();
    this.errorSubscription = null;
    const mod = NativeModules.VoixAudioCapture as VoixAudioCaptureModule | undefined;
    // Fire-and-forget — stop() interface is sync.
    void mod?.stop().catch(() => {
      // best-effort
    });
    this.negotiatedSampleRate = undefined;
  }
}

export function createAudioCapture(): AudioCapture {
  return Platform.OS === "macos" ? new MacosAudioCapture() : new IosAudioCapture();
}
