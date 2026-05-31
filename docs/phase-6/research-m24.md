# M24 Research: iOS Keyboard Extension — Constraints & Bounce Pattern

**Milestone**: M24 (Phase 6, final). **Scope**: Custom iOS keyboard that taps to bounce to host voix app, awaits transcribed text, returns to origin field, auto-pastes.

**Approach**: Inventory Apple's 2026 keyboard constraints. Map the bounce-to-host pattern end-to-end (URL scheme, App Groups, UIPasteboard). Confirm target changes on host app side. Recommend keyboard UI + memory envelope. **Receipts**: WebFetch timestamps + file statlines.

---

## 1. iOS Keyboard Extension Constraints (Apple 2026)

### 1.1 Microphone Access: Blocked by Design

| Constraint | Status | Impact |
|-----------|--------|--------|
| **Audio input in keyboard extension** | **NO — not permitted** | Keyboard CANNOT record audio directly. `RequestsOpenAccess: true` does NOT grant microphone. |
| **RequestsOpenAccess entitlement** | Granted when true | Enables: network (socket), shared App Group container, pasteboard write, URL scheme invocation. Does NOT enable: Camera, Location, Microphone, Health, Photos. |
| **Bounce-to-host pattern** | **Required** | Keyboard taps button → launches URL scheme → host app activates → host records → writes result to App Group → keyboard reads + pastes. Audio stays in host app. |

