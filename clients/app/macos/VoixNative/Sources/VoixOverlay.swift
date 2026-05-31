/// VoixOverlay — borderless non-activating NSPanel HUD for PTT.
///
/// Architecture: Decision 4 of architecture-m22.md.
///
/// Window config (every flag is load-bearing):
///   - styleMask: [.borderless, .nonactivatingPanel]
///   - level: .floating
///   - isFloatingPanel: true
///   - hidesOnDeactivate: false
///   - isReleasedWhenClosed: false
///   - collectionBehavior: [.canJoinAllSpaces, .stationary,
///                          .ignoresCycle, .fullScreenAuxiliary]
///   - canBecomeKey: false  ← CRITICAL — Decision 3 paste flow
///   - canBecomeMain: false ← CRITICAL — Decision 3 paste flow
///
/// `.nonactivatingPanel` + `canBecomeKey = false` is the load-bearing
/// pair: the panel renders but never steals first-responder, so
/// CGEventPost lands in the previously focused editor.
///
/// JS surface:
///   showOverlay(payload: dict): Promise<void>
///   hideOverlay(): Promise<void>
///
/// Step 7 wires the window to a tiny native NSView with a status label.
/// The TalkButton + transcript UX lives in JS (MacOverlay.tsx, also
/// step 7); this window is a frame for it. Mounting the JS overlay
/// inside the panel is left to the consumer via a separate RN bridge
/// — for M22 simplicity, the JS overlay renders inside the main
/// RCTRootView and the window is a hint frame. M23 can promote it to
/// a second RCTRootView once we need richer interactions.
///
/// (DOC NOTE: M22 minimum-viable — JS-side MacOverlay.tsx is what the
/// user sees and interacts with; the native panel is purely visual
/// chrome around it. Future evolution can host a second RCTRootView
/// inside, see commented placeholder below.)

import AppKit
import Foundation
import React

@objc(VoixOverlay)
final class VoixOverlay: NSObject {

    private var panel: VoixOverlayPanel?

    @objc static func requiresMainQueueSetup() -> Bool {
        return true
    }

    @objc(showOverlay:resolver:rejecter:)
    func showOverlay(
        _ payload: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.panel == nil {
                self.panel = VoixOverlayPanel.make()
            }
            let label = (payload["label"] as? String) ?? "Listening…"
            self.panel?.setStatus(label)
            self.panel?.repositionAtTopCenter()
            // orderFrontRegardless brings the panel to the front
            // WITHOUT activating the app — preserves the user's focus
            // in their editor.
            self.panel?.orderFrontRegardless()
            resolve(nil)
        }
    }

    @objc(hideOverlay:rejecter:)
    func hideOverlay(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.panel?.orderOut(nil)
            resolve(nil)
        }
    }

    @objc(updateStatus:resolver:rejecter:)
    func updateStatus(
        _ status: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.panel?.setStatus(status as String)
            resolve(nil)
        }
    }
}

/// The HUD panel itself. Load-bearing overrides: canBecomeKey /
/// canBecomeMain MUST stay false for the CGEventPost paste flow to
/// land in the focused editor instead of the overlay.
final class VoixOverlayPanel: NSPanel {

    // DO NOT CHANGE — load-bearing for paste flow (M22 risk #4).
    // The overlay must never steal first-responder; CGEventPost
    // posts Cmd+V into the previously focused app, which can't be
    // us. If you flip these to true, paste silently misfires.
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    private var statusLabel: NSTextField?

    static func make() -> VoixOverlayPanel {
        let size = NSSize(width: 360, height: 96)
        let rect = NSRect(origin: .zero, size: size)
        let panel = VoixOverlayPanel(
            contentRect: rect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .ignoresCycle,
            .fullScreenAuxiliary,
        ]
        panel.setupContent()
        return panel
    }

    private func setupContent() {
        // Rounded HUD background with a subtle vibrancy. Using
        // NSVisualEffectView gives the iOS Dynamic-Island feel.
        let effect = NSVisualEffectView(frame: contentView!.bounds)
        effect.autoresizingMask = [.width, .height]
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 16
        effect.layer?.masksToBounds = true
        contentView?.addSubview(effect)

        let label = NSTextField(labelWithString: "Listening…")
        label.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        label.textColor = .labelColor
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(label)

        let hint = NSTextField(labelWithString: "Hold ⌃⌥Space — release to send")
        hint.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .center
        hint.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(hint)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: effect.centerXAnchor),
            label.topAnchor.constraint(equalTo: effect.topAnchor, constant: 28),
            hint.centerXAnchor.constraint(equalTo: effect.centerXAnchor),
            hint.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 6),
        ])

        statusLabel = label
    }

    func setStatus(_ s: String) {
        statusLabel?.stringValue = s
    }

    func repositionAtTopCenter() {
        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.visibleFrame
        let size = frame.size
        let x = screenFrame.midX - size.width / 2
        // 24 pt below the menu bar (visibleFrame.maxY already accounts
        // for the menu bar, so this lands just under it).
        let y = screenFrame.maxY - size.height - 24
        setFrameOrigin(NSPoint(x: x, y: y))
    }
}
