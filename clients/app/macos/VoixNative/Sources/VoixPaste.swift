/// VoixPaste — clipboard + auto-paste TurboModule.
///
/// Architecture: Decision 3 of architecture-m22.md.
///
/// Step 8 shipped clipboard write only.
/// Step 9 (this revision) adds CGEventPost auto-paste behind an
/// Accessibility gate.
///
/// JS surface:
///   copyToClipboard(text: string): Promise<void>
///   paste(text: string): Promise<{ pasted: boolean, copied: boolean }>
///     - Always copies to clipboard.
///     - If Accessibility is trusted, posts Cmd+V into the focused app
///       and resolves { pasted:true, copied:true }.
///     - Otherwise resolves { pasted:false, copied:true } so the JS
///       overlay shows the "Grant Accessibility" CTA.
///   isAccessibilityTrusted(): Promise<boolean>
///     - Non-prompting check. Used at app boot to log trust state.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import React

@objc(VoixPaste)
final class VoixPaste: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    /// Copy text to the general pasteboard. Sandbox-safe.
    @objc(copyToClipboard:resolver:rejecter:)
    func copyToClipboard(
        _ text: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(text as String, forType: .string)
            resolve(nil)
        }
    }

    /// Copy + try to auto-paste via CGEventPost. Gated on
    /// AXIsProcessTrustedWithOptions(prompt:false) — we NEVER call the
    /// prompting variant (forces quit+relaunch UX). The JS overlay
    /// surfaces a CTA that opens System Settings via the
    /// VoixAudioPermissions module when the result is { pasted:false }.
    ///
    /// The CGEventPost incantation (Tauri's archived paste.rs is the
    /// reference):
    ///   - keyboardEventSource: .combinedSessionState — picks up the
    ///     session's combined state (current modifiers, lock state).
    ///   - virtualKey 0x09 = V (kVK_ANSI_V).
    ///   - flags = .maskCommand — adds Cmd to the synthesised event.
    ///   - post(tap: .cgSessionEventTap) — session-level tap; lands in
    ///     the focused app even if it's sandboxed. .cghidEventTap can
    ///     lose to keyboards plugged in after voix started.
    @objc(paste:resolver:rejecter:)
    func paste(
        _ text: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            // Step 1: always write to the pasteboard. This is the
            // graceful-degradation guarantee — even if paste fails for
            // any reason, the user can ⌘V manually.
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(text as String, forType: .string)

            // Step 2: check Accessibility trust without prompting. The
            // prompting variant pops a system modal that demands a
            // quit+relaunch and the user may legitimately want manual-
            // paste (no Accessibility), so we use the read-only check
            // here and let the JS overlay drive the CTA.
            let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            let trusted = AXIsProcessTrustedWithOptions(
                [key: false] as CFDictionary
            )

            if !trusted {
                resolve(["pasted": false, "copied": true])
                return
            }

            // Step 3: small delay so the focused app has a stable cursor
            // before we synthesise the keystroke. Without this, fast
            // sessions sometimes synthesise the keystroke into a UI
            // element that just became first-responder a microsecond
            // earlier (the prior overlay-orderOut). 50 ms is invisible
            // to the user, plenty for AppKit's focus pipeline.
            //
            // Empirically this is the difference between "pastes
            // reliably" and "pastes 80% of the time."
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.postCmdV()
                resolve(["pasted": true, "copied": true])
            }
        }
    }

    /// Non-prompting Accessibility trust check. Used by the JS app at
    /// boot to log the current state + by the MacOverlay's
    /// post-session UX.
    @objc(isAccessibilityTrusted:rejecter:)
    func isAccessibilityTrusted(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let trusted = AXIsProcessTrustedWithOptions([key: false] as CFDictionary)
        resolve(trusted)
    }

    /// User-triggered Accessibility re-prompt path (Yuki H6 + Marina
    /// UX-3). Calls the PROMPTING variant of AXIsProcessTrustedWithOptions
    /// which fires the official Apple system modal. This is the only
    /// way to recover from "trust granted yesterday, signature changed,
    /// trust silently invalidated" on debug rebuilds — toggling voix in
    /// System Settings doesn't help because the entry there is stale.
    ///
    /// The prompting variant demands a quit + relaunch — hostile UX if
    /// fired unprompted, which is why the boot-time check uses the
    /// non-prompting variant. This method is wired to a JS-triggered
    /// "Grant Accessibility" CTA, so the user is expecting the modal.
    ///
    /// Resolves with the post-prompt trust state.
    @objc(requestAccessibility:rejecter:)
    func requestAccessibility(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let trusted = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
        resolve(trusted)
    }

    // MARK: Cmd+V synthesis

    private func postCmdV() {
        let src = CGEventSource(stateID: .combinedSessionState)
        guard
            let down = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: true),
            let up = CGEvent(keyboardEventSource: src, virtualKey: 0x09, keyDown: false)
        else {
            return
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        // .cgSessionEventTap is the right layer — posts as if from a
        // real keyboard, lands in the focused app's first responder.
        down.post(tap: .cgSessionEventTap)
        up.post(tap: .cgSessionEventTap)
    }
}
