/// VoixHotkey — global hotkey via Carbon RegisterEventHotKey.
///
/// Architecture: Decision 2 of architecture-m22.md picked Sindre Sorhus's
/// KeyboardShortcuts SPM package, which wraps Carbon's RegisterEventHotKey.
/// We implement Carbon directly (Path B from the Researcher's report) —
/// ~80 LOC, no SPM dependency wiring, identical sandbox + Accessibility
/// posture as KeyboardShortcuts. If M23 wants in-app rebind UI, swapping
/// to KeyboardShortcuts is a localised change.
///
/// Why Carbon over NSEvent.addGlobalMonitorForEvents (for KEY DOWN):
///   - addGlobalMonitor fires AFTER the focused app receives the key
///     (Decision 2 receipt) — Cmd+V would land before we could intercept.
///   - addGlobalMonitor requires Accessibility; we don't want that as a
///     prerequisite for the hotkey to work (only for paste).
///   - Carbon RegisterEventHotKey works inside app-sandbox with no extra
///     entitlements. Bear, Things, Raycast-alts all use it.
///
/// Why a flagsChanged FALLBACK for KEY UP:
///   - `kEventHotKeyReleased` is documented but empirically flaky on
///     macOS 13/14/15 when voix isn't focused (Yuki B3). Carbon emits
///     release only when the modifiers + chord key all go up AND voix
///     receives the focus chain — but our use case is precisely "voix
///     isn't focused" (user is in TextEdit).
///   - NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) does
///     NOT require Accessibility (only .keyDown / .keyUp do), so it's a
///     safe sandbox-friendly fallback.
///   - We track the chord state: when Carbon's keyDown fires we set a
///     down flag; if Carbon's release hasn't fired within ~50 ms of any
///     subsequent flagsChanged event showing that the chord modifiers
///     (control + option) are no longer pressed, we synthesize the up
///     ourselves. Whichever path fires first wins; the other is
///     suppressed via a "down" gate. Carbon stays primary; the monitor
///     is a safety net.
///
/// Default chord: ⌃⌥Space (Ctrl-Option-Space). Decision 2 picked this
/// because:
///   - ⌘Space = Spotlight
///   - Fn-Fn = Apple Dictation
///   - ⌃Space = input source switch
///   - ⌥Space = nbsp (some keyboards)
///   - ⌃⌥Space is unowned by macOS defaults.
///
/// JS surface:
///   register(): Promise<{ ok: boolean, chord: string }>
///   unregister(): Promise<void>
///   event "voixHotkey.down"
///   event "voixHotkey.up"

import AppKit
import Carbon
import Foundation
import React

@objc(VoixHotkey)
final class VoixHotkey: RCTEventEmitter {

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private var hasListeners: Bool = false
    // Singleton accessor for the C-function event handler trampoline
    // (Carbon takes a C function pointer; we trampoline to the
    // instance method). Internal so the file-local trampoline below
    // can reach it.
    fileprivate static var sharedInstance: VoixHotkey?

    // Yuki B3 fallback: NSEvent global monitor for .flagsChanged.
    // Carbon's kEventHotKeyReleased is unreliable when voix isn't the
    // focused app. We track chord-is-down ourselves and synthesize an
    // up event if Carbon's release doesn't fire within 50 ms of the
    // modifier flags being released.
    private var flagsMonitor: Any?
    private var chordIsDown: Bool = false
    // Required modifier flags for our chord (Ctrl + Option).
    private let requiredModifierMask: NSEvent.ModifierFlags =
        [.control, .option]

    // Key code 0x31 = Space (kVK_Space). Modifiers as Carbon flags.
    private let keyCode: UInt32 = UInt32(kVK_Space)
    private let modifierFlags: UInt32 = UInt32(controlKey | optionKey)
    private let hotKeyID = EventHotKeyID(
        signature: OSType(0x564f5849), // "VOXI"
        id: 1
    )

    override init() {
        super.init()
        VoixHotkey.sharedInstance = self
    }

    deinit {
        unregisterInternal()
        if VoixHotkey.sharedInstance === self {
            VoixHotkey.sharedInstance = nil
        }
    }

    override static func requiresMainQueueSetup() -> Bool {
        return true  // Carbon event handlers must be installed on the main run loop.
    }

