/// VoixAudioPlayback — gapless PCM16 playback via AVAudioPlayerNode.
///
/// Architecture: Decision 1 of architecture-m22.md.
///
/// Approach:
///   - One AVAudioEngine + one AVAudioPlayerNode connected to the
///     engine's mainMixerNode. Engine resamples the player node's
///     declared input format to whatever the output device wants.
///   - The player node's input format is PCM16 mono at the daemon's
///     declared rate (24 kHz from M21; passed via start()).
///   - pushFrame schedules an AVAudioPCMBuffer at the running
///     `playbackTime` watermark. The watermark advances by chunk
///     duration, so consecutive chunks queue back-to-back gaplessly.
///
/// JS contract:
///   start({ sampleRateHz })           → null
///   pushFrame(base64Pcm16)            → null
///   stop()                            → null

import AVFAudio
import Foundation
import React

@objc(VoixAudioPlayback)
final class VoixAudioPlayback: NSObject {

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var pcm16Format: AVAudioFormat?
    private var playerScheduledHostTime: AVAudioTime?
    private var sampleRateHz: Double = 24000
    private var isStarted: Bool = false

    // The next "when" relative to player time at which to schedule the
    // upcoming chunk. Grows by chunk.duration after each schedule;
    // resets to 0 on stop. Player time = monotonic frames since
    // player.play() — gapless because we schedule at sample-accurate
    // offsets without ever reading the current playhead.
    private var nextPlayerSampleTime: AVAudioFramePosition = 0

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc(start:resolver:rejecter:)
    func start(
        _ rate: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if isStarted {
            resolve(nil)
            return
        }
        do {
            sampleRateHz = rate.doubleValue
            try beginPlayback()
            isStarted = true
            resolve(nil)
        } catch {
            reject("EAUDIO", "VoixAudioPlayback.start: \(error.localizedDescription)", error)
        }
    }

    @objc(pushFrame:resolver:rejecter:)
    func pushFrame(
        _ base64: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Be tolerant: orchestrator may push a frame in the gap between
        // close() and the next start(). Swallow rather than throw.
        if !isStarted {
            resolve(nil)
            return
        }
        guard let data = Data(base64Encoded: base64 as String) else {
            // Don't reject — malformed frames are not fatal to a session;
            // the daemon may have closed the chunk mid-stream. Log via
            // resolve() and continue.
            resolve(nil)
            return
        }
        guard let format = pcm16Format else {
            resolve(nil)
            return
        }
        let int16Count = data.count / MemoryLayout<Int16>.size
        if int16Count == 0 {
            resolve(nil)
            return
        }

        // Allocate a buffer at the player node's input format. Capacity
        // is the int16 sample count; frameLength is the same since we're
        // mono.
        guard let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(int16Count)
        ) else {
            resolve(nil)
            return
        }
        buffer.frameLength = AVAudioFrameCount(int16Count)

        // PCM16 little-endian → AVAudioPCMBuffer's int16ChannelData.
        // Apple Silicon + Intel are LE so a memcpy is correct; if we
        // ever ship for big-endian targets this becomes a swap loop.
        if let dst = buffer.int16ChannelData?[0] {
            _ = data.withUnsafeBytes { src in
                guard let srcAddr = src.baseAddress else { return 0 }
                memcpy(dst, srcAddr, int16Count * MemoryLayout<Int16>.size)
                return 0
            }
        }

        // Gapless scheduling: schedule at the next sample offset relative
        // to the player's own clock. Player ignores `at: nil` and queues
        // immediately, but using an explicit AVAudioTime guarantees
        // contiguity even if the player has briefly underflowed (would
        // otherwise insert a small silence at the head).
        let when = AVAudioTime(sampleTime: nextPlayerSampleTime,
                                atRate: sampleRateHz)
        player.scheduleBuffer(buffer, at: when, options: [], completionHandler: nil)
        nextPlayerSampleTime += AVAudioFramePosition(int16Count)

        if !player.isPlaying {
            player.play()
        }

        resolve(nil)
    }

    @objc(stop:rejecter:)
    func stop(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        if !isStarted {
            resolve(nil)
            return
        }
        endPlayback()
        isStarted = false
        resolve(nil)
    }

    // MARK: Engine plumbing

    private func beginPlayback() throws {
        // PCM16 mono at the daemon's rate. Engine resamples on the way
        // to the device output node.
        guard let fmt = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRateHz,
            channels: 1,
            interleaved: true
        ) else {
            throw NSError(
                domain: "VoixAudioPlayback",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey:
                    "could not create PCM16 mono format at \(sampleRateHz) Hz"]
            )
        }
        pcm16Format = fmt
        nextPlayerSampleTime = 0

        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: fmt)

        try engine.start()
        // Don't call player.play() yet — first pushFrame triggers it.
        // Calling play() with no scheduled buffers is fine but causes a
        // small "engine running but silent" window the first frame
        // closes anyway.
    }

    private func endPlayback() {
        player.stop()
        engine.stop()
        engine.disconnectNodeOutput(player)
        engine.detach(player)
        pcm16Format = nil
        nextPlayerSampleTime = 0
    }
}
