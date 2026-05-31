# M23 Research: iOS App Shell Finishing

**Focus**: Inventory of M23 requirements from M21–M22 carry-forwards; tone gap across eight milestones; settings UI surface; intent dial; Conversations detail flow; Surfaces screen; background audio mode; macOS carry-forwards; out-of-scope items.

---

## 1. Carry-Forwards from M21–M22 Verification

| Finding | Source | Status | Details |
|---------|--------|--------|---------|
| **FINDING-1: Permission UX** | M21-product-wren.md | Implemented | RecoveryState (TalkButton.tsx:164–192) now tailors copy per error.kind; "Microphone access denied" directs to Settings → voix → Microphone. Red blob eliminated. |
| **FINDING-2: macOS deferral string** | M21-product-wren.md | Fixed | inlineAudio.native.tsx:99 changed from "M22" reference to "Audio playback on macOS is coming soon." (no internal milestone visible). |
| **BRAND-1: Overlay HUD branding** | M22-product-marina.md | Carry-forward → M23 | MacOverlay lacks voix puck + HA-blue ring. Menu-bar NSStatusItem deferred. |
| **HIG-1: No first-launch onboarding** | M22-product-marina.md | Carry-forward → M23 | Hotkey discoverability on macOS (first launch) not yet implemented. |
| **UX-3, UX-4, UX-5** | M22-product-marina.md | Carry-forward → M23 | Accessibility pre-explanation, macOS hotkey onboarding, dictate-vs-discuss distinction (product nudge). |

**File receipts:**
- packages/ui/src/conversations/TalkButton.tsx (lines 164–192)
- packages/ui/src/platform/inlineAudio.native.tsx (line 99)
- docs/phase-6/verify-results/M21-product-wren.md
- docs/phase-6/verify-results/M22-product-marina.md

---

## 2. Tone Gap Across Eight Milestones

**Schema location**: packages/ui/src/lib/api.ts (Voice type)
**Gap**: No "tone" field in Voice schema. Tone is **copy/UX gap**, not schema gap. Consistency audit spans M04, M13b, M16, M19, M20, M21, M22, M23.

| Milestone | Property | Copy Example | Issue |
|-----------|----------|--------------|-------|
| M04 | Voice editor prompt label | "What should voix ask?" | Original tone setter |
| M13b | Voice schema (realtime/dictation) | UI label distinction added | Explicit mode copy |
| M16 | Surfaces screen | "voix"/"puck"/"phone"/"browser" labels | Device naming |
| M19 | Monorepo UI (web + native) | "Talk to voix" (TalkButton.tsx:263) | Unified button copy |
| M20 | RN scaffold (iOS/macOS) | Platform shims via .native.ts | Copy reuse opportunity |
| M21 | Platform shims | inline audio iOS; macOS deferred (fixed in M22) | Consistency gap |
| M22 | Intent added (discuss/dictate) | TalkButton intent default "discuss" (line 45) | Distinction not user-facing |
| M23 | **Settings + intent dial** | iOS settings screen; intent choice UI | **Closure point** |

**Recommendation factor**: M23 should include product copy pass (all user-facing strings) across TalkButton labels, permission dialogs, settings defaults, and Voices/Surfaces descriptions. Audit for voix/puck/voice/dictate/discuss consistency.

**File receipts:**
- packages/ui/src/lib/api.ts
- packages/ui/src/conversations/TalkButton.tsx (lines 37–49, 260–277)

---

## 3. Settings Screen Surface Config

**Current state**: No settings UI exists (verified: no *Setting* files in packages/ui/src/).

**Deferred items** (appInfo.native.ts:7–14):
- `setApiBase()` wiring complete (appInfo.native.ts:59–62); **UI not shipped**
- Default dev daemon URL: `http://192.168.99.86:8765/` (line 36)
- Storage key: `voix.api_base` (line 38)
- Tom overrides via `__dev__.setApiBase()` until M23

