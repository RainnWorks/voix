# Phase 6 / M23 — iOS app shell: settings, intent dial, tone, onboarding

Owner: Architect. Status: ready for Implementer.

Scope: iOS becomes the shippable phone app. Settings screen replaces
M21's dev-console hack; TalkButton's hardcoded intent is driven by the
active voice; first-launch onboarding teaches mic + daemon URL; tone
snippet (8 milestones deferred) lands as a `Voice.tone` field with
editor + consumer surfaces; macOS picks up small carry-forwards
(status item, HUD puck, onboarding parity).

## Receipts

Files read (`stat -f "%Sm %z %N"`):

```
May 31 16:27 2026 25633 docs/phase-6/architecture-m22.md
May 31 16:05 2026 19662 docs/phase-6/verify-results/M21-product-wren.md
May 31 17:04 2026 20345 docs/phase-6/verify-results/M22-product-marina.md
May 31 17:07 2026 32649 docs/phase-6/verify-results/M22-adversary-yuki.md
May 31 14:35 2026 19247 docs/build-workflow.md
May 31 13:17 2026  9652 packages/protocol/src/audio-io.ts
May 31 15:52 2026  5696 packages/ui/src/lib/api.ts
May 31 14:00 2026 29116 packages/ui/src/voices/VoiceEditor.tsx
May 31 14:00 2026  7042 packages/ui/src/voices/VoiceList.tsx
May 31 16:46 2026 11413 packages/ui/src/conversations/TalkButton.tsx
May 31 17:24 2026  2334 packages/ui/src/App.tsx
May 31 16:53 2026  2483 packages/ui/src/platform/appInfo.native.ts
May 31 15:36 2026  1728 clients/app/ios/voix/Info.plist
```

`docs/phase-6/research-m23.md` does NOT exist at write time —
Researcher in parallel. Load-bearing calls: Decision 1 (tone schema),
Decision 3 (voice-driven intent). Coordinator escalates rather than
absorbs contradictions there.

Protocol receipts: `audio-io.ts:39` `Intent`; `api.ts:30`
`Voice.type = "realtime" | "dictation"` (Decision 3 load-bearing).
M22 Decision 10 — TalkButton already accepts `intent` with `"discuss"`
default; M23 makes it required.

Carry-forwards: Marina UX-2/3/4 + BRAND-1 + HIG-1; Yuki H4 (Decision
10 defer); Wren M21 (tone, settings, intent).

---

## TL;DR

1. `tone: string | null` (≤80 chars) on `Voice`. Editor input under
   name (italic 11pt); consumer one-liner in italic HA-blue under
   the voice name on VoiceList, SurfaceList, ConversationList.
2. Settings is a fourth `Section` ("settings") reached from a gear
   icon in `AppShell` bottom block. Controls: daemon URL, default
   voice picker, mic permission status + re-prompt, Accessibility
   (macOS only), About. AsyncStorage `voix.settings.*` keys.
3. TalkButton derives `intent` from the active voice's `type` —
   Realtime→discuss, Dictation→dictate. `intent` prop becomes
   **required** (no default). Hint copy reflects ("Hold to dictate"
   vs "Hold to talk").
4. First-launch onboarding: 3 screens (welcome / mic prompt / daemon
   URL probe) on iOS AND macOS, gated by `voix.onboarding.completed`.
5. macOS carry-forwards: ship status item + HUD puck + onboarding
   parity; defer KeyboardShortcuts SPM swap + hotkey rebind UI to
   **M23.5**.
6. Background-audio: manual smoke only (Decision 6). No new code
   unless the smoke fails.
7. Yuki H4 (sandbox automation): M23.5, not M23.

---

## Decision 1 — Tone snippet schema + UI

Pin: `tone: string | null` (≤80 chars, trimmed; null/empty
indistinguishable) on `Voice`. Editor field under name; consumers
show as italic HA-blue one-liner.

Schema lives in two paired files (mirror like the wire-protocol pair):

```ts
// voix-backend/src/voices/types.ts (after isBuiltin)
// packages/ui/src/lib/api.ts        (after isBuiltin)
/** One-line snippet shown under the voice's name on every card.
 *  Personality/marketing copy, ≤80 chars. Null/empty hides it. */
tone: string | null;
```

