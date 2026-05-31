# Marina's M22 product review

## Receipts

Files read end-to-end:

- `docs/phase-6/verify-briefs/M22-product-marina.md` — my brief
- `docs/phase-6/verify-results/M22-implementer-report.md`
- `docs/phase-6/architecture-m22.md` (Decisions 2, 3, 4, 9, 10)
- `voix-desktop-guide.html` v1.1 (the sober brand source)
- `packages/ui/src/macos/MacOverlay.native.tsx` (267 LOC, end-to-end)
- `packages/ui/src/macos/MacOverlay.tsx` (web sibling — no-op)
- `packages/ui/src/macos/useGlobalHotkey.native.ts`
- `packages/ui/src/App.tsx` (MacOverlay mount)
- `packages/ui/src/conversations/TalkButton.tsx` (intent prop default)
- `clients/app/macos/VoixNative/Sources/VoixOverlay.swift` (panel
  config + NSVisualEffectView + reposition)
- `clients/app/macos/VoixNative/Sources/VoixHotkey.swift` (Carbon
  RegisterEventHotKey, default chord ⌃⌥Space)
- `clients/app/macos/VoixNative/Sources/VoixPaste.swift` (CGEventPost
  + AXIsProcessTrustedWithOptions read-only)
- `clients/app/macos/VoixNative/Sources/VoixAudioPermissions.swift`
  (mic + open-Accessibility-pane)
- `clients/app/macos/voix-macOS/Info.plist`
- `clients/app/macos/voix-macOS/voix.entitlements`
- `clients/app/macos/voix-macOS/AppDelegate.mm`
- `docs/phase-6/m22-manual.md`

Diff sanity for Task 6 (brand continuity):

- `git log --oneline 4cde983..HEAD -- packages/ui/src/components/
  packages/ui/src/lib/theme.ts` → empty. No shared chrome or theme
  touched during M22. The only `packages/ui/src/` files changed are
  inside `macos/` + the one `intent` prop on `TalkButton.tsx` (whose
  default preserves M21 web + iOS behaviour). Clean.

---

## HIG + brand continuity through the macOS shell

### Task 1 — Overlay visual identity

`VoixOverlayPanel` (Swift) ships the right macOS HIG primitives, with
two cosmetic gaps and one missing affordance:

- **Background**: `NSVisualEffectView` with `material: .hudWindow`,
  `blendingMode: .behindWindow`, `state: .active`. That's the right
  call for a Sonoma-era HUD — translucent, dynamic vibrancy, follows
  system appearance light/dark. **Pass.**
- **Corner radius**: 16 pt. Inside the 12-16 pt HIG band the brief
  asked for. **Pass.**
- **Size**: 360 × 96 pt. Thumb-tappable bar's not the right metric on
  macOS (no thumb), but it's pointer-comfortable, readable from the
  menu-bar zone, and matches the Dynamic-Island shape the source code
  comment cites as the reference. **Pass.**
- **Position**: top-center of `NSScreen.main.visibleFrame`, 24 pt
  below the menu bar; recomputed each `showOverlay`. **Pass.**
- **Shadow / borders**: `hasShadow = true`, `isOpaque = false`,
  `backgroundColor = .clear`. Clean. **Pass.**
- **Multi-screen / spaces**: `collectionBehavior` covers
  `.canJoinAllSpaces`, `.fullScreenAuxiliary`, `.stationary`,
  `.ignoresCycle`. Works over fullscreen apps and across space
  switches. **Pass.**
- **Brand glyph**: **the puck glyph is absent**. The HUD shows
  `"Listening…"` + a hint string and nothing else — no puck, no HA-
  blue ring, no audio-detection rings. The desktop brand guide §05
  Screen 01 explicitly says rings emanate "only when audio is
  detected" and the puck *is* the protagonist. M22's HUD is the most
  voix-moment surface in the whole product — it's literally the
  brand-owned moment when the user invokes voix — and yet it has
  zero brand surface area. (See finding **BRAND-1** below.)
