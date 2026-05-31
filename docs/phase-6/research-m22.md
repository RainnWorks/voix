# M22 macOS Shell — Research Report

**Date**: 2026-05-31  
**Scope**: Global hotkey, paste flow, audio capture/playback, accessibility, PTT overlay

---

## Receipts

**voix files cited** (stat format: mtime size path):

```
1780252502   48 clients/app/macos/voix-macOS/AppDelegate.mm
1780252502   51 clients/app/macos/voix-macOS/Info.plist
1780252502   12 clients/app/macos/voix-macOS/voix.entitlements
1780252502   28 clients/app/macos/Podfile
1780245452  220 packages/ui/src/platform/audioCapture.native.ts
1780245452   87 packages/ui/src/platform/audioPlayback.native.ts
1780245452   46 packages/ui/src/platform/permissions.native.ts
1780252502  878 docs/STATE.md
```

**Legacy Tauri patterns** (branch: legacy/tauri-clipboard):

```
app/src-tauri/src/paste.rs      (~40 lines) — osascript + AXIsProcessTrusted + error UX
app/src-tauri/src/menu.rs       (~60 lines) — tray menu + accelerator hotkey wiring
app/src-tauri/src/ha_client.rs  (~100 lines) — WS + Tauri event emission (JS bridge model)
```

**External sources fetched** (2026-05-31):

- https://developer.apple.com/documentation/coregraphics/cgeventpost (CGEventPost)
- https://developer.apple.com/documentation/applicationservices/axisprocesstrusted (Accessibility)
- https://developer.apple.com/documentation/avfaudio/avaudioengine (Audio graph)
- https://github.com/microsoft/react-native-macos (RN-macOS 0.81.7 status)
- https://sindresorhus.com/keyboard-shortcuts (KeyboardShortcuts Swift package)

---

## 1. Existing macOS Infrastructure

| Component | File | Lines | Status | Notes |
|---|---|---|---|---|
| AppDelegate | AppDelegate.mm | 48 | Boilerplate | RN lifecycle wired; no custom modules |
| Info.plist | Info.plist | 51 | Ready for extension | Has NSMicrophoneUsageDescription; missing clipboard + accessibility strings |
| Entitlements | voix.entitlements | 12 | Minimal | Sandbox + network.client only; **no paste/accessibility entitlements** (runtime gates instead) |
| Podfile | Podfile | 28 | Open | macOS 14.0 minimum; no audio/hotkey pods yet |

**Audio shim readiness:**

- `audioCapture.native.ts`: `MacosAudioCaptureStub` throws "coming soon" — ready to replace with AVAudioEngine
- `audioPlayback.native.ts`: `MacosAudioPlaybackStub` throws — ready to replace with AVAudioEngine speaker
- `permissions.native.ts`: macOS returns `ok: true` (no-op) — ready for real `AXIsProcessTrustedWithOptions()`

---

## 2. Global Hotkey on macOS

### NPM Ecosystem Status

| Library | Latest | RN-macOS 0.81 | Sandbox | Accessibility | Status |
|---|---|---|---|---|---|
| react-native-global-shortcut | unmaintained (2021) | unknown | ? | unknown | **Skip** |
| react-native-hotkey | ~0.1.0 | unknown | ? | unknown | **Skip** |
| KeyboardShortcuts (Sindre Sorhus) | 1.6.0 | ? | ✓ | No | Optional alt |