Server normalisation in `voix-backend/src/voices/store.ts` on write:
trim → empty becomes `null`; longer than 80 chars clamps. UI input
`maxLength={80}` enforces visually.

Why 80: one line on a 360pt phone card with body 12pt next to the
voice name without wrapping or visually equalling the name (Marina
line-height rule).

### Editor — VoiceEditor.tsx

In the `identityCol` block (around line 104), insert between
`nameInput` and the existing `descInput` (routingHint):

```tsx
<TextInput
  value={voice.tone ?? ""}
  placeholder="A one-line personality snippet."
  placeholderTextColor={colors.textQuiet}
  maxLength={80}
  onChangeText={(t) => setVoice({ ...voice, tone: t })}
  onBlur={() => save({ tone: (voice.tone ?? "").trim() || null })}
  style={styles.toneInput}
/>
```

`toneInput` copies `descInput` but `fontStyle: "italic"`, `fontSize:
11`. Tone (personality) and routingHint (auto-router cue) are
different consumers — keep both, label distinctly.

### Consumer — VoiceList, SurfaceList, ConversationList

VoiceList.tsx `VoiceCard` (around line 117), between `cardTitleRow`
and `cardDesc`:

```tsx
{voice.tone && (
  <Text style={styles.cardTone} numberOfLines={1}>{voice.tone}</Text>
)}
```

```ts
cardTone: {
  fontFamily: fontFamily.ui, fontSize: 11, fontStyle: "italic",
  color: colors.haBlue, lineHeight: 14,
},
```

HA-blue is correct: tone is voice-identity (brand moment), not chrome.
Same treatment in `SurfaceList.tsx` under bound voice's name, and in
`ConversationList` entries under the voice name.

### Built-ins

Seed `voix-backend/src/voices/builtins.ts`. Implementer pulls final
copy from `voix-brand-guide.html` brand-voice section; if none
specified, ship built-ins `tone: null` rather than wrong copy.
Suggested placeholders: realtime "A calm conversational partner.",
message "Crisp messages. No fluff.", email "Polite and professional.
Always lands.", note "Quick capture for future-you.", code "Plain
code. Comments where they earn it.", dictation "Just transcribes. No
rewrite."

Migration in `voices/store.ts::loadVoices`: if a built-in voice's
`tone` is undefined, seed from canonical built-in. User voices
(`isBuiltin: false`) **never auto-fill** — `tone: null`.

Rejected: storing tone inside `routingHint`; bumping wire protocol
(tone is daemon-API only).

---

## Decision 2 — Settings screen on iOS

Pin: Settings is a **fourth sidebar `Section` "settings"** in
`AppShell`'s bottom block (gear icon). Same `<SettingsScreen />` on
iOS / web / macOS; only the controls' affordances differ per platform.

| Option | Verdict |
|---|---|
| (a) Toolbar modal | Reject — no toolbar today; competing affordance. |
| (b) iOS-only tab bar | Reject — forks AppShell. |
| (c) **Fourth Section, sidebar bottom** | **Pin** — one nav model; consistent with Voices/Surfaces. |
| (d) Onboarding-only | Reject — settings must be reachable post-onboarding. |

Add `"settings"` to `AppShell::Section` and a `SidebarFlatItem` row
in the bottom group. Surfaces currently owns the `⚙` glyph — swap
Surfaces to `◇` so Settings can claim the gear (small Marina-pixel
call; not load-bearing).

### `packages/ui/src/settings/SettingsScreen.tsx` — sections

1. **Daemon connection** — TextInput for daemon URL (default
   `http://192.168.99.86:8765/`). HEAD `${base}api/voices` on
   debounced edit → "Connected" / "Unreachable" indicator. "Reset
   to default" button. Hidden on web (served from daemon's ingress).
2. **Default voice** — picker (`voicesApi.list()`) wires to
   `devicesApi.setVoice(currentDevice.deviceId, …)`. If no device
   yet (no session run), disabled row "Available after first
   session."
3. **Microphone permission** — status row + "Open Settings" CTA on
   deny: iOS calls `Linking.openURL("app-settings:")`; macOS calls
   `VoixAudioPermissions.openMicrophoneSettings()` (small new
   method mirroring existing `openAccessibilitySettings()`).