- **Dismiss affordance**: ESC is **not bound**; click-outside is
  not handled (the panel is `.nonactivatingPanel` + `canBecomeKey =
  false` by load-bearing design, so it can't receive a click anyway).
  Dismiss is *only* by releasing the hotkey. That matches the
  hold-to-talk model but it means there's no user-facing escape if
  the hotkey state desyncs (e.g. focus stolen, key-up missed). See
  finding **UX-1**.

### Task 2 — Hotkey configuration UX

There is **no settings UI** for the chord. The chord is registered at
boot via `VoixHotkey.register()` and is hardcoded `⌃⌥Space` (key code
`0x31` with `controlKey | optionKey` in `VoixHotkey.swift`).

- The architecture brief said the recorder UI was M23 work and the
  default chord was acceptable for M22. **Pass against the contract,
  with the M23 carry-forward flag below.**
- One nice touch: `useGlobalHotkey.native.ts` logs
  `"voix hotkey: ctrl+opt+space (registered)"` or
  `"… (conflict — chord owned by another app; rebind in Settings
  (M23))"`. A console-only message — Tom sees it in Xcode, not in the
  app. There's no in-app surface where a user could see "hotkey is
  conflicting." See finding **UX-2**.
- The desktop brand guide §05 Screen 05 mocks a Settings → General →
  "Global hotkey" row showing `⌥ Space`. The keyboard glyph shown in
  the guide is `⌥ Space` not `⌃⌥ Space` — minor inconsistency between
  the brand mock and the shipped default chord. Worth a tracking note,
  not a regression (the mock predates Decision 2).

### Task 3 — Accessibility prompt copy

The architect made the explicit decision (Decision 3) to use the
**non-prompting** variant of `AXIsProcessTrustedWithOptions`. That
means voix never triggers the system modal that demands a
quit+relaunch. Instead:

- First press with no Accessibility grant → HUD shows
  `"Copied — grant Accessibility to auto-paste."` (good, voix-considered
  copy — see `MacOverlay.native.tsx:228`).
- 800 ms later → `VoixAudioPermissions.openAccessibilitySettings()`
  fires `x-apple.systempreferences:…?Privacy_Accessibility`. The
  System Settings pane opens directly to the right list.
- This happens **once per app session** (latched by
  `hasOpenedAccessibilitySettings`). Subsequent presses keep working
  in copy-only mode without nagging.

The copy is good. The flow is good. **But:** there is no
"voix-considered explanation BEFORE the user encounters the
behaviour." The user presses the hotkey for the first time, expects
paste, gets the toast + a sudden System Settings window. The first
explanation appears after the first miss. For a Marina-grade product
that's borderline acceptable (the brief itself said "the fallback to
copy-only should feel like a graceful product decision") but it does
fail the "voix offers a user-friendly explanation BEFORE the system
prompt fires" sub-question my brief specifically asked. The mic prompt
gets one (`NSMicrophoneUsageDescription = "voix listens when you talk
to it."` — that's the right voice). Accessibility doesn't. See
finding **UX-3**.

### Task 4 — Menu bar / Dock presence

- `LSUIElement` is **not set** in `Info.plist`. voix is a regular
  Dock-icon + menu-bar app, not a menu-bar-only `LSUIElement` agent.
- There's no `NSStatusItem` anywhere in the macOS sources
  (`grep -r "StatusItem\|MenuBar"` finds nothing in the macOS
  target).
- There's **no first-launch onboarding** anywhere — no welcome
  screen, no "Press ⌃⌥Space anywhere to talk to voix" copy. App
  opens straight to the Voices list (per M20). The hotkey is
  registered silently. A first-time user who didn't read the brand
  guide or the manual will literally never discover the hotkey
  exists.
- This is a meaningful product gap. The whole point of M22 is that
  macOS is *first-class*, and first-class means the user knows the
  primary affordance exists. See finding **UX-4**.

A regular Dock-icon app is probably the right call for M22
(menu-bar-only would surprise users who installed an app expecting an
app window), but it commits voix to the regular-app social contract
— and that contract demands first-launch onboarding for the hotkey.

### Task 5 — Intent semantics on macOS

Architect Decision 10 picked `intent: "dictate"` for the macOS
hotkey-PTT. The code lands it correctly:
`MacOverlay.native.tsx:70` → `intent: "dictate"`. TalkButton's
default stays `"discuss"`, preserving web + iOS behaviour.

The semantics are correct. The user-facing teaching is **absent**:

- The HUD says `"Listening…"` + `"Hold ⌃⌥Space — release to send"`.
  No mention of "dictate" or "speak to type." A user invoking the
  hotkey for the first time has no way to know they're going to get
  pasted text vs. a spoken reply.
- There is no first-run "this is how voix on macOS differs from voix
  on the puck/iOS" explanation.
- Tom's manual (`m22-manual.md`) doesn't explain the dictate-vs-
  discuss distinction either. The phrase "voix is going to paste
  your transcription, not talk back" never appears in any user-
  facing surface.
- The "what happens if the user has no app focused (Desktop)?" edge:
  `cgSessionEventTap` will deliver the Cmd+V to whichever app the
  session thinks is focused, which when Desktop is "focused" is
  Finder. The text will be silently dropped because Finder has no
  text field with a cursor. The clipboard *will* still be written so
  the user can ⌘V into anything later. **Graceful no-op** —
  acceptable, but undocumented. See finding **UX-5**.

### Task 6 — Brand continuity through `react-native-macos` of `@voix/ui`

Clean. `git log --oneline 4cde983..HEAD -- packages/ui/src/components/
packages/ui/src/lib/theme.ts` returns no commits. The only changes to
`packages/ui/src/` during M22 are:

- New: `macos/MacOverlay.{native.tsx, tsx}`, `macos/useGlobalHotkey.
  {native.ts, ts}` — all platform-shimmed; web + iOS get the no-op
  sibling.
- Modified: `platform/audioCapture.native.ts`,
  `platform/audioPlayback.native.ts`, `platform/appInfo.native.ts` —
  all `.native` files, expected.
- Modified: `App.tsx` to mount `<MacOverlay />` (no-op on web + iOS).
- Modified: `TalkButton.tsx` to add the optional `intent` prop with
  the default `"discuss"`, preserving web + iOS behaviour
  byte-for-byte.

No theme tokens, no shared chrome, no regression to the iOS / web
visual contract. **Pass.**

### Task 7 — Tom's manual walkthrough

`docs/phase-6/m22-manual.md` exists, 176 lines, 9 sections. Walking
it as Tom would:

- **Step ordering**: pre-flight → workspace + pods → screenshot
  baseline → start daemon + Metro → run app → load-bearing dictate
  test → interruption smoke → iOS regression → web regression →
  reporting. Logical. **Pass.**
- **Recovery path for Accessibility denial**: Step 5 is explicit —
  "Settings opens automatically (once per session). Toggle voix on.
  Fully quit voix (⌘Q), re-launch from step 4." The quit+relaunch
  requirement is called out. **Pass.**
- **Sample sentence**: Tom is asked to dictate `"hello from voix on
  macOS."` into TextEdit. That's **a smoke-test sentence, not a
  product moment**. The brief's example was "Make me a shopping
  list" — a sentence that demonstrates actual value. The shipped
  manual gives Tom a hello-world which proves the pipe works but
  doesn't show off what dictate is *for*. See finding **UX-6**.
- **Recovery copy elsewhere**: "Recovery — text lands but is the
  previous clipboard → file a follow-up." Honest, good.
- **What's not in the manual that should be**: the "I pressed the
  hotkey but I'm not sure what's about to happen" pre-explanation.
  Step 5 launches straight into the test with no "what dictate
  means" prelude. See finding **UX-3**.

### Task 8 — Watching briefs carried forward

- **Tone gap** — now eight milestones running (was seven at M21
  brief). I keep flagging it; the team keeps not addressing it. The
  whole macOS chrome is system-fonts-sober per the desktop brand
  guide, so the *chrome* tone gap is technically closed by M22 — but
  the conversational tone gap (when voix actually talks) is still
  open. The HUD copy "Hold ⌃⌥Space — release to send" is utilitarian-
  fine but not branded. **Carry to M23.**
- **iOS settings screen for `setApiBase`** — still M23.
- **Intent dial on iOS TalkButton** — still M23. M22's TalkButton
  now *has* an `intent` prop with a `"dictate"` value, which means
  M23's intent dial is now a UI-only delta (the prop wiring is
  already there). Easier ask for M23.
- **macOS hotkey chord settings UI** — confirmed not shipped in
  M22; manual rebind requires a code change. Carry to M23, scoped as
  "swap in `KeyboardShortcuts` SPM package for the recorder UI"
  (Implementer Note A makes this localised).

New watching brief from this review:

- **First-launch onboarding** for the macOS hotkey discoverability
  (Finding UX-4). Carry to M23.
- **Menu-bar `NSStatusItem`** with quick "hold to talk" hint and an
  intent toggle — the architect deferred discuss-via-hotkey to M23
  with a menu-bar item; that item is the natural home for the M23
  intent dial. Carry to M23.

---

## Findings, by severity

### Brand or HIG regressions

**BRAND-1** — *The overlay HUD has zero voix brand surface.*

The HUD is the single most brand-owned moment in the desktop
product — the user presses a chord, voix is summoned, the panel
appears. Per the desktop brand guide §03 ("HA blue · Brand-owned
moments only"), the HUD qualifies for HA blue. Per §05 Screen 01,
the puck "is the protagonist" and rings emanate when audio is
detected. The shipped HUD is a generic macOS notification rectangle
with two text labels and no puck, no HA blue ring on the listening
state, no audio-level pulse. It reads as "macOS notification"
rather than "voix is listening."

Suggested fix (M23): add the puck glyph (filled charcoal square +
HA-blue circle, 28-32 pt) to the left of the status text, and pulse
its inner ring at the audio level during `"listening"`. Keep the
HUD chrome (NSVisualEffectView, neutral text) — only the puck
moment gets brand colour. That's literally the brand guide's
prescription.

**HIG-1** — *No first-launch onboarding for the hotkey.*

Regular-app (non-`LSUIElement`) shells commit voix to the
regular-app social contract: a first-run experience that teaches
the user the app's primary affordance. The macOS app opens to the
Voices list — a screen that has no relationship to the hotkey-PTT
flow. A user who installed voix because they read the brand guide
will figure it out; a user who installed it because someone shared
the app will never know `⌃⌥Space` exists.

This isn't a HIG regression strictly (Apple doesn't require
onboarding) but it is a HIG-zealot violation — the HIG philosophy
is "the user should not need a manual." Tom's manual exists. A
real user's doesn't.

### UX gaps

**UX-1** — *No dismiss affordance besides hotkey release.*

If the key-up event is missed (focus stolen by Mission Control, a
modifier-flag desync, etc.) the overlay stays up indefinitely with
no escape. The architect explicitly chose hold-to-talk semantics so
this is consistent with the model, but a fail-safe ESC handler on
the panel would be cheap insurance. (Note: `.nonactivatingPanel`
+ `canBecomeKey = false` means we can't trap ESC at the window
level; a low-level `CGEvent.tap` for `kCGEventKeyDown` with `0x35`
(ESC) while the panel is visible would work, with the caveat that
that's also Accessibility-gated. Document the limitation if not
shippable.)

**UX-2** — *Hotkey conflict is console-only.*

If another app owns `⌃⌥Space`, the only signal is an Xcode-console
log line. A user without the dev tools open will press the hotkey,
nothing happens, no recovery path. M23's settings screen will close
this, but a *bootstrap* affordance — say, a one-time HUD push
notification on startup if `result.ok === false` — would cover the
gap until then. Or fall back to ⌃⌥V (per the architecture brief's
own suggestion) and surface the active chord in the HUD hint.

**UX-3** — *No pre-explanation of the Accessibility ask.*

The first-press path is: press → speak → release → "Copied — grant
Accessibility to auto-paste." + System Settings appears. The
architect's reasoning for the non-prompting AX check is sound (the
prompting variant demands quit+relaunch). But a user-facing
explanation *before* they hit the wall — even a one-line entry in
a Voices-list footer, or a first-run modal — would close the gap
between "good design" and "voix-considered."

