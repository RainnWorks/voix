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

    /// Drives the puck's audio-level pulse from JS (Marina BRAND-1).
    /// `level` is 0.0–1.0; the puck's outer ring scales between the
    /// rest size and ~+20% with this value. JS hands us an RMS computed
    /// from the mic frames it forwards to the daemon, so the ring
    /// breathes with the user's voice.
    @objc(setLevel:resolver:rejecter:)
    func setLevel(
        _ level: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.panel?.setAudioLevel(CGFloat(level.doubleValue))
            resolve(nil)
        }
    }
}

/// The HUD panel itself. Load-bearing overrides: canBecomeKey /
/// canBecomeMain MUST stay false for the CGEventPost paste flow to
/// land in the focused editor instead of the overlay.
///
/// Brand surface (Marina BRAND-1):
///   - The puck (charcoal rounded square + HA-blue circle) renders on
///     the left of the status text. This is the brand-owned moment
///     per the desktop guide §05 Screen 01 — the puck is the protagonist
///     of the voix-summoned moment.
///   - An HA-blue ring around the puck pulses with the mic audio level
///     ("rings emanate when audio is detected"). Driven from JS via
///     setLevel().
///
/// HA blue source: packages/ui/src/lib/theme.ts colors.haBlue =
///   "#03A9F4" — keep in sync if either side changes.
final class VoixOverlayPanel: NSPanel {

    // DO NOT CHANGE — load-bearing for paste flow (M22 risk #4).
    // The overlay must never steal first-responder; CGEventPost
    // posts Cmd+V into the previously focused app, which can't be
    // us. If you flip these to true, paste silently misfires.
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    private var statusLabel: NSTextField?
    private var puckBody: NSView?
    private var puckInner: NSView?
    private var puckRing: NSView?
    private var ringWidthConstraint: NSLayoutConstraint?
    private var ringHeightConstraint: NSLayoutConstraint?

    // Brand colours — keep in sync with packages/ui/src/lib/theme.ts.
    private static let haBlue = NSColor(
        red: 3.0 / 255.0,
        green: 169.0 / 255.0,
        blue: 244.0 / 255.0,
        alpha: 1.0
    )
    private static let inkBody = NSColor(
        red: 24.0 / 255.0,
        green: 24.0 / 255.0,
        blue: 27.0 / 255.0,
        alpha: 1.0
    )

