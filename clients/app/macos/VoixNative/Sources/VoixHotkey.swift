/// VoixHotkey — global hotkey via Carbon RegisterEventHotKey.
///
/// Architecture: Decision 2 of architecture-m22.md picked Sindre Sorhus's
/// KeyboardShortcuts SPM package, which wraps Carbon's RegisterEventHotKey.
/// We implement Carbon directly (Path B from the Researcher's report) —
/// ~80 LOC, no SPM dependency wiring, identical sandbox + Accessibility
/// posture as KeyboardShortcuts. If M23 wants in-app rebind UI, swapping
/// to KeyboardShortcuts is a localised change.
///
/// Why Carbon over NSEvent.addGlobalMonitorForEvents:
///   - addGlobalMonitor fires AFTER the focused app receives the key
///     (Decision 2 receipt) — Cmd+V would land before we could intercept.
///   - addGlobalMonitor requires Accessibility; we don't want that as a
///     prerequisite for the hotkey to work (only for paste).
///   - Carbon RegisterEventHotKey works inside app-sandbox with no extra
///     entitlements. Bear, Things, Raycast-alts all use it.
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
        // Leave eventHandlerRef installed — re-register reuses it.
    }

    // MARK: Carbon callback bridge

    fileprivate func handleHotKeyEvent(_ kind: UInt32) {
        guard hasListeners else { return }
        if kind == UInt32(kEventHotKeyPressed) {
            sendEvent(withName: "voixHotkey.down", body: nil)
        } else if kind == UInt32(kEventHotKeyReleased) {
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

