/// VoixAudioCapture — AVAudioEngine mic tap for macOS.
///
/// Architecture: Decision 1 of architecture-m22.md.
///
/// Approach:
///   - AVAudioEngine.inputNode.installTap(onBus: 0, bufferSize: 1024,
///     format: <inputNode's native format>) — we pass `nil` so the engine
///     uses whatever the hardware delivers (CoreAudio default device's
///     native rate, typically 44.1k or 48k mono/stereo Float32).
///   - Post-engine.start() we READ inputNode.outputFormat(forBus:0)
///     to learn the actual rate (Sasha H1 fix — declare the rate we
///     actually deliver, not a guess).
///   - In the tap closure (which runs on a real-time render thread),
///     copy into a Float32 array and dispatch to a userInteractive queue
///     for Float32 → PCM16 + base64 encode + RCT event emit. Tap closure
///     must not allocate / block / call into RN.
///   - Stereo → mono via channel-0 only (cheap, matches what Apple's own
///     Dictation does for the built-in mic; voice content is in either
///     channel). An equal-gain downmix is more correct but adds
///     allocations and the user-perceptible benefit is zero for VAD.
///
/// JS surface:
///   start() → { sampleRate: <Double> }
///   stop()  → null
///   getSampleRate() → <Double> | null
///   event "voixAudioCapture.frame" { base64: string, frames: number,
///                                    sampleRate: number }
///   event "voixAudioCapture.error" { message: string }

import AVFAudio
import AVFoundation
import Foundation
import React

@objc(VoixAudioCapture)
final class VoixAudioCapture: RCTEventEmitter {

    private let engine = AVAudioEngine()
    private var negotiatedSampleRate: Double = 0
    private var isRunning: Bool = false
    private var hasListeners: Bool = false
    // M22 step 10: AVAudioEngine configuration-change observer. macOS
    // doesn't have AVAudioSession.interruptionNotification (that's iOS),
    // but engine config changes fire on USB headset unplug, route
    // changes, sample-rate flips on the active device. We surface those
    // through voixAudioCapture.error so the orchestrator emits a typed
    // kind: "audio" error.
    private var configChangeObserver: NSObjectProtocol?

    private let emitQueue = DispatchQueue(
        label: "voix.audio.capture.emit",
        qos: .userInteractive
    )

    // Buffer of Float32 frames accumulated across taps until we hit a
    // ~64 ms chunk to emit. This batches up sub-buffer taps so JS isn't
    // hammered with 2 ms callbacks on devices with tiny tap sizes.
    private var pendingFloats: [Float] = []
    private let targetChunkFrames: Int = 1024