    // Puck geometry (matches packages/ui/src/components/Puck.tsx ratios).
    private static let puckSize: CGFloat = 32
    private static let puckCornerRadius: CGFloat = puckSize * 0.22
    private static let puckInnerSize: CGFloat = puckSize * 0.35
    private static let ringRestSize: CGFloat = puckSize + 8   // ring radius at rest
    private static let ringMaxSize: CGFloat = puckSize + 24   // ring radius at level=1

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
        // Yuki H1: NSPanel hardening for focus + space behaviour.
        //   worksWhenModal=true   — keep responding when user has a
        //     modal sheet open inside voix (M23 settings).
        //   isMovableByWindowBackground=false — borderless panels can
        //     inherit this flag from RN's RCTRootView container; force
        //     it off so a stray click can't drag the HUD.
        //   acceptsMouseMovedEvents=false — defaults vary; future hover
        //     handlers would otherwise steal focus.
        panel.worksWhenModal = true
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = false
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .stationary,
            .ignoresCycle,
            .fullScreenAuxiliary,
        ]
        panel.setupContent()
        return panel
    }

    // Yuki H1: NSPanel mouseDown by default activates the parent app
    // (the "make-key-on-click" pathway). Override to no-op so a future
    // M23 click target inside the panel can't steal focus from the
    // user's editor mid-paste. Crucially, DO NOT call super.mouseDown
    // — that would defeat the override.
    override func mouseDown(with event: NSEvent) {
        // intentional no-op — see class docs.
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

        // Puck + pulse ring. The ring sits underneath the puck body so
        // its outer edge bleeds out as a halo. Both centered on a
        // single anchor point on the left of the content area.
        let ring = NSView()
        ring.translatesAutoresizingMaskIntoConstraints = false
        ring.wantsLayer = true
        ring.layer?.cornerRadius = Self.ringRestSize / 2
        ring.layer?.backgroundColor = Self.haBlue
            .withAlphaComponent(0.18).cgColor
        effect.addSubview(ring)

        let body = NSView()
        body.translatesAutoresizingMaskIntoConstraints = false
        body.wantsLayer = true
        body.layer?.cornerRadius = Self.puckCornerRadius
        body.layer?.backgroundColor = Self.inkBody.cgColor
        effect.addSubview(body)

        let inner = NSView()
        inner.translatesAutoresizingMaskIntoConstraints = false
        inner.wantsLayer = true
        inner.layer?.cornerRadius = Self.puckInnerSize / 2
        inner.layer?.backgroundColor = Self.haBlue.cgColor
        body.addSubview(inner)

        let label = NSTextField(labelWithString: "Listening…")
        label.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        label.textColor = .labelColor
        label.alignment = .left
        label.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(label)

        let hint = NSTextField(labelWithString: "Hold ⌃⌥Space — release to send")
        hint.font = NSFont.systemFont(ofSize: 11, weight: .regular)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .left
        hint.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(hint)

        // Layout: puck centered vertically, 24pt from left.
        // Status label + hint stack vertically to the right of the puck.
        let ringWidth = ring.widthAnchor.constraint(
            equalToConstant: Self.ringRestSize
        )
        let ringHeight = ring.heightAnchor.constraint(
            equalToConstant: Self.ringRestSize
        )
        NSLayoutConstraint.activate([
            // Ring centered on (puck center).
            ring.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            ring.centerYAnchor.constraint(equalTo: body.centerYAnchor),
            ringWidth,
            ringHeight,

            // Puck body
            body.leadingAnchor.constraint(
                equalTo: effect.leadingAnchor, constant: 28
            ),
            body.centerYAnchor.constraint(equalTo: effect.centerYAnchor),
            body.widthAnchor.constraint(equalToConstant: Self.puckSize),
            body.heightAnchor.constraint(equalToConstant: Self.puckSize),

            // Inner voice dot
            inner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            inner.centerYAnchor.constraint(equalTo: body.centerYAnchor),
            inner.widthAnchor.constraint(equalToConstant: Self.puckInnerSize),
            inner.heightAnchor.constraint(equalToConstant: Self.puckInnerSize),

            // Status label — top-aligned, to the right of the puck.
            label.leadingAnchor.constraint(
                equalTo: body.trailingAnchor, constant: 16
            ),
            label.trailingAnchor.constraint(
                lessThanOrEqualTo: effect.trailingAnchor, constant: -20
            ),
            label.topAnchor.constraint(
                equalTo: effect.topAnchor, constant: 28
            ),

            // Hint — below label.
            hint.leadingAnchor.constraint(equalTo: label.leadingAnchor),
            hint.trailingAnchor.constraint(
                lessThanOrEqualTo: effect.trailingAnchor, constant: -20
            ),
            hint.topAnchor.constraint(
                equalTo: label.bottomAnchor, constant: 6
            ),
        ])

        statusLabel = label
        puckBody = body
        puckInner = inner
        puckRing = ring
        ringWidthConstraint = ringWidth
        ringHeightConstraint = ringHeight
    }

    func setStatus(_ s: String) {
        statusLabel?.stringValue = s
    }

    /// Drive the audio-level ring from JS-side mic RMS.
    /// `level` is 0..1; clamped here. Animates the ring constraint so
    /// the pulse feels organic, not stepped.
    func setAudioLevel(_ level: CGFloat) {
        let clamped = max(0, min(1, level))
        let size = Self.ringRestSize
            + (Self.ringMaxSize - Self.ringRestSize) * clamped
        ringWidthConstraint?.constant = size
        ringHeightConstraint?.constant = size
        puckRing?.layer?.cornerRadius = size / 2
        // CALayer.opacity also breathes — subtle, brand-only blue.
        puckRing?.layer?.opacity = Float(0.18 + 0.45 * clamped)
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