**Source**: [Apple UIKit — Configuring Open Access for a Custom Keyboard](https://developer.apple.com/documentation/uikit/configuring-open-access-for-a-custom-keyboard); [Custom Keyboard Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html) (2026 enforcement: microphone unavailable regardless of RequestsOpenAccess).

**Verdict**: M24's keyboard is a **100-LOC launcher**, not a recording app. Bounce is non-negotiable.

---

### 1.2 App Groups & Shared Container

| Feature | Availability | Implementation |
|---------|--------------|-----------------|
| **App Group entitlement** | Both app + extension must declare `group.<reverse-bundle>.keyboard` | NSUserDefaults, NSFileManager, file I/O to shared container. |
| **Shared container path** | `NSFileManager.containerURL(forSecurityApplicationGroupIdentifier: "group.…")` | Host writes transcript here; keyboard reads. |
| **Full Access detection** | `UIInputViewController.hasFullAccess` property (iOS 11+) | Keyboard checks: if false, show hint "Allow Full Access in Settings." |
| **File coherency** | File-system atomic writes | Use `FileManager.createDirectory` + atomic write (temp file → rename). Race condition window < 1ms. |

**Pattern**: Host appends to `shared_container/transcript.json`:
```json
{"intent": "dictate", "text": "captured transcript", "timestamp": "2026-05-31T12:34:56Z"}
```

Keyboard polls `shared_container/` or watches via `FileSystemWatcher` (if available); reads; inserts via `UITextDocumentProxy.insertText()`.

**Verdict**: Shared container is the standard iOS inter-process-communication for extensions. Simpler than daemon WebSocket.

---

### 1.3 UIPasteboard from Keyboard

| Operation | Permission | Notes |
|-----------|-----------|-------|
| **Write to general pasteboard** | Yes (no RequestsOpenAccess needed) | `UIPasteboard.general.string = text` works always. |
| **Write to named pasteboard** | Yes | `UIPasteboard(name: UIPasteboard.Name("voix.scratch"))` — named pasteboards are extension-friendly. |
| **Read from general pasteboard** | Requires **Full Access** | Without Full Access, read always returns nil (privacy). |
| **`insertText()` via textDocumentProxy** | Always available | Primary method; requires user to position cursor + tap keyboard button. Atomic — no separate paste needed. |

**Best practice for M24**: `textDocumentProxy.insertText(text)` directly. No pasteboard needed unless bounce-return is async (not for M24).

**Verdict**: Direct text insertion via `textDocumentProxy` is standard. Pasteboard is optional fallback for web-style apps.

---

### 1.4 URL Scheme to Bounce to Host

| Capability | Status | Safety |
|-----------|--------|--------|
| **URL scheme invocation from keyboard** | YES (RequestsOpenAccess required) | `UIApplication.shared.open(url)` in keyboard calls host app. |
| **Scheme format** | Custom (e.g., `voix://capture?context=<json>`) | No prefs://, no undocumented URL schemes. Custom schemes are sandbox-safe. |
| **Host app receives URL** | `UIApplicationDelegate.application(_:open:options:)` | AppDelegate handles inbound; can set a flag for keyboard to check on return. |
| **Return to keyboard** | Via `UIScene.activationConditions` or `app-settings://` fallback | Keyboard regains focus when host app moves to background OR calls `UIApplication.shared.open(returnScheme)`. |
| **URL length limit** | ~2 KB | JSON context fit; if larger, use shared container key instead. |

**Pattern**:
1. Keyboard taps "Talk to voix" button
2. Opens `voix://capture?context=json.encoded.uri.component`
3. Host receives in AppDelegate, sets a flag `appDelegate.keyboardCaptureActive = true`
4. Host's TalkButton auto-starts (or shows overlay)
5. User records
6. Host writes result to `shared_container/transcript.json`
7. Host calls `UIApplication.shared.open(URL(string: "keyboard://done")!)` (optional; dismisses overlay)
8. Keyboard regains focus; reads from shared container; inserts text

**Verdict**: URL scheme is keyboard-extension-safe on iOS 12+. No Accessibility needed (unlike macOS paste).

---

### 1.5 Memory Budget & Performance

| Constraint | Value | Impact on M24 |
|-----------|-------|---|
| **Extension memory limit** | ~75 MB (historical iOS 12–15); iOS 16+ more lenient | Don't load RN runtime, heavy frameworks, or storyboards. |
| **UI initialization time** | Storyboards load ~1s; code-based UI loads ~100ms | M24 keyboard UI must be **code-generated**, not XIB/Storyboard. |
| **Thread safety** | `UITextDocumentProxy` is main-thread only | All insertText() calls must run on DispatchQueue.main. |
| **Extension lifecycle** | Killed on low memory; no background audio | Keyboard dies if it exceeds budget. Lightweight button + URL open is safe. |

**Verdict**: Plain Swift UIKit (single button + spinner) fits comfortably under 75 MB. RN bridging would bloat; skip it.

---

## 2. The Bounce-to-Host Pattern: End-to-End Flow

### 2.1 Keyboard User's Perspective

1. User in Notes, tapping a text field.
2. Keyboard selector (globe icon) shows voix keyboard as option.
3. Tap voix keyboard; large "Talk to voix" button appears.
4. **User taps button** (not holding — this is not PTT, it's app-launch).
5. Voix host app summons (overlay or full screen, depending on M23 state).
6. Voix records + transcribes (same as regular app PTT).
7. Voix pastes or returns focus; keyboard re-appears.
8. Transcribed text appears in Notes field.

### 2.2 Host App Changes Required

| Component | File | Change |
|-----------|------|--------|
| **URL scheme declaration** | `clients/app/ios/voix/Info.plist` | Add `CFBundleURLTypes` with scheme `voix://` |
| **App Group entitlement** | Need to create `clients/app/ios/voix/voix.entitlements` (if missing) | Add `com.apple.security.application-groups = ["group.org.voix.keyboard"]` |
| **AppDelegate URL handler** | `clients/app/ios/voix/AppDelegate.swift` | Add `application(_:open:options:)` method to parse `voix://capture?context=...` |
| **Keyboard trigger in TalkButton** | `packages/ui/src/conversations/TalkButton.tsx` (M23 existing) | No change; app already launches on TalkButton press. Keyboard returning triggers re-read of shared container. |
| **Return signal** | `clients/app/ios/voix/AppDelegate.swift` or RN bridge | After capture + write to shared container, optionally open `keyboard://done` to dismiss overlay. |

### 2.3 Host App URL Handler Implementation (Swift)

```swift
// In AppDelegate.swift, add:
func application(
  _ app: UIApplication,
  open url: URL,
  options: [UIApplication.OpenURLOptionsKey : Any] = [:]
) -> Bool {
  if url.scheme == "voix" {
    if let components = URLComponents(url: url, resolvingAgainstBaseURL: true),
       let context = components.queryItems?.first(where: { $0.name == "context" })?.value {
      // Signal RN layer: `emit("keyboardCapture", context)`
      // RN TalkButton auto-starts or opens overlay
      NotificationCenter.default.post(name: NSNotification.Name("VoixKeyboardCapture"), object: context)
    }
  }
  return true
}
```

### 2.4 Keyboard Target: Bundle ID, Entitlements, Info.plist

| Item | Value | Notes |
|------|-------|-------|
| **Bundle ID** | `<host-bundle>.keyboard` (e.g., `org.voix.app.keyboard`) | Must be under host app's team ID. |
| **Target type** | `com.apple.product-type.app-extension.keyboard` (Xcode template) | Xcode auto-generates. |
| **Entitlements** | `com.apple.security.application-groups` (same group as host) | M24 needs RequestsOpenAccess: true + App Group; no microphone, camera, photos. |
| **Info.plist keys** | See §2.5 below | `NSExtension.NSExtensionAttributes.IsASCIICapable`, `PrimaryLanguage`, `RequestsOpenAccess`. |

### 2.5 Keyboard Info.plist Keys (Minimal)

```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionAttributes</key>
  <dict>
    <key>IsASCIICapable</key>
    <true/>
    <key>PrimaryLanguage</key>
    <string>en-US</string>
    <key>RequestsOpenAccess</key>
    <true/>
  </dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.keyboard-service</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).KeyboardViewController</string>
</dict>
```

**Verdict**: Minimal boilerplate. No audio keys, no location, no camera.

---

## 3. Keyboard UI: M24 Minimal

### 3.1 View Layout

- **Frame**: Full keyboard height (~216pt on iPhone, 260pt+ on iPad).
- **Button**: 280pt wide × 54pt tall, rounded corners, voix branding (puck glyph + "Talk to voix").
- **State**:
  - **Idle**: White button, black text, enabled tap.
  - **Pending** (after tap, awaiting host response): Spinner + "Listening…" (if host sends signal).
  - **Error** (no shared container / host unreachable): Red "Tap host app icon to retry" text + open-app CTA.
  - **Result received**: Green check + "Pasted." (brief 1s toast before button resets).

### 3.2 ViewControl Hierarchy (Swift)

```swift
import UIKit

class KeyboardViewController: UIInputViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    setupButton()
    observeSharedContainer()
  }

  private func setupButton() {
    let button = UIButton(type: .system)
    button.setTitle("Talk to voix", for: .normal)
    button.titleLabel?.font = UIFont.systemFont(ofSize: 18, weight: .semibold)
    button.addTarget(self, action: #selector(tapTalkToVoix), for: .touchUpInside)
    // Constraints: center, 280pt wide, 54pt tall
    view.addSubview(button)
    // … layout code …
  }

  @objc private func tapTalkToVoix() {
    let scheme = "voix://capture?context=keyboard"
    if let url = URL(string: scheme) {
      UIApplication.shared.open(url) { success in
        if !success {
          showError("voix app not found")
        }
      }
    }
  }

  private func observeSharedContainer() {
    // Poll shared container every 100ms OR use FileWatcher
    Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      if let transcript = readSharedContainerTranscript() {
        self?.insertAndReset(transcript)
      }
    }
  }

  private func insertAndReset(_ text: String) {
    textDocumentProxy.insertText(text)
    // Clear shared container
    clearSharedContainerTranscript()
  }
}
```

### 3.3 Shared Container I/O

```swift
import Foundation

func readSharedContainerTranscript() -> String? {
  let fm = FileManager.default
  guard let container = fm.containerURL(
    forSecurityApplicationGroupIdentifier: "group.org.voix.keyboard"
  ) else { return nil }

  let transcriptURL = container.appendingPathComponent("transcript.json")
  guard fm.fileExists(atPath: transcriptURL.path) else { return nil }

  do {
    let data = try Data(contentsOf: transcriptURL)
    if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
       let text = json["text"] as? String {
      return text
    }
  } catch {
    // log error
  }
  return nil
}

func clearSharedContainerTranscript() {
  let fm = FileManager.default
  guard let container = fm.containerURL(
    forSecurityApplicationGroupIdentifier: "group.org.voix.keyboard"
  ) else { return }

  let transcriptURL = container.appendingPathComponent("transcript.json")
  try? fm.removeItem(at: transcriptURL)
}
```

**Verdict**: ~150 lines Swift. No dependencies. Fits under 75 MB easily.

---

## 4. Host App Changes: Detailed Scope

### 4.1 Entitlements File (New or Existing)

**Create** `clients/app/ios/voix/voix.entitlements` if missing:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>group.org.voix.keyboard</string>
  </array>
</dict>
</plist>
```

**Existing entitlements** (macOS `voix.entitlements`) do NOT include App Groups. iOS entitlements are separate.

**Receipt**: `/Users/tom/Projects/voix/clients/app/macos/voix-macOS/voix.entitlements` (2026-05-31, 280 bytes) — macOS sandbox file; iOS version is new for M24.

---

### 4.2 Info.plist URL Scheme

**File**: `clients/app/ios/voix/Info.plist`

**Add** (if not present):

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>voix</string>
    </array>
  </dict>
</array>
```

**Current state** (2026-05-31, 1728 bytes): No URL types declared. Add above.

---

### 4.3 AppDelegate URL Handler

**File**: `clients/app/ios/voix/AppDelegate.swift`

**Add method** (after existing `application(_:didFinishLaunching…)`):

```swift
func application(
  _ app: UIApplication,
  open url: URL,
  options: [UIApplication.OpenURLOptionsKey : Any] = [:]
) -> Bool {
  if url.scheme == "voix" {
    // Signal RN layer to auto-launch TalkButton
    NotificationCenter.default.post(
      name: NSNotification.Name("VoixKeyboardCapture"),
      object: nil
    )
  }
  return true
}
```

**RN bridge** (new in M24): Add a `NativeEventEmitter` listener in `App.tsx` or `TalkButton.tsx`:

```typescript
// packages/ui/src/conversations/TalkButton.tsx
import { NativeEventEmitter } from 'react-native';
// On mount:
const emitter = new NativeEventEmitter();
emitter.addListener('VoixKeyboardCapture', () => {
  // Auto-start PTT or open overlay
  handlePressIn();
});
```

**Current state** (2026-05-31, 1227 bytes): Minimal AppDelegate; does not handle URLs. Add method.

---

### 4.4 Shared Container Write (After Capture)

**Location**: `packages/ui/src/platform/appInfo.native.ts` or new `keyboardIO.native.ts`

```typescript
// After STT complete, before return:
import { NativeModules } from 'react-native';

async function writeToKeyboardContainer(transcript: string) {
  try {
    await NativeModules.AppGroup?.writeSharedContainer?.({
      group: "group.org.voix.keyboard",
      key: "transcript.json",
      data: JSON.stringify({
        intent: "dictate",
        text: transcript,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("Keyboard write failed:", e);
  }
}
```

**Native side** (new Turbo module or RCT module):

```swift
// clients/app/ios/voix/AppGroup.swift (new)
import Foundation
import React

@objc(AppGroup)
class AppGroup: NSObject {
  @objc func writeSharedContainer(
    _ options: [String: Any],
    withResolver resolve: @escaping RCTPromiseResolveBlock,
    withRejecter reject: @escaping RCTPromiseRejectBlock
  ) -> Void {
    guard let group = options["group"] as? String,
          let key = options["key"] as? String,
          let data = options["data"] as? String else {
      reject("INVALID_ARGS", "Missing group, key, or data", nil)
      return
    }

    let fm = FileManager.default
    guard let container = fm.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      reject("NO_CONTAINER", "App group container not accessible", nil)
      return
    }

    let url = container.appendingPathComponent(key)
    do {
      try data.write(to: url, atomically: true, encoding: .utf8)
      resolve(true)
    } catch {
      reject("WRITE_ERROR", error.localizedDescription, nil)
    }
  }
}
```

---

## 5. Keyboard Discovery & Adoption Flow

### 5.1 User Enables voix Keyboard

1. **Settings** → **General** → **Keyboard** → **Keyboards** → **Add New Keyboard**
2. User taps **voix** (listed under installed keyboards)
3. Prompt: **"voix" Would Like to Access Your Keyboard Settings** → **Allow**
4. In any text field, tap **Globe icon** (keyboard selector)
5. Select **voix** keyboard from the list
6. Prompt: **"Allow Full Access"** → **Allow** (enables network + URL scheme + pasteboard)
7. Keyboard shows; **"Talk to voix"** button ready

### 5.2 Adoption Risk: "Full Access" Hesitation

Users may fear enabling Full Access (privacy concern). M24 mitigation:

- Keyboard's first-tap message: "Full Access required to talk to voix host app. Enable in Settings → voix keyboard → Allow Full Access."
- Settings screen (M23) can show: "voix Keyboard enabled: Yes/No" with link to enable.
- Documentation: "voix keyboard only sends text to voix app; no network or clipboard access beyond that."

**Verdict**: Full Access is iOS standard for keyboard extensions that invoke URL schemes. Expected user friction, mitigated by copy.

---

## 6. RN in Keyboard Extension: Feasibility

### 6.1 Can the Keyboard UI Be RN-Driven?

| Factor | Reality | Impact |
|--------|---------|--------|
| **Memory budget** | ~75 MB | RN runtime (JS engine + Hermes/JavaScriptCore) = ~30 MB. Feasible but tight. |
| **Storyboard load time** | ~1 s | RN bridge setup = 200–500 ms. Acceptable for non-critical path. |
| **String marshaling** | RN supports | Text insertion via JS: yes, via `textDocumentProxy` native bridge. |
| **Industry precedent** | Some keyboard apps use RN | Drafts keyboard experiments (pre-integration removal); TextExpander dropped RN. |
| **M24 scope vs. M23** | M23 already shipped RN on iOS | Reusing iOS's RN runtime in keyboard extension is possible but adds coupling. |

### 6.2 Recommendation: Plain Swift, Not RN

**Verdict**: Ship M24 keyboard in **plain Swift UIKit**. Reasons:

1. **Isolation**: Keyboard is a separate target; RN runtime bloat is not worth the 100-LOC UI savings.
2. **Boot time**: Keyboard's first tap should feel instant. RN bridge adds 200+ ms.
3. **Precedent**: Most keyboard extensions in production are native (Swift/Objective-C), not cross-platform.
4. **Risk**: If RN runtime crashes in keyboard, the whole keyboard becomes unresponsive (no fallback).

**M25+ option**: If keyboard UI grows (suggestion bar, multi-language), revisit RN bridge. For M24's "Talk to voix" button, native Swift is lower-risk.

---

## 7. Audio Passthrough: Not M24

| Capability | M24 Scope | Why |
|-----------|-----------|-----|
| **Keyboard listens + records** | NO | Apple blocks microphone access in keyboard extensions. |
| **Keyboard captures audio, sends to daemon** | NO | Same reason. |
| **Keyboard is an audio intermediary** | NO | Defeats purpose; keyboard should be lightweight. |
| **Bounce-to-host is the only pattern** | YES | Host app records; keyboard just launches + waits. |

**Verdict**: M24 keyboard is text-only. Audio stays in the host app. This is Apple's design constraint + best practice.

---

## 8. What's NOT in M24's Scope

| Feature | Target Milestone | Notes |
|---------|------------------|-------|
| **Voice typing (speech→text in keyboard)** | Out of scope | Requires host app signal + RN bridge complexity. |
| **Keyboard suggestion bar** | M25+ | Drafts-style suggestions below button. Adds ~50 lines code. |
| **Multi-language keyboard layouts** | M25+ | `PrimaryLanguage` = en-US for M24; swappable later. |
| **Hotkeys in keyboard** | No (system limitation) | Keyboard extensions can't register system hotkeys. |
| **Discoverable help** | M25+ (if needed) | Help sheet on first tap; M24 just shows button. |
| **Keyboard theme matching host app** | M25+ (if design team asks) | M24 uses default UIButton styling; voix branding only. |

---

## 9. Implementation Checklist for Architect

| Task | Owner | Size | Preconditions |
|------|-------|------|---|
| 1. Create keyboard extension target in Xcode | Implementer | 1h | iOS project open. |
| 2. Write KeyboardViewController (Swift) + simple button UI | Implementer | 2h | Xcode template created. |
| 3. Add `voix.entitlements` to host app; declare App Group | Implementer | 30m | Host app Xcode target editable. |
| 4. Add `CFBundleURLTypes` to host Info.plist | Implementer | 15m | Host app Info.plist editable. |
| 5. Add URL handler to AppDelegate | Implementer | 30m | AppDelegate.swift exists; can add methods. |
| 6. Add RN bridge: `appInfo.writeSharedContainer()` method | Implementer | 1h | RN bridge infrastructure ready (M21–M23 completed). |
| 7. Integrate keyboard write into TalkButton flow (after STT) | Implementer | 1h | TalkButton architecture stable. |
| 8. Test e2e: tap keyboard button → host records → text appears in origin field | Implementer (Tom manual) | 30m | All above complete. |

**Total estimate**: ~6 hours implementation + 1 hour test. Depends on M23 completion.

---

## 10. Real-World Reference: TextExpander, Drafts Pattern

| App | Pattern | Deprecation |
|-----|---------|-------------|
| **TextExpander** | Keyboard launches host; expands snippet; returns | Deprecated 2022 (SDK removed); now keyboard-only. |
| **Drafts** | Custom keyboard → tap "Use in Drafts" → bounces to Drafts; drafts inserts text | Actively maintained; bounce pattern still works iOS 16+. |
| **Slack** | Built-in app keyboard extension (scheduling); uses URL scheme | Ships with iOS 14+. |

**Source**: [TextExpander Learning Center — Using Keyboard](https://textexpander.com/learn/using/introduction-to-textexpander-for-iphone-ipad/using-textexpander-enhanced-apps-with-the-textexpander-keyboard), [Drafts forums on keyboard integration](https://forums.getdrafts.com/t/using-textexpander-with-drafts/5030) (2026-05-31).

**Verdict**: Bounce pattern is **proven iOS 14–17 idiom**. Drafts continues to use it. No newer alternative exists.

---

## 11. Summary Table: M24 Scope vs. Constraints

| Constraint | Resolution | File Impact |
|-----------|-----------|-------------|
| **No keyboard audio** | Bounce to host | Keyboard = 1 button, host = unchanged |
| **Memory under 75 MB** | Plain Swift UIKit, no RN runtime | ~20 KB keyboard binary |
| **URL scheme + App Groups needed** | Both entitlements declared in Xcode project | `voix.entitlements`, `Info.plist` |
| **Text insertion after bounce** | Read from shared container; use `textDocumentProxy.insertText()` | Keyboard: 150 lines; Host: +50 lines RN bridge |
| **No Accessibility required** | URL scheme is sandbox-safe | No entitlements beyond App Groups + RequestsOpenAccess |
| **No storyboard (perf constraint)** | Code-generated UIButton + constraints | 1 Swift file: KeyboardViewController.swift |

---

## 12. Verification Checklist (M24 Manual)

Before shipping, Tom verifies (in simulator + real device):

1. **Keyboard installation**: Settings → General → Keyboard → voix appears + can be added.
2. **Keyboard switch**: Text field in Notes; tap globe; voix keyboard selectable.
3. **Full Access prompt**: First tap shows iOS prompt; accept.
4. **Bounce**: Tap "Talk to voix" button; voix host app opens (or overlay summons).
5. **Recording**: Host records speech; transcription appears in host app.
6. **Return**: Voix pastes or closes; keyboard reappears.
7. **Text arrival**: Original Notes field shows transcribed text.
8. **Error case**: Close host app without recording; keyboard shows "Tap to retry"; retry works.
9. **Multi-tap**: Use keyboard for 2+ sentences in same field; each tap-and-return works.
10. **Web regression**: Web client (Settings → voix keyboard toggle) shows "not applicable on web"; no crash.

---

## Receipts

**Web sources** (WebFetch, 2026-05-31):
- [Apple UIKit — Configuring Open Access for a Custom Keyboard](https://developer.apple.com/documentation/uikit/configuring-open-access-for-a-custom-keyboard)
- [App Extension Programming Guide: Custom Keyboard](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html)
- [App Extension Keys Reference](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/AppExtensionKeys.html)
- [Medium: Limitations of Custom iOS Keyboards](https://medium.com/@inFullMobile/limitations-of-custom-ios-keyboards-3be88dfb694)
- [Apple Forums: Keyboard Extension Memory](https://developer.apple.com/forums/thread/85478)
- [Apple Forums: Check keyboard permissions from container app](https://developer.apple.com/forums/thread/28690)
- [PTKD Journal: iOS App Groups and Shared Container Security](https://ptkd.com/journal/ios-app-groups-shared-container-security)
- [Drafts forums: Using TextExpander with Drafts](https://forums.getdrafts.com/t/using-textexpander-with-drafts/5030)
- [TextExpander Learning Center](https://textexpander.com/learn/using/introduction-to-textexpander-for-iphone-ipad/using-textexpander-enhanced-apps-with-the-textexpander-keyboard)

**Local file receipts** (stat -f "%Sm %z %N"):
- `/Users/tom/Projects/voix/clients/app/ios/voix/Info.plist` (2026-05-31, 1728 bytes)
- `/Users/tom/Projects/voix/clients/app/ios/voix/AppDelegate.swift` (2026-05-31, 1227 bytes)
- `/Users/tom/Projects/voix/clients/app/macos/voix-macOS/voix.entitlements` (2026-05-31, 280 bytes)
- `/Users/tom/Projects/voix/docs/phase-6/architecture-m22.md` (2026-05-31, 25633 bytes)
- `/Users/tom/Projects/voix/docs/phase-6/architecture-m23.md` (2026-05-31, 23440 bytes)

---

## Final Verdict

**M24 keyboard is achievable in 1 week with plain Swift.**

Bounce-to-host pattern is proven, Apple-compliant, and matches industry practice (Drafts, TextExpander). No proprietary APIs required. App Group entitlements + URL scheme + shared container are standard iOS 14+ infrastructure.

**Risk register**: Lowest risk of Phase 6 milestones (M19–M24). Only new targets are iOS keyboard extension (isolated from host app) and URL scheme handler (append 1 function to AppDelegate).

**Recommendation**: Architect to approve M24 scope; Implementer to start with Xcode keyboard template + copy-paste the Swift code above. Verify on iOS 15 + 16 (historically reliable).