4. **Accessibility** (macOS only) — status + "Open Settings".
5. **About** — version (`DeviceInfo.getVersion()`), bundle id,
   `PROTOCOL_VERSION`, daemon version (HEAD `${base}api/version`;
   hide row on 404).

### Persistence

`@react-native-async-storage/async-storage` already a dep. Keys:

| Key | Owner | Notes |
|---|---|---|
| `voix.api_base` | `appInfo.setApiBase()` (existing) | Already wired. |
| `voix.onboarding.completed` | Onboarding (Decision 4) | Boolean. |
| `voix.settings.default_voice_id` | Settings | Optional override; falls back to first device's voiceId. |

Web uses `localStorage` via the existing storage web sibling.

### Navigation entry

Sidebar bottom block, after Surfaces. Same on all three platforms.
Not a tab, not a modal, not onboarding-only — **one Section among
four**.

---

## Decision 3 — Intent dial on TalkButton: voice-driven, visible

Pin: TalkButton's `intent` derives from the active voice's `type` —
`realtime` → `"discuss"`, `dictation` → `"dictate"`. **`intent`
prop becomes required** (no default). Caller computes + passes; hint
text surfaces the resolution.

| Option | Verdict |
|---|---|
| (a) Toggle next to button | Reject — adds an axis the user thinks about every time. Voice already encodes intent. |
| (b) **Derive from active voice's `type`** | **Pin** — single source of truth. Switching voices switches intent. Zero new UI. |
| (c) Per-launch sticky setting | Reject — invisible state. |

Wiring: `ConversationList` (or whatever wraps TalkButton) reads
`devicesApi.list()[0]` + `voicesApi.list()`, finds the active voice,
computes:

```ts
const intent: Intent = activeVoice?.type === "dictation" ? "dictate" : "discuss";
```

Passes to `<TalkButton intent={intent} …>`. Today only two callers
(Conversations + MacOverlay). Removing the default forces both to
pass explicitly — prevents the silent regression in Risk 2.

**Hint copy** in TalkButton — derives from `intent` prop:

```tsx
const hintCopy = intent === "dictate" ? "Hold to dictate." : "Hold to talk to voix.";
```

Replace the literal at line 148. `labelFor` also takes `intent`:
speaking state reads `"transcribing…"` for dictate, `"voix is
replying"` for discuss.

**Edge case** — no active voice yet (no devices). TalkButton hint
reads "Pick a voice to start"; Pressable disabled. Recovery state
links to Voices.

### Why no toggle

The active-voice card visibly shows the user's intent declaration
(ACTIVE pill + name + tone). Picking Realtime IS "I want to chat";
Dictation IS "I want to type by voice." Same pattern as Apple Dictate
(Fn-Fn). Per-session override is M24+ work.

---

## Decision 4 — First-launch onboarding (iOS + macOS)

Pin: 3-screen onboarding, gated by AsyncStorage
`voix.onboarding.completed`. Same component on iOS + macOS; web skips
entirely (web is served from the daemon, mic prompted by browser).

| Screen | Content | Affordance |
|---|---|---|
| 1. Welcome | Wordmark + puck glyph + tagline "voix listens when you talk to it." + one short paragraph of what voix is. | "Get started" |
| 2. Mic permission | Title "voix needs your microphone." One-line "why" copy. **Single button: "Allow microphone"** → invokes `permissions.requestMicrophone()` with voix in the foreground (closes Yuki H5 carry-forward for iOS — modal never steals focus mid-PTT later). Deny: copy switches to "Won't work without microphone access" + "Open Settings" + "Skip for now" (recoverable via Settings). | "Allow microphone" → result → next |
| 3. Daemon URL | TextInput pre-filled with `DEFAULT_DEV_DAEMON_URL`. Status indicator probes `${url}api/voices` (green check / red x). macOS gets an "Auto-detect" stub (Bonjour deferred — manual entry first). "Done" enables on green; on red, enables with warning copy "voix will work as soon as it's reachable." | "Done" → set flag → main app |

Implementation: `packages/ui/src/onboarding/Onboarding.tsx` (single
component, standard RN, no `.native` fork). `App.tsx` reads the flag
on mount; renders `<Onboarding onDone={…}>` when false, else
`<AppShell>`. Tiny "Skip setup" link on every screen for dev
("Drop this in production builds.").