    override func supportedEvents() -> [String]! {
        return ["voixHotkey.down", "voixHotkey.up"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    // MARK: JS surface

    @objc(register:rejecter:)
    func register(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                reject("ENOSELF", "VoixHotkey deallocated", nil)
                return
            }
            // Idempotent — re-register replaces the prior binding.
            self.unregisterInternal()

            // Install the event handler if we haven't already. Carbon
            // dispatches kEventHotKeyPressed AND kEventHotKeyReleased
            // for the same registration; we install one handler for both.
            if self.eventHandlerRef == nil {
                var eventTypes: [EventTypeSpec] = [
                    EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                  eventKind: UInt32(kEventHotKeyPressed)),
                    EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                  eventKind: UInt32(kEventHotKeyReleased)),
                ]
                let status = InstallEventHandler(
                    GetApplicationEventTarget(),
                    voixHotkeyEventHandler,
                    eventTypes.count,
                    &eventTypes,
                    nil,
                    &self.eventHandlerRef
                )
                if status != noErr {
                    reject("EHOTKEY", "InstallEventHandler failed: \(status)", nil)
                    return
                }
            }

            // Install the .flagsChanged global monitor (Yuki B3 fallback).
            // Sandbox-friendly; does NOT require Accessibility. Fires
            // every time the user presses or releases a modifier key
            // anywhere in the system. We only care about the moment
            // BOTH control and option go up while our chord is down.
            if self.flagsMonitor == nil {
                self.flagsMonitor = NSEvent.addGlobalMonitorForEvents(
                    matching: .flagsChanged
                ) { [weak self] event in
                    self?.handleFlagsChanged(event)
                }
            }

            // Register the hotkey itself. If another app already owns
            // ⌃⌥Space, RegisterEventHotKey returns eventHotKeyExistsErr;
            // we resolve with ok:false so JS can surface a clear log.
            let status = RegisterEventHotKey(
                self.keyCode,
                self.modifierFlags,
                self.hotKeyID,
                GetApplicationEventTarget(),
                0,
                &self.hotKeyRef
            )
            if status == noErr {
                resolve(["ok": true, "chord": "ctrl+opt+space"])
            } else {
                // Conflict or system-locked chord.
                resolve(["ok": false, "chord": "ctrl+opt+space",
                          "errorCode": status])
            }
        }
    }

    @objc(unregister:rejecter:)
    func unregister(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.unregisterInternal()
            resolve(nil)
        }
    }

    private func unregisterInternal() {
        if let ref = hotKeyRef {
            UnregisterEventHotKey(ref)
            hotKeyRef = nil
        }
        if let monitor = flagsMonitor {
            NSEvent.removeMonitor(monitor)
            flagsMonitor = nil
        }
        chordIsDown = false
        // Leave eventHandlerRef installed — re-register reuses it.
    }

    // MARK: Carbon callback bridge

    fileprivate func handleHotKeyEvent(_ kind: UInt32) {
        if kind == UInt32(kEventHotKeyPressed) {
            chordIsDown = true
            guard hasListeners else { return }
            sendEvent(withName: "voixHotkey.down", body: nil)
        } else if kind == UInt32(kEventHotKeyReleased) {
            // Carbon's release path is the happy path. Suppress
            // duplicate emits if the flagsChanged fallback already
            // fired (chordIsDown gate).
            if chordIsDown {
                chordIsDown = false
                guard hasListeners else { return }
                sendEvent(withName: "voixHotkey.up", body: nil)
            }
        }
    }

    /// Fallback release detection (Yuki B3). NSEvent.flagsChanged fires
    /// when the user presses or releases any modifier key. If our chord
    /// was pressed and we see the user has now released BOTH ctrl AND
    /// option (the required modifiers), treat that as the release —
    /// Carbon may never emit kEventHotKeyReleased reliably when voix
    /// isn't the focused app.
    ///
    /// Race-safety: chordIsDown flag is the single source of truth.
    /// Whichever path fires first wins; the other is a no-op.
    fileprivate func handleFlagsChanged(_ event: NSEvent) {
        guard chordIsDown else { return }
        // Did the user release the required modifiers? event.modifierFlags
        // reports the CURRENT state of all modifiers — so if either of
        // ctrl/option is no longer held, the chord can't still be down.
        let current = event.modifierFlags.intersection(requiredModifierMask)
        if current != requiredModifierMask {
            chordIsDown = false
            guard hasListeners else { return }
            sendEvent(withName: "voixHotkey.up", body: nil)
        }
    }
}

/// Carbon's event-handler API takes a C function pointer, so we route
/// through this top-level shim which trampolines to the singleton.
private func voixHotkeyEventHandler(
    _ next: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let event = event else { return OSStatus(eventNotHandledErr) }
    let kind = GetEventKind(event)
    DispatchQueue.main.async {
        VoixHotkey.sharedInstance?.handleHotKeyEvent(kind)
    }
    return noErr
}

