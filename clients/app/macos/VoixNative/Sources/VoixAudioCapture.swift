/// VoixAudioCapture — AVAudioEngine mic tap for macOS.
///
/// Step 3 of M22 ships the skeleton (empty methods + JS-visible bridge);
/// Step 4 fills in the AVAudioEngine plumbing.
///
/// Architecture: Decision 1 of architecture-m22.md.
///   - Engine input tap on bus 0, format read from
///     `inputNode.outputFormat(forBus:0)` AFTER engine.start() (Sasha H1
///     fix — declare the rate we actually deliver).
///   - 1024-frame buffer (~64 ms at 16 kHz, ~21 ms at 48 kHz).
///   - Float32 → PCM16LE on a userInteractive queue (off the render
///     thread). Mono only — stereo source downmixed via AVAudioConverter.
///   - Emits NSDictionary{ frames: NSData(PCM16), sample_rate: NSNumber }
///     via the legacy bridge eventEmitter at the
///     `voixAudioCapture.frame` event name.
///
/// JS surface contract (mirrors iOS audio-api shape):
///   start(): Promise<{ sampleRate: number }>
///   stop():  Promise<void>
///   getSampleRate(): Promise<number | null>
///   addListener("voixAudioCapture.frame", ...)
///   removeListeners(count)
///
/// New Architecture note: this uses the legacy RCTBridgeModule shape
/// because hand-written TurboModule codegen in Swift on RN 0.81 is brittle
/// (M22 Decision 8 risk 5). The bridge interop layer in RN 0.81 wraps
/// legacy modules transparently when New Arch is enabled, so this still
/// shows up under NativeModules.* on the JS side.

import AVFAudio
import AVFoundation
import Foundation
import React

@objc(VoixAudioCapture)
final class VoixAudioCapture: RCTEventEmitter {

    // MARK: RCTEventEmitter boilerplate

    override init() {
        super.init()
    }

    override static func requiresMainQueueSetup() -> Bool {
        // Audio engine init is fine off-main; the bridge module setup is
        // pure Swift state. Returning false avoids needless main-thread
        // hops at module load.
        return false
    }

    override func supportedEvents() -> [String]! {
        return ["voixAudioCapture.frame", "voixAudioCapture.error"]
    }

    // MARK: Lifecycle (skeletal — filled in step 4)

    private var engine: AVAudioEngine?
    private var negotiatedSampleRate: Double = 0
    private var isRunning: Bool = false

    @objc(start:rejecter:)
    func start(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Step 3 skeleton: reject so the JS branch can detect a not-yet
        // implemented module without falling through to a silent no-op.
        // Step 4 replaces this with real AVAudioEngine setup.
        reject(
            "ENOTIMPL",
            "VoixAudioCapture.start: skeleton — implemented in M22 step 4",
            nil
        )
    }

    @objc(stop:rejecter:)
    func stop(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Idempotent no-op on the skeleton.
        resolve(nil)
    }

    @objc(getSampleRate:rejecter:)
    func getSampleRate(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(negotiatedSampleRate > 0 ? negotiatedSampleRate : NSNull())
    }
}