Suggested fix: on first launch, if `isAccessibilityTrusted() ===
false`, surface a non-modal banner in the main window: "voix can
type into your apps when you grant Accessibility. Set it up now."
Banner persists until granted; banner has an "open Settings"
button. That's voix telling the user the situation in voix's voice
*before* the system asks them to act.

**UX-4** — *No first-launch macOS onboarding teaches the hotkey.*

Already covered in HIG-1 but worth restating in the UX-gap column:
the macOS app needs a one-screen first-run explainer that says
"Press ⌃⌥Space anywhere to dictate. Voix types into the app you're
in." Skip-able. Once. That single screen would address UX-3
(Accessibility), UX-5 (dictate semantics), and the brand surface
gap (BRAND-1) all at once.

**UX-5** — *Dictate-vs-discuss distinction is never explained
user-facing.*

The architect's call (Decision 10) — macOS hotkey = dictate, in-app
big-button = discuss — is correct. But the JS / native code is the
only place this distinction exists. Tom's manual doesn't say
"macOS dictates; iOS / web discuss." The HUD doesn't say "I'm going
to paste, not reply." A user invoking the hotkey for the first time
has to guess what voix is about to do.

Suggested fix: include the intent in the HUD's hint text:
`"Hold ⌃⌥Space · dictation mode · release to paste"`.