macOS onboarding parity is Marina HIG-1's direct ask.
`<DaemonUrlInput />` extracted shared with Settings Decision 2 (DRY).

---

## Decision 5 — macOS M22 carry-forwards in M23 scope

| Brief | Verdict | Action |
|---|---|---|
| First-launch onboarding (Marina HIG-1/UX-4) | **Ship both platforms** | Decision 4 covers. |
| Menu-bar `NSStatusItem` (Marina Task 4) | **Ship — small surface** | New `VoixStatusItem.swift`: app name with "•" badge when overlay is showing, "Talk to voix" item (summons overlay = same as hotkey), "Hotkey: ⌃⌥Space" status row (greyed; click opens Settings stub), "Quit voix". Closes Marina UX-2 (hotkey conflict surfaced visibly). |
| Hotkey rebind UI / KeyboardShortcuts SPM | **Defer to M23.5** | Yuki architectural pushback #2 makes this load-bearing for B3. M23's surface area can't absorb the SPM swap + recorder UI. M23.5 queued. |
| Puck glyph + HA-blue pulse in HUD (Marina BRAND-1) | **Ship — RN-only delta** | `MacOverlay.native.tsx`: import `Puck` (28pt) left of status text; pulse opacity at audio level (re-use existing event or sin stub). No native-side change. |

KeyboardShortcuts deferral rationale: M23's iOS surface (settings,
onboarding, tone, intent dial) + macOS parity is at the milestone
budget edge. SPM swap is a focused M23.5: "swap KeyboardShortcuts +
add chord recorder UI in Settings."

---

## Decision 6 — Background audio mode validation on iOS

Pin: **Manual smoke only**. M21 added `UIBackgroundModes ["audio"]`
(`Info.plist:43-46` confirmed). M23 confirms sessions survive
backgrounding; no new entitlements.

Smoke (added to manual step 6):

1. Cold-start, navigate to Conversations.
2. Press TalkButton (status reaches `listening`).
3. While holding, swipe up to background.
4. Continue speaking for 30+ s.
5. Re-open voix. Session either still alive OR ended cleanly with
   captured entry.
6. **Failure modes to log**: WS closes immediately on background;
   audio frames stop; iOS kills app; session continues but daemon
   sees no audio.

If smoke passes (M22 interruption observer handles
`.AVAudioSessionInterruption`), done. If fails, M23.5 follow-up:
explicitly `AVAudioSession.setCategory(.playAndRecord, mode:
.voiceChat, options: [.allowBluetooth, .duckOthers])` at PTT start.
Document result in `m23-manual.md`.

---

## Decision 7 — Migration order

Web build never breaks; iOS PTT preserved at every step; macOS build
preserved. Every step = one commit.

| # | Commit | What | Smoke |
|---|---|---|---|
| 1 | `voix-backend(M23): tone field on Voice + builtin defaults` | Add `tone` to daemon types/store/builtins. Trim + clamp + migration guard (built-ins only). | `bun test`; `curl api/voices` shows tone. |
| 2 | `packages/ui(M23): mirror tone schema` | Mirror in `lib/api.ts`. | TS clean; web build green. |
| 3 | `packages/ui(M23): VoiceEditor tone input` | Italic 11pt under name, 80-char max. | Tone editable + persists. |
| 4 | `packages/ui(M23): tone display on cards` | Italic HA-blue one-liner on VoiceList/SurfaceList/ConversationList. | Built-ins show seeded snippets. |
| 5 | `packages/ui(M23): intent dial — voice-driven, required prop` | Conversations computes intent; removes `intent` default; hint switches; MacOverlay still passes `"dictate"`. | Switch active voice; hint updates; session sends correct intent. |
| 6 | `packages/ui(M23): Settings screen + AppShell section` | "settings" Section + gear icon. SettingsScreen with daemon URL, default voice, mic perm, About. | Daemon URL persists cold restart. |
| 7 | `packages/ui(M23): onboarding + render gate` | `Onboarding.tsx` 3 screens + App.tsx gate. Skip-out link. Shared `<DaemonUrlInput />`. | Fresh iOS: onboarding shows; mic prompt; daemon probe; "Done" persists. macOS same. |
| 8 | `clients/app(M23): macOS status item` | `VoixStatusItem.swift`: menu-bar with "Talk to voix", hotkey row (conflict reflected), Quit. | Item appears; click → overlay. |
| 9 | `packages/ui(M23): MacOverlay HUD puck + pulse` | Puck 28pt left of status text; opacity pulses on audio. | Puck pulses on speak. Marina BRAND-1 closed. |
| 10 | `docs(M23): m23-manual.md + close-out` | Manual; STATE; risk register. | Tom runs manual. |