**M23 responsibilities**:
| Setting | Type | Source | Notes |
|---------|------|--------|-------|
| API Base | text input | appInfo.native.ts | Persist to AsyncStorage; validate URL format |
| Voice Default | picker | voicesApi.list() | Link to Voices screen |
| Microphone Permission | toggle → iOS Settings | TalkButton.tsx:206 | Route to system prefs |
| Background Audio Mode | toggle | Info.plist (lines 40–43) | UIBackgroundModes already set; expose toggle |
| Sample Rate Override | picker | BrowserAudioIoClient (audio_io/client.ts) | Optional; for Bluetooth HFP fallback at 16kHz |

**File receipts:**
- packages/ui/src/platform/appInfo.native.ts (lines 7–71)
- clients/app/ios/voix/Info.plist (lines 32–43)

---

## 4. Intent Dial on iOS TalkButton

**Current state**: Intent prop exists; wiring trivial; UI not shipped.

| Component | Intent Support | Details | M23 Work |
|-----------|-----------------|---------|----------|
| TalkButton.tsx | Yes (M22) | intent prop (line 45); default "discuss" | Add picker UI; route to BrowserAudioIoClient |
| MacOverlay.tsx | Yes (M22) | passes intent="dictate" hardcoded | Expose as macOS settings toggle |
| BrowserAudioIoClient | Yes | accepts intent in constructor (audio_io/client.ts) | No changes needed |
| Voices + Conversation | Intent implicit | Voice has type: "realtime" \| "dictation" (api.ts) | UI discovery deferred to M24+ |

**Recommendation factor**: Closing the shopping-list use case (Sasha M21 brief; TalkButton hardcoded "discuss") requires iOS intent picker. Wiring is trivial (prop wiring shipped M22); UI is the lift.

**File receipts:**
- packages/ui/src/conversations/TalkButton.tsx (lines 37–49)
- packages/ui/src/lib/api.ts (Voice.type field)

---

## 5. Conversations Detail Flow on iOS

**Status**: Fully implemented (M17); no carry-forward gaps.

**Detail view structure** (ConversationDetail.tsx:79–127):
1. Header: voice name + timestamp + duration + mode
2. Transcript (M17): raw STT output (line 98–100)
3. Entry (M17): processedText artifact + LLM post-processor (lines 102–112)
4. Context receipt (M17): legibility audit requirement (lines 114–119)
5. Listen back (M17): inline audio players (lines 121–124)

**Inline audio playback** (inlineAudio.native.tsx:29–94):
- iOS: fetch URL → decodeAudioData → AudioBufferSource playback (~200ms latency)
- macOS: placeholder text (fixed FINDING-2 in M22)
- ConversationDetail imports InlineAudioPlayer (line 26) for mic.wav + speaker.wav

**File receipts:**
- packages/ui/src/conversations/ConversationDetail.tsx (lines 1–127)
- packages/ui/src/platform/inlineAudio.native.tsx (lines 1–137)

---

## 6. Surfaces Screen Accuracy

**Status**: Shipped (M16); capability chips accuracy TBD per iOS audio-api setup.

**Layout** (SurfaceList.tsx:94–121):
- Row per device record: name + friendly label + last-seen
- Puck glyph + clientKind tag (prettified: "puck", "phone", "browser", "laptop")
- CapabilityChips (lines 147+): mic rate, speaker rate, half-duplex, wake words

**Capability data source**: Surface.capabilities (populated by daemon handshake, M08).

**Accuracy risk** (M21-adversary-sasha.md, H1):
- Daemon declares recorder's actual rate; iOS AudioContext.sampleRate may differ on Bluetooth HFP fallback (16kHz vs. 44.1kHz mismatch).
- M23 setting (sample rate override, section 3) mitigates user-side.

**File receipts:**
- packages/ui/src/surfaces/SurfaceList.tsx (lines 1–150+)

---

## 7. Background Audio Mode Survival

**Status**: Infrastructure in place; survival test deferred.