**UX-6** — *Tom's manual sample sentence is hello-world.*

`"hello from voix on macOS"` proves the pipe works. It doesn't show
what dictate is *for*. The brief specifically asked for a concrete
sentence that demonstrates value. Suggested:

> Step 5 sample: open Notes, hit ⌃⌥Space, say "Tomorrow's groceries:
> oat milk, sourdough, sumac, two bunches of dill." Release. Expect
> a clean line in Notes with no editor cursor fight.

That's a sentence that shows off (a) actual dictation use, (b)
quoted text + punctuation, (c) a recognisable real-world domain. A
test sentence and a demo at the same time.

### Watching briefs

| Brief | Status |
|---|---|
| Tone gap (eight milestones) | M22 partially closes desktop-chrome tone via system-fonts-sober shell; conversational tone gap still open. **Carry to M23.** |
| iOS settings for `setApiBase` | Carried, M23. |
| Intent dial on iOS TalkButton | Carried, M23. Wiring is now trivial — `intent` prop exists. |
| macOS hotkey chord settings UI | Carried, M23. Swap to `KeyboardShortcuts` SPM (Implementer Note A makes this localised). |
| First-launch onboarding for macOS hotkey | **New.** Carry to M23. |
| Menu-bar `NSStatusItem` (M23 host for the intent dial + onboarding nudge) | **New.** Carry to M23. |
| Puck glyph + HA-blue pulse in the HUD (BRAND-1) | **New.** Carry to M23. |
| Accessibility pre-explanation banner (UX-3) | **New.** Carry to M23. |

