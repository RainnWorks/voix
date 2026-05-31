/// VoixAudioPlayback — gapless PCM16 playback via AVAudioPlayerNode.
///
/// Step 3 ships the skeleton; step 5 fills in the engine + scheduling.
///
/// Architecture: Decision 1 of architecture-m22.md. Inputs are 24 kHz
/// mono PCM16 (the daemon's native realtime rate). The engine resamples
/// to the device output rate. Each pushFrame schedules a buffer at
/// max(now, lastEnd) so consecutive chunks queue gaplessly.
///
/// JS surface contract (mirrors iOS audio-api shape):
///   start({ sampleRateHz }): Promise<void>
///   pushFrame(base64Pcm16): Promise<void>
///   stop(): Promise<void>

import AVFAudio
import Foundation
import React

@objc(VoixAudioPlayback)
final class VoixAudioPlayback: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc(start:resolver:rejecter:)
    func start(
        _ sampleRateHz: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Step 3 skeleton: reject so the JS branch detects unimpl.
        reject(
            "ENOTIMPL",
            "VoixAudioPlayback.start: skeleton — implemented in M22 step 5",
            nil
        )
    }

    @objc(pushFrame:resolver:rejecter:)
    func pushFrame(
        _ base64: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Step 3: swallow silently. The JS shim never throws on
        // pushFrame per the AudioPlayback contract.
        resolve(nil)
    }

    @objc(stop:rejecter:)
    func stop(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(nil)
    }
}