**UIBackgroundModes configuration** (Info.plist:40–43):
```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

**M24 prerequisite**: Keyboard extension (not M23). Enables WebSocket survival when voix is backgrounded (e.g., user switches to Messages to paste, WS stays open).

**M23 responsibility**: Toggle in settings screen (section 3) to expose user control; no code changes needed (plist already set).

**File receipts:**
- clients/app/ios/voix/Info.plist (lines 40–43)
- clients/app/ios/voix/voix.xcodeproj (referenced but not analyzed)

---

## 8. macOS Carry-Forwards

| Carry-Forward | Source | Status | M23 Work |
|---------------|--------|--------|----------|
| **Hotkey chord rebind UI** | M22-product-marina.md | Deferred | Settings screen: hotkey picker (Cmd+Shift+K or user override) |
| **First-launch onboarding** | M22-product-marina.md | Deferred | Show hotkey chord on launch; prompt to enable Accessibility; teach press-in/press-out |
| **Menu-bar NSStatusItem** | M22-product-marina.md | Deferred | Status icon in system menu bar; quick access to Conversations/Voices/Surfaces |
| **Puck branding in HUD** | M22-product-marina.md (BRAND-1) | Deferred | MacOverlay: add voix puck glyph + HA-blue ring to overlay visual |
| **Accessibility pre-explanation** | M22-product-marina.md (UX-3) | Deferred | First-launch dialog before system Accessibility prompt |

**M22 adversary risks** (M22-adversary-yuki.md):
- B1: Sandboxed app missing `com.apple.security.device.audio-input` entitlement (zero channels error) — verify in M23 audit.
- B2: RCTNewArchEnabled=true but legacy RCT_EXTERN_MODULE (bridge/codegen mismatch) — requires codegen sync in M23.
- B3: kEventHotKeyReleased unreliable on macOS 13/14/15; release-on-key-up may never fire — test on multiple OS versions.
- H5, H6: Paste + permission dialog focus race; Accessibility cache invalidation — requires first-launch variant path.

**File receipts:**
- docs/phase-6/verify-results/M22-product-marina.md
- docs/phase-6/verify-results/M22-adversary-yuki.md
- clients/app/ios/voix/Info.plist (RCTNewArchEnabled:true, line 38)

---

## 9. Out-of-Scope for M23

| Item | Reason | Target | Notes |
|------|--------|--------|-------|
| **Voices editor enhancements** | New schema fields require M13/M15 rework | M24+ | Voice.tone, Voice.brand, Voice.persona fields deferred |
| **Voice discovery UI** | Crowded M23 settings screen | M24+ | Browse voices by type (realtime/dictation); search/filter |
| **Keyboard extension** | Requires iOS background mode survival proof | M24 | Paste flow into any text field |
| **macOS app isolation** | Requires entitlement + sandbox audit | M23 (audit) M24 (resolve) | Defer full sandbox implementation to M24 |
| **In-app hotkey rebind (macOS)** | Settings screen + Carbon EventTap rework | M24+ | User-facing hotkey customization deferred |
| **Puck OTA + firmware updates** | Requires daemon + puck comms hardening | M24+ | Firmware distribution chain not yet defined |
| **Analytics / telemetry consent** | Privacy policy + settings integration | M24+ | Track usage for diagnostics |

**File receipts:**
- packages/ui/src/lib/api.ts (Voice schema)
- docs/phase-6/architecture-m22.md (M23 scope boundary)

---

## Summary

**M23 ships iOS as a real shippable app by:**
1. Closing tone gap via settings UI + copy pass (section 2, 3)
2. Wiring intent dial on TalkButton (section 4)
3. Shipping settings screen with apiBase, voice default, permissions, background mode, sample rate (section 3)
4. Carrying M21–M22 findings into macOS first-launch onboarding + HUD branding (section 8)
5. Auditing Surfaces accuracy + Conversations detail flow (sections 5, 6)
6. Testing background audio mode survival on device (section 7)

**M22 adversary risks** (B1, B2, B3, H5, H6) require M23 **verify-brief** audit before ship.

