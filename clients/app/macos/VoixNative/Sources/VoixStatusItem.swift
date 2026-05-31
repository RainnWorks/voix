/// VoixStatusItem — macOS menu-bar NSStatusItem (M23 Decision 5).
///
/// What it provides:
///   • A persistent menu-bar icon (the voix wordmark + a "•" badge
///     while the overlay is visible).
///   • "Talk to voix" menu item — same effect as pressing ⌃⌥Space,
///     bridges back to JS via the `voixStatusItem.talk` event.
///   • "Hotkey: ⌃⌥Space" — informational row; when chord registration
///     fails (conflict with another app) the row is amended with
///     "(conflict — open Settings)" and clicking opens Settings.
///   • "Quit voix" — calls NSApp.terminate, the standard way.
///
/// JS surface (mirrors VoixOverlay's pattern):
///
///     install(): Promise<void>
///       — call once at mount. Idempotent.
///     setOverlayVisible(visible: bool): Promise<void>
///       — drives the "•" badge so the menu-bar reflects whether the
///         HUD is currently showing (overlay opened on hotkey down).
///     setHotkeyLabel(label: string): Promise<void>
///       — show e.g. "Hotkey: ⌃⌥Space"; pass null/empty to hide row.
///     setHotkeyConflict(hasConflict: bool): Promise<void>
///       — true when useGlobalHotkey reported a conflict. The row
///         appends "(conflict)" copy and tapping fires the event
///         `voixStatusItem.openSettings` so JS can route the user.
///
/// Events sent JS-ward (via RCTEventEmitter pattern):
///   • voixStatusItem.talk         — "Talk to voix" tapped.
///   • voixStatusItem.openSettings — hotkey row tapped while in
///                                   conflict.
///   • voixStatusItem.quit         — Quit selected (fires before
///                                   NSApp.terminate so JS can
///                                   persist anything).

import AppKit
import Foundation
import React

@objc(VoixStatusItem)
final class VoixStatusItem: RCTEventEmitter {

    private var statusItem: NSStatusItem?
    private var hotkeyLabel: String = "Hotkey: ⌃⌥Space"
    private var hotkeyConflict: Bool = false
    private var overlayVisible: Bool = false
    private var hasListeners: Bool = false

    @objc static override func requiresMainQueueSetup() -> Bool {
        // NSStatusItem touches AppKit — must be on the main queue.
        return true
    }

    override func supportedEvents() -> [String] {
        return [
            "voixStatusItem.talk",
            "voixStatusItem.openSettings",
            "voixStatusItem.quit",
        ]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    @objc(install:rejecter:)
    func install(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.statusItem == nil {
                let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
                if let button = item.button {
                    button.title = "voix"
                    button.font = NSFont.systemFont(ofSize: 11, weight: .medium)
                    button.toolTip = "voix"
                }
                self.statusItem = item
                self.rebuildMenu()
            }
            resolve(nil)
        }
    }

    @objc(setOverlayVisible:resolver:rejecter:)
    func setOverlayVisible(
        _ visible: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.overlayVisible = visible
            // The badge is the load-bearing UI affordance — Marina
            // UX-2 wants the user to see at a glance that voix is
            // currently listening, even when the HUD is off-screen
            // (multi-monitor setups).
            if let button = self.statusItem?.button {
                button.title = visible ? "voix •" : "voix"
            }
            resolve(nil)
        }
    }

    @objc(setHotkeyLabel:resolver:rejecter:)
    func setHotkeyLabel(
        _ label: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.hotkeyLabel = label as String
            self.rebuildMenu()
            resolve(nil)
        }
    }

    @objc(setHotkeyConflict:resolver:rejecter:)
    func setHotkeyConflict(
        _ hasConflict: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.hotkeyConflict = hasConflict
            self.rebuildMenu()
            resolve(nil)
        }
    }

    // ─── Menu construction ─────────────────────────────────────────

    private func rebuildMenu() {
        let menu = NSMenu()

        let talkItem = NSMenuItem(
            title: "Talk to voix",
            action: #selector(handleTalk),
            keyEquivalent: ""
        )
        talkItem.target = self
        menu.addItem(talkItem)

        menu.addItem(NSMenuItem.separator())

        // Hotkey row — greyed-out info text by default. On conflict,
        // amend with the "open Settings" call to action and make it
        // tappable.
        let hotkeyText = hotkeyConflict
            ? "\(hotkeyLabel) (conflict — open Settings)"
            : hotkeyLabel
        let hotkeyItem = NSMenuItem(
            title: hotkeyText,
            action: hotkeyConflict ? #selector(handleOpenSettings) : nil,
            keyEquivalent: ""
        )
        hotkeyItem.target = self
        // Disabled rows (no action) are greyed; conflict makes it
        // active so the user can click to recover.
        hotkeyItem.isEnabled = hotkeyConflict
        menu.addItem(hotkeyItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(
            title: "Quit voix",
            action: #selector(handleQuit),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    @objc private func handleTalk() {
        // Emit a JS-side event; the MacOverlay listener summons the
        // overlay + opens a session, mirroring the hotkey-down path.
        if hasListeners {
            sendEvent(withName: "voixStatusItem.talk", body: nil)
        }
    }

    @objc private func handleOpenSettings() {
        if hasListeners {
            sendEvent(withName: "voixStatusItem.openSettings", body: nil)
        }
    }

    @objc private func handleQuit() {
        if hasListeners {
            sendEvent(withName: "voixStatusItem.quit", body: nil)
        }
        // Slight delay so the JS-side persistence has a tick to run
        // before AppKit tears the app down.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            NSApp.terminate(nil)
        }
    }
}