Why this order: 1-4 close tone monotonically. 5 (intent) is small +
prop already wired. 6 (settings) before 7 (onboarding) because
onboarding reuses `<DaemonUrlInput />`. 8-9 macOS are deferrable.

**Split point if long**: step 7 boundary. M23a = 1-7 (iOS shell);
M23b = 8-10 (macOS polish). Phase-6 critical path runs through iOS.

---

## Decision 8 — Risk register

| # | Risk | Detect | Mitigate |
|---|---|---|---|
| 1 | **Tone migration overwrites user voice data.** Default-fill runs against full voices.json; if it touches `isBuiltin: false` voices, Tom loses customisation. | Diff voices.json before/after first M23 boot; user voices should be `tone: null` (not seeded). | Migration guard: only `isBuiltin: true` voices auto-fill. Daemon test asserts user voice's `tone` stays null through migration. |
| 2 | **Intent dial regression on web.** Forgetting to pass `intent` from Conversations → dictate voices silently discuss. | Activate dictation voice; press talk; check session lands as dictate in conversations. | Make `intent` prop **required** (no default). Compile-time error if not passed. Two callers — both updated in step 5. |
| 3 | **Settings daemon-URL bricks the app.** User edits URL wrong, no path back to fix because all screens depend on daemon. | TalkButton red-pills "unreachable"; user can't find Settings to undo. | Settings is a sidebar Section (Decision 2) — does NOT depend on `voicesApi.list()` to render. Daemon URL row works offline. "Reset to default" button next to the field. |
| 4 | **Onboarding loop trap.** Mic deny → Open Settings → grant → return → still on deny screen because React state didn't re-check. | Deny mic; open Settings; toggle on; return; onboarding stuck. | `AppState` observer: on `active`, re-check permission; auto-advance to screen 3 if granted. |
| 5 | **Tone defaults drift from brand voice.** Implementer ships suggestions verbatim; brand-guide review later flags them. | Marina M23 verify catches. | Treat Decision 1's suggested strings as **placeholders**. Implementer pulls final from `voix-brand-guide.html`; if no voice-tone copy exists, ship built-ins `tone: null` (better than wrong). |

---

## Decision 9 — Tom's M23 manual

Saved as `docs/phase-6/m23-manual.md` (step 10). Load-bearing step is
**5** (tone + intent + PTT on fresh sim).

```bash
# 0. Pre-flight
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
# 1. Daemon + Metro
cd voix-backend && bun src/index.ts &
cd clients/app && bun run start &
# 2. Clean iOS AsyncStorage
xcrun simctl uninstall booted org.reactjs.native.example.voix
# 3. Run iOS (first build 1-3 min → onboarding screen 1)
cd clients/app && bunx react-native run-ios --simulator="iPhone 16 Pro"
```

**4. Walk onboarding.** Screen 1 "Get started"; screen 2 "Allow
microphone" → iOS modal → Allow; screen 3 URL pre-filled, status
green if daemon up (edit until green), tap "Done". Lands on Voices.

**5. Tone + intent + PTT (load-bearing).**
- Voices list: each built-in card shows italic HA-blue tone under
  name.
- Tap voice → editor: tone field editable; blur persists.
- Activate `default-dictation`. Conversations: hint reads "Hold to
  dictate." Hold, say "test entry one", release; entry lands.
- Switch to `default-realtime`. Hint "Hold to talk to voix." Hold,
  say "test entry two", release. Realtime reply plays.

**6. Background audio smoke.** Hold TalkButton (Realtime). Reach
`listening`. Swipe to background. Speak 30s. Re-open. Either alive
OR cleanly captured. Else log + queue follow-up.

