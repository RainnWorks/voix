/// VoixAudioPermissions — macOS mic + Accessibility permission gate.
///
/// Both use system runtime gates rather than entitlements:
///   - Microphone: AVCaptureDevice.requestAccess(for: .audio) — prompts
///     once, system caches per-bundle.
///   - Accessibility: AXIsProcessTrustedWithOptions — NEVER calls the
///     prompting variant (forces a quit/relaunch); the JS overlay
///     surfaces a CTA that opens System Settings instead.

import AVFoundation
import ApplicationServices
import AppKit
import Foundation
import React

@objc(VoixAudioPermissions)
final class VoixAudioPermissions: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    /// Returns the AVCaptureDevice mic auth state as a string:
    /// "granted" | "denied" | "restricted" | "undetermined".
    @objc(getMicrophoneStatus:rejecter:)
    func getMicrophoneStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized: resolve("granted")
        case .denied: resolve("denied")
        case .restricted: resolve("restricted")
        case .notDetermined: resolve("undetermined")
        @unknown default: resolve("undetermined")
        }
    }

    /// Triggers the mic prompt if undetermined. Resolves with the
    /// post-prompt status string ("granted" | "denied").
    @objc(requestMicrophone:rejecter:)
    func requestMicrophone(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            DispatchQueue.main.async {
                resolve(granted ? "granted" : "denied")
            }
        }
    }

    /// Read-only check; never prompts. The prompting variant forces a
    /// quit + relaunch which is hostile UX — we use the explicit CTA
    /// approach via openAccessibilitySettings() instead.
    @objc(isAccessibilityTrusted:rejecter:)
    func isAccessibilityTrusted(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let trusted = AXIsProcessTrustedWithOptions([key: false] as CFDictionary)
        resolve(trusted)
    }

    /// Opens the Accessibility pane in System Settings.
    /// The user toggles voix on; they then have to fully quit + relaunch
    /// the app (debug builds may need re-grant on every rebuild — that's
    /// macOS, not our bug; documented in M22 risk register #3).
    @objc(openAccessibilitySettings:rejecter:)
    func openAccessibilitySettings(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        )
        guard let u = url else {
            reject("EBADURL", "could not form Accessibility settings URL", nil)
            return
        }
        DispatchQueue.main.async {
            NSWorkspace.shared.open(u)
            resolve(nil)
        }
    }

    /// M23 — opens the Microphone pane in System Settings → Privacy.
    /// Mirrors openAccessibilitySettings() above; JS-side Settings
    /// screen surfaces this when the cached mic status is denied.
    @objc(openMicrophoneSettings:rejecter:)
    func openMicrophoneSettings(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        )
        guard let u = url else {
            reject("EBADURL", "could not form Microphone settings URL", nil)
            return
        }
        DispatchQueue.main.async {
            NSWorkspace.shared.open(u)
            resolve(nil)
        }
    }
}
