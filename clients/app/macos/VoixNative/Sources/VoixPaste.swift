/// VoixPaste — clipboard + auto-paste TurboModule.
///
/// Architecture: Decision 3 of architecture-m22.md.
///
/// Step 8 ships clipboard write only.
/// Step 9 adds the CGEventPost auto-paste flow.
///
/// JS surface (final shape — step 9 fills in paste()):
///   copyToClipboard(text: string): Promise<void>
///   paste(text: string): Promise<{ pasted: boolean, copied: boolean }>
///     - Always copies to clipboard.
///     - If Accessibility is trusted, posts Cmd+V into the focused app
///       (.cgSessionEventTap) and resolves { pasted:true, copied:true }.
///     - Otherwise resolves { pasted:false, copied:true } so the JS
///       overlay shows the CTA.

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

    /// Copy text to the general pasteboard. Sandbox-safe; no extra
    /// entitlements required (NSPasteboard.general is allowed inside
    /// app-sandbox per Apple's docs).
    @objc(copyToClipboard:resolver:rejecter:)
    func copyToClipboard(
        _ text: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Pasteboard ops are documented to be safe off-main but practice
        // shows a few crashes on older macOS when called concurrently
        // with focus changes. Hop to main; the cost is one runloop tick.
        DispatchQueue.main.async {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(text as String, forType: .string)
            resolve(nil)
        }
    }

    /// Copy + (step 9) post Cmd+V. Step 8 ships copy-only; the JS shim
    /// detects no `pasted` field and treats it as { copied:true }.
    @objc(paste:resolver:rejecter:)
    func paste(
        _ text: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(text as String, forType: .string)
            // Step 9 adds CGEventPost here. For step 8, resolve
            // copy-only — the MacOverlay JS uses `pasted` to decide
            // which toast to show.
            resolve(["pasted": false, "copied": true])
        }
    }
}