---

## The one thing the brief should have anticipated but didn't

**That the overlay HUD is a brand-owned moment, and shipping it as
a neutral macOS HUD is the wrong default — even if it's HIG-clean.**

The brief asked me to verify "HA blue usage: only in voix moments
per brand guide; chrome stays neutral." I expected to find the HUD
*with* HA blue and to gate whether it was overdone. Instead the HUD
is *neutral* — it has the chrome treatment, not the voix-moment
treatment. That inversion is the most consequential finding in this
review.

The brief framed the HUD as something the Implementer might
*over-brand* and I should pull them back from. The actual failure
mode is the opposite: the Implementer (correctly) applied chrome
discipline to a surface that the brand guide explicitly excludes
from chrome. The whole purpose of the desktop guide's two-blue split
is that the *single* place HA blue appears in product is the puck +
"the conversation." The HUD is the conversation — it's where voix
visibly arrives and listens. Going system-neutral here is a
brand-discipline overcorrection, and a future verify should have a
"check that voix-moment surfaces actually express the brand" question
in addition to the "chrome stays neutral" question.

Concrete carry-forward: M23's hotkey-overlay polish brief should
include a sub-task: "render the puck glyph in the HUD at 28-32 pt
left of the status text; pulse the inner ring at the audio-level
amplitude during the `listening` status; HA blue only, never the
mode colour, since hotkey-dictate is global and not mode-bound."