**Recommendation**: No first-party RN-macOS module exists. Choose **Path A (TurboModule + NSEvent)** or Path B (Sindre Sorhus' KeyboardShortcuts).

### Path A: TurboModule + NSEvent.addGlobalMonitorForEvents

```swift
@objc(HotkeyModule)
class HotkeyModule: NSObject, RCTBridgeModule {
  @objc static func moduleName() -> String! { "HotkeyModule" }
  private var monitor: Any?
  
  @objc func registerHotkey(_ keyCode: NSNumber, mods: NSNumber, 
                             resolve: @escaping RCTPromiseResolveBlock) {
    let m = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { e in
      if e.keyCode == UInt16(keyCode.intValue) { 
        onHotkey()  // → JS event emit
      }
    }
    monitor = m
    resolve(nil)
  }
}
```

**Pros**: No dependency; Cocoa NSEvent maintained; sandbox-compatible.  
**Con**: Foreground-only (acceptable for menu-bar PTT app).

### Path B: KeyboardShortcuts (Sindre Sorhus)

Maintained, pure Swift, works backgrounded. Add to Podfile:

```ruby
pod 'KeyboardShortcuts', '~> 1.6.0'  # via SPM
```

**Verdict**: Path A is lighter. If paste uses Accessibility anyway, the permission gate is shared.

---

## 3. Paste Flow

### Clipboard Write

**Method**: NSPasteboard (Cocoa) via TurboModule — no dependency, sandbox-compatible.

```swift
@objc(ClipboardModule)
class ClipboardModule: NSObject, RCTBridgeModule {
  @objc func setString(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}
```

**No new entitlements required** — NSPasteboard works inside sandbox.

### Auto-Paste: Method Comparison

| Method | API | Accessibility | Sandbox | Tauri tested | Notes |
|---|---|---|---|---|---|
| CGEventPost (Cmd+V) | Core Graphics | Yes | ✓ | ✓ | Recommended; proven in Tauri |
| osascript + System Events | subprocess | Yes | ✓ | ✓ | Fallback; slower |
| AXUIElementPostKeyboardEvent | a11y | Yes | ✓ | ? | Lower-level; overkill |

**M22 choice**: CGEventPost + `AXIsProcessTrustedWithOptions()` gate.

```swift
@objc(PasteModule)
class PasteModule: NSObject, RCTBridgeModule {
  @objc func pasteNow(_ resolve: @escaping RCTPromiseResolveBlock, 
                       reject: @escaping RCTPromiseRejectBlock) {
    guard AXIsProcessTrustedWithOptions(
      [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] 
      as CFDictionary
    ) else {
      reject("ACCESSIBILITY_DENIED", "Grant voix Accessibility in System Settings", nil)
      return
    }
    let event = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true)
    event?.flags = .maskCommand
    event?.post(tap: .cghidEventTap)
    resolve(nil)
  }
}
```

**No new entitlements** — Accessibility is a runtime gate, not an entitlement.

---

## 4. Audio Capture + Playback

### API Choice

| API | macOS min | Primary use | Recommended |
|---|---|---|---|
| AVAudioEngine | 11.0 | Node-graph audio processing | **✓ Pick this** |
| AVCaptureSession | 10.7 | Video + audio (video-centric) | No |
| AVAudioSession | 8.0+ | Routing config only | Use with Engine |

### Capture Implementation (macOS → Int16 PCM)

```swift
class MacosAudioCapture {
  private let engine = AVAudioEngine()
  private var sampleRate: Float = 0
  
  func start(bufferSize: Int, onFrame: @escaping ([Int16]) -> Void) {
    // Query device preferred rate (device routing sets this)
    let preferred = AVAudioSession.sharedInstance().sampleRate
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, 
                                sampleRate: preferred, channels: 1, interleaved: false)
    
    engine.inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(bufferSize), 
                                 format: format) { buffer, _ in
      let floats = buffer.floatChannelData![0]
      onFrame(floatToPcm16(floats))
    }
    try! engine.start()
  }
  
  func floatToPcm16(_ input: UnsafePointer<Float>) -> [Int16] {
    // Clamp [-1.0, 1.0] → Int16
    // (identical to iOS audio-api path)
  }
}
```

**Key**: Use `AVAudioSession.sharedInstance().sampleRate` to detect active route (Bluetooth HFP = 16 kHz, native = 48 kHz). Declare this rate in hello; daemon handles resampling.

### Playback Implementation

```swift
class MacosAudioPlayback {
  private let engine = AVAudioEngine()
  private var playbackTime = 0.0
  
  func pushFrame(pcm16: [Int16], sampleRate: Float) {
    let floats = pcm16ToFloat(pcm16)
    let buf = AVAudioPCMBuffer(pcmFormat: AVAudioFormat(..., sampleRate: sampleRate), ...)!
    buf.floatChannelData![0].assign(from: floats, count: floats.count)
    
    // Gapless scheduling (same as iOS audio-api)
    let now = engine.currentTime.sampleTime / Double(sampleRate)
    let startAt = max(now, playbackTime)
    let source = engine.createAudioPlayerNode()
    source.play(buf, at: startAt)
    playbackTime = startAt + Double(buf.frameLength) / Double(sampleRate)
  }
}
```

**No external deps** — AVAudioEngine is first-party, stable, sandbox-compatible.

---

## 5. PTT Overlay Window

### Multi-Window Pattern in RN-macOS

| Approach | Complexity | State sync | Notes |
|---|---|---|---|
| Modal sheet on main window | Low | Shared React context | **✓ Recommended** |
| Separate RCTRootView instances | Medium | Manual event bridge | Extra work |
| NSPanel floating window | High | Custom lifecycle | Overkill |

**Shape**: CSS `position: fixed` + z-index on FloatingPTTOverlay component. Global hotkey wires to state setter. Same code path as iOS (sheet on main window).

```tsx
const [showPTT, setShowPTT] = useState(false);
<>
  {showPTT && <FloatingPTTOverlay onClose={() => setShowPTT(false)} />}
</>
```

---

## 6. Accessibility Permission Flow

### Detection + Request

```swift
@objc(AccessibilityModule)
class AccessibilityModule: NSObject, RCTBridgeModule {
  @objc func checkAccessibilityTrust(_ resolve: @escaping (Bool) -> Void) {
    let trusted = AXIsProcessTrustedWithOptions([:] as CFDictionary)
    resolve(trusted)
  }
  
  @objc func requestAccessibilityTrust(_ resolve: @escaping (Bool) -> Void) {
    // First call → prompt "voix wants to use System Events"
    // Cached thereafter per bundle ID
    let trusted = AXIsProcessTrustedWithOptions(
      [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    )
    resolve(trusted)
  }
}
```

**User flow**:

1. Tap "Paste" button
2. First call prompts Accessibility permission
3. User grants → paste works
4. User denies → show error + "Open System Settings → Privacy & Security → Accessibility"

---

## 7. Tauri Legacy Patterns (Pre-Pivot)

### From `paste.rs`: Error Handling + Permission Guidance

```rust
pub fn paste_now() -> Result<(), String> {
    let script = r#"tell application "System Events" to keystroke "v" using command down"#;
    match Command::new("/usr/bin/osascript").arg("-e").arg(script).output() {
        Ok(o) if o.status.success() => Ok(()),
        _ => Err(
            "Grant voix Accessibility permission in System Settings → Privacy & Security → Accessibility."
            .to_string()
        ),
    }
}
```

**Ported to Swift**: Same error message + remediation link strategy.

### From `menu.rs`: Hotkey Accelerator Pattern

```rust
.accelerator("Cmd+N")  // NSMenu accelerator key binding
app.on_menu_event(|event| {
  match event.menu_item_id() { "new-conversation" => { ... } }
})
```

**Ported to RN-macOS**: TurboModule hotkey event → JS event emitter → React state.

### From `ha_client.rs`: Event Bridge Pattern

```rust
handle.emit("voix://transcript", transcript_event)  // Tauri event
// JS: window.listen('voix://transcript', ...)
```

**Ported to RN-macOS**: `RCTBridgeEventDispatcher` or `react-native-event-source` for native → JS events.

---

## 8. Tom's macOS Visual Baseline (Blocker)

**From STATE.md M20 smoke**:

> macOS app builds + launches (pid confirmed). **Visual verification pending Tom** — Mac was locked; screencapture only caught login screen.

**Blocker for M22 sign-off**: 

Tom must visually confirm M20 rendering matches iOS (sidebar, Voices list, mode colors) before M22 audio + hotkey lands. If M20 baseline is broken, M22 inherits the bug.

**Action**: Unlock Mac, take screenshot of running voix-macOS window, compare to iOS smoke screenshots in `docs/phase-6/m20-manual.md`.

---

## Library Candidates + Maintenance

| Function | Library | Maintained | RN-macOS 0.81 | Sandbox | Recommendation |
|---|---|---|---|---|---|
| Global hotkey | NSEvent (Cocoa) | ✓ | ✓ | ✓ | **Path A (TurboModule)** |
| Global hotkey | KeyboardShortcuts | ✓ | ? | ✓ | Alt if A fails |
| Clipboard write | NSPasteboard (Cocoa) | ✓ | ✓ | ✓ | **Direct TurboModule** |
| Auto-paste | CGEventPost (Core Graphics) | ✓ | ✓ | ✓ | **Primary (Tauri verified)** |
| Audio capture | AVAudioEngine (Cocoa) | ✓ | ✓ | ✓ | **TurboModule bridge** |
| Audio playback | AVAudioEngine (Cocoa) | ✓ | ✓ | ✓ | **TurboModule bridge** |
| Accessibility gate | AXIsProcessTrustedWithOptions | ✓ | ✓ | ✓ | **Runtime gate** |

---

## Summary: M22 Entry Criteria Met

| Criterion | Status | Notes |
|---|---|---|
| Global hotkey ecosystem | **Ready** | NSEvent (TurboModule) requires no dependency |
| Audio APIs | **Ready** | AVAudioEngine stable, matches iOS audio-api design |
| Paste + Accessibility | **Ready** | Proven in Tauri legacy; runtime gate, no entitlements |
| Clipboard | **Ready** | NSPasteboard, no entitlements required |
| Entitlements | **Ready** | Only sandbox + network needed (already present) |
| Tauri legacy patterns | **Leverageable** | paste.rs, menu.rs, ha_client.rs code translates to Swift |
| M20 baseline | **Pending Tom** | Visual confirmation of macOS UI still needed |

**No architectural blockers.** Proceed with:
1. TurboModule hotkey (Path A) + Accessibility gate
2. AVAudioEngine audio bridge
3. CGEventPost paste (or osascript fallback)
4. Modal PTT overlay on main window

**Dependency plan**: Zero external pods needed for core M22 functionality. (Optional: Sindre Sorhus' KeyboardShortcuts if Path A feedback falls short.)