    // MARK: RCTEventEmitter

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    override func supportedEvents() -> [String]! {
        return ["voixAudioCapture.frame", "voixAudioCapture.error"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    // MARK: Lifecycle

    @objc(start:rejecter:)
    func start(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if isRunning {
            resolve(["sampleRate": negotiatedSampleRate])
            return
        }
        do {
            try beginCapture()
            isRunning = true
            resolve(["sampleRate": negotiatedSampleRate])
        } catch {
            // Surface to JS as a rejection (sync failure path) AND as an
            // error event (so async error listeners get the same signal).
            sendEvent("voixAudioCapture.error", [
                "message": error.localizedDescription,
            ])
            reject("EAUDIO", "VoixAudioCapture.start: \(error.localizedDescription)", error)
        }
    }

    @objc(stop:rejecter:)
    func stop(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if !isRunning {
            resolve(nil)
            return
        }
        endCapture()
        isRunning = false
        resolve(nil)
    }

    @objc(getSampleRate:rejecter:)
    func getSampleRate(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(negotiatedSampleRate > 0 ? negotiatedSampleRate : NSNull())
    }

    // MARK: Engine plumbing

    private func beginCapture() throws {
        let input = engine.inputNode
        // Reading the input node's NATIVE output format — this is what
        // CoreAudio is going to deliver. Sasha H1: hello declares what
        // we actually produce, not a guess.
        let nativeFormat = input.outputFormat(forBus: 0)
        let sampleRate = nativeFormat.sampleRate
        let channelCount = nativeFormat.channelCount

        // Defensive: if the input node has zero channels, the engine
        // failed to acquire the device. Surface that as a clean error
        // rather than getting nil-deref'd inside the tap.
        guard sampleRate > 0, channelCount > 0 else {
            throw NSError(
                domain: "VoixAudioCapture",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey:
                    "input node reports zero channels — no mic device available"]
            )
        }

        negotiatedSampleRate = sampleRate
        pendingFloats.removeAll(keepingCapacity: true)
        pendingFloats.reserveCapacity(targetChunkFrames * 2)

        // installTap is the streaming primitive. The format arg is the
        // FORMAT THE TAP DELIVERS; passing `nil` is documented to mean
        // "the input node's native output format" which is exactly what
        // we just read above. We pass it explicitly for clarity.
        //
        // bufferSize is a HINT — the engine may deliver smaller chunks
        // on devices with native short buffers (Bluetooth HFP, USB mics
        // with 64-frame buffers). The batching loop in handleTap
        // accumulates to targetChunkFrames before emitting.
        input.installTap(
            onBus: 0,
            bufferSize: AVAudioFrameCount(targetChunkFrames),
            format: nativeFormat
        ) { [weak self] buffer, _ in
            self?.handleTap(buffer: buffer)
        }

        // Subscribe to engine config-change events BEFORE start() so we
        // catch races between hardware enumeration and our start.
        configChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { [weak self] _ in
            guard let self = self, self.isRunning else { return }
            // Emit the error and let the orchestrator decide whether to
            // tear down. Don't tear down ourselves — that would leak
            // the stop responsibility.
            if self.hasListeners {
                self.sendEvent("voixAudioCapture.error", [
                    "message": "audio route changed mid-session (USB device unplugged or device sample-rate flip).",
                ])
            }
        }

        try engine.start()
    }

    private func endCapture() {
        if let token = configChangeObserver {
            NotificationCenter.default.removeObserver(token)
            configChangeObserver = nil
        }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        pendingFloats.removeAll(keepingCapacity: false)
        negotiatedSampleRate = 0
    }

    /// Called on AVAudioEngine's render-thread for each tap chunk. MUST
    /// be cheap: copy float channel 0 into a heap buffer + dispatch to
    /// the emit queue. Allocations here cause audio glitches.
    private func handleTap(buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        if frames == 0 { return }

        // Channel 0 only (mono extraction). Stereo or 5.1 mics drop the
        // other channels; this matches what voice apps universally do.
        let ch0 = channelData[0]
        var copy = [Float](repeating: 0, count: frames)
        copy.withUnsafeMutableBufferPointer { dst in
            dst.baseAddress?.update(from: ch0, count: frames)
        }

        emitQueue.async { [weak self] in
            self?.batchAndEmit(floats: copy)
        }
    }

    /// On the emit queue: append the new floats, then while we have at
    /// least targetChunkFrames, slice off a chunk + emit. PCM16 + base64
    /// encode happens here, not on the render thread.
    private func batchAndEmit(floats: [Float]) {
        pendingFloats.append(contentsOf: floats)

        while pendingFloats.count >= targetChunkFrames {
            let chunk = Array(pendingFloats.prefix(targetChunkFrames))
            pendingFloats.removeFirst(targetChunkFrames)

            // Float32 -1..1 → Int16 -32768..32767 with the standard
            // asymmetric mapping (matches packages/ui/.../floatToPcm16).
            var pcm = [Int16](repeating: 0, count: chunk.count)
            for i in 0..<chunk.count {
                let s = max(-1.0, min(1.0, chunk[i]))
                pcm[i] = s < 0 ? Int16(s * 32768.0) : Int16(s * 32767.0)
            }

            // Native-endian Data; on Apple Silicon + Intel that's LE,
            // which is what the JS side + daemon expect.
            let byteCount = pcm.count * MemoryLayout<Int16>.size
            let data = pcm.withUnsafeBufferPointer {
                Data(bytes: $0.baseAddress!, count: byteCount)
            }
            let base64 = data.base64EncodedString()

            // Emit only if a listener subscribed — RCTEventEmitter
            // logs a warning otherwise.
            if hasListeners {
                sendEvent("voixAudioCapture.frame", [
                    "base64": base64,
                    "frames": chunk.count,
                    "sampleRate": negotiatedSampleRate,
                ])
            }
        }
    }

    // Convenience over the optional-emitting sendEvent on the base class.
    private func sendEvent(_ name: String, _ body: [String: Any]) {
        super.sendEvent(withName: name, body: body)
    }
}