**7. Settings smoke.** Settings (gear). Edit daemon URL invalid.
Save. Conversations shows "unreachable." Edit back. PTT recovers.

**8. macOS regression.** `cd clients/app && bun run macos`. Menu-bar
item appears. First launch: onboarding shows. Press ⌃⌥Space: overlay
summons; puck glyph left of status; pulses on audio. Status item
shows "•" while overlay open.

**9. Web regression.** `cd voix-backend/ui && bun run build`. Open
HA add-on UI: tone snippets render; gear icon present (daemon URL
row hidden); TalkButton + intent dial work.

**10. Acceptance reporting.** iOS onboarding + tone + intent +
settings + PTT working; macOS onboarding + status item + HUD puck
working; web regression clean.

---

## Decision 10 — Yuki H4 (sandbox automation): NOT M23

Pin: H4 (sandbox `automation.apple-events` for broader paste targets)
defers to M23.5. Reasoning:

- H4 is macOS-paste-fidelity; M23's primary surface is iOS + cross-
  platform polish. Adding macOS sandbox entitlements + per-target
  test matrix is its own milestone shape.
- Current TextEdit-grade paste is functional; H4 graduates the macOS
  product to broader target apps (Slack, VS Code, Mail). "macOS goes
  pro" milestone — M23.5 candidate.
- Blast radius contained: clipboard write always happens (Yuki's
  falsification confirms); only the Cmd+V injection fails for
  non-TextEdit targets. Manual ⌘V remains.

Queue M23.5 with two pillars:

> **M23.5 (macOS pro):** swap to `KeyboardShortcuts` SPM (Yuki B3 —
> release-event reliability); add
> `com.apple.security.automation.apple-events` + document per-target
> paste compat (Yuki H4); ship Hotkey row in Settings with chord
> recorder UI (Marina UX-2 + hotkey rebind carry-forward).

---

## Acceptance criteria

M23-complete when all hold (Tom-verifiable in one session):

1. `Voice` has `tone: string | null` end-to-end (daemon + UI).
2. VoiceEditor shows tone field below name, 80-char max, italic.
3. VoiceList + SurfaceList + ConversationList show tone as italic
   HA-blue one-liner under voice name when non-empty.
4. Built-in voices ship with seeded tone strings (or null if brand
   guide silent on per-voice tone — Risk 5).
5. Sidebar has fourth Section "settings" with gear icon;
   `SettingsScreen` renders.
6. Settings → Daemon URL edits + persists via AsyncStorage;
   survives cold restart.
7. Settings → Microphone shows status + "Open Settings" CTA on
   deny.
8. TalkButton's `intent` is resolved from active voice's `type`;
   prop is **required** (no default).
9. TalkButton hint copy reflects intent ("Hold to dictate." vs
   "Hold to talk to voix.").
10. First-launch onboarding renders on iOS + macOS; 3 screens;
    `voix.onboarding.completed` persists; subsequent launches skip.
11. macOS: status item in menu-bar with "Talk to voix" + Quit;
    hotkey conflict surfaced.
12. macOS overlay HUD shows puck glyph left of status text;
    pulses on audio.
13. Background-audio smoke executed; result documented in
    `m23-manual.md`.
14. Web regression clean: tone snippets render; settings gear
    visible (daemon URL row hidden on web); PTT + intent dial work.
15. `docs/STATE.md` marks M23 closed; `m23-manual.md` exists.

Out of scope: KeyboardShortcuts SPM swap (M23.5), hotkey rebind UI
(M23.5), sandbox automation entitlement (M23.5), iOS keyboard
extension (M24), Bonjour daemon auto-detect, per-session intent
override, conversational tone gap (M24+ in-session transcript UI).

---

## Coordinator deltas slot

(Empty at write time. Verify trio fills in if material gaps surface
pre-merge. Per §7 of agent-team-workflow: each delta adds an action
item to the relevant Decision + one acceptance criterion. Hard
ceiling: 3 deltas before re-planning.

Researcher's report lands in parallel at
`docs/phase-6/research-m23.md`. If it contradicts Decision 1 (tone
schema) or Decision 3 (voice-driven intent), Coordinator escalates
rather than absorbs — these calls are load-bearing.)
