# M24 Adversary report — Aki (iOS keyboard-extension engineer)

Persona: 9 years on iOS keyboard extensions, 4 shipped, App-Review
scar tissue. I distrust bounce-to-host keyboards, polling-without-
durable-state return detection, and entitlement strings that aren't
matched at the byte level. I verified the implementer's claims myself
rather than taking the report at face value.

Verdict up front: the App Group plumbing is genuinely clean (byte-for-
byte identical entitlements, sane container helpers). But the
**return leg — the half that makes this a dictation keyboard rather
than a launcher — is unsound by construction and 100% untested.** The
implementer honestly marked it Tom-pending, but "pending" undersells
it: as written it will *fail* acceptance criterion 8, not merely go
unverified. Empty High is not defensible here, so it isn't empty.

---

## Receipts

Files read in full (`stat -f "%Sm %z %N"`):

```
May 31 21:07:49 2026  295  clients/app/ios/voix/voix.entitlements
May 31 21:07:54 2026  295  clients/app/ios/VoixKeyboard/VoixKeyboard.entitlements
May 31 21:29:04 2026 13147 clients/app/ios/VoixKeyboard/KeyboardViewController.swift
May 31 21:18:16 2026  5835 clients/app/ios/VoixKeyboard/KeyboardRootView.swift
May 31 21:17:49 2026  1671 clients/app/ios/VoixKeyboard/KeyboardState.swift
May 31 21:17:37 2026  2033 clients/app/ios/VoixKeyboard/CaptureSession.swift
May 31 21:08:05 2026  1376 clients/app/ios/VoixKeyboard/Shared/KeyboardSessionState.swift
May 31 21:08:26 2026  5195 clients/app/ios/VoixKeyboard/Shared/SharedContainer.swift
May 31 21:23:51 2026  6739 clients/app/ios/VoixIOSNative/Sources/VoixKeyboardBridge.swift
May 31 21:23:57 2026   865 clients/app/ios/VoixIOSNative/Sources/VoixKeyboardBridge.m
May 31 21:13:09 2026  1708 clients/app/ios/voix/AppDelegate.swift
May 31 21:12:49 2026  2003 clients/app/ios/voix/Info.plist
May 31 21:24:29 2026  1248 clients/app/ios/VoixKeyboard/Info.plist
May 31 21:26:54 2026 10110 packages/ui/src/conversations/KeyboardCaptureScreen.tsx
May 31 21:15:18 2026  6552 packages/ui/src/App.tsx
May 31 21:08:37 2026  1039 scripts/check-app-group.sh
```

Plus architecture-m24.md, research-m24.md, the implementer report.

### Seeded suspicions — adjudicated

| # | Suspicion | Verdict |
|---|---|---|
| 1 | App Group string mismatch | **CLEARED.** Both `.entitlements` are byte-identical: `md5 = 031894a5973ec2b0252a814c3f70bb81` on each. Both declare exactly `group.co.rowm.voix` (no `Group.`/whitespace/case drift). `check-app-group.sh` greps both. Good. |
| 2 | Data-protection class blocks locked-since-boot read | **CLEARED-with-note.** Code relies on the inherited default (`CompleteUntilFirstUserAuthentication`) and correctly does NOT escalate to `.complete`. It also never *explicitly pins* the class — see L-1. |
| 3 | 60s timeout not wired | **CLEARED, but the Timer is a decoy.** Real enforcement is the *synchronous* elapsed-time check in `consumeBouncedSession` (KVC L204). The `Timer` (L298) can't fire — the extension is suspended the whole bounce. See finding H-2 for why that matters. |
| 4 | `extensionContext.open` blocked for keyboards on iOS 17+ | **UNRESOLVED / untested** — load-bearing and never run on a device. See H-3. |
| 5 | App-Review rejection footprint | **CONFIRMED RISK, no rationale supplied.** See H-4. |
| 6 | Memory budget (RN runtime / heavy SDK snuck in) | **CLEARED.** Podfile adds `target 'VoixKeyboard' do; end` with zero pods; pure Swift + one `UIHostingController`. Current `VoixKeyboard/Info.plist` has no stray `RCTNewArchEnabled`. Idle <30 MB is plausible. |

---

## Findings by severity

### Blockers

None that stop the *build*. The blockers here are runtime/ship
blockers, filed as High because the implementer cannot close them in
this sandbox (no device, no App Review). Flagging the convention so
the Coordinator doesn't read "empty Blockers" as "safe."

### High

**H-1 — The return leg has no durable state; a recycled keyboard
extension silently drops the transcript. (Core flow, acceptance #8.)**

The keyboard's bounce state lives only in memory:
`KeyboardState.phase = .bounced(sessionId, startedAt)` is an
`@Published` on an `ObservableObject` owned by the
`KeyboardViewController` instance. I grepped the whole extension for
any disk persistence — `UserDefaults`, `suiteName`, anything — and
found **none**. Phase is RAM-only.

Now walk the real lifecycle:

1. User taps "Talk to voix". Keyboard writes `pending` to the
   container, sets `phase = .bounced(...)`, calls
   `extensionContext.open(voix://capture…)`.
2. iOS foregrounds the **voix host app** — a full React Native app
   (Hermes/JSC + bridge, tens of MB). The keyboard extension (running
   inside Notes' process) is backgrounded.
3. Keyboard extensions are among the *first* things iOS jettisons
   under memory pressure, and launching a heavy RN app in the
   foreground is exactly that pressure. Termination during the
   ~3–30 s capture window is **likely, not edge.**
4. User returns to Notes. iOS spins up a **fresh**
   `KeyboardViewController` → fresh `KeyboardState` → `phase = .idle`.
5. `viewDidAppear` runs `if case .bounced = state.phase { consume… }`
   — but phase is `.idle`. **`consumeBouncedSession()` never fires.**
   `viewDidLoad` does `probeSharedContainer()` + `sweepOrphans()` but
   **never scans for a `done` session to consume.**
6. The `done` JSON + `.txt` sit in the container until `sweepOrphans`
   deletes them 5 minutes later. The transcript the user dictated is
   **silently lost.** No insert, no toast, idle pill.

The shared-file channel is sound; the bug is that the *trigger* to
read it (`phase == .bounced`) is volatile and isn't reconstructed
from disk on a cold keyboard launch. Fix is small and known-good: on
`viewDidLoad`, scan `keyboard-sessions/` for any non-terminal/`done`
session and resume it (the `pending`/`done` record on disk already
carries `sessionId` + `createdAt`, so timeout math survives too).
Until that exists, acceptance criterion 8 ("keyboard reads + inserts
on return") cannot pass on a real device — it only passes if the
extension happens to survive the entire bounce, which you cannot rely
on. The report's ✅-on-source for #7/#8 is honest about runtime being
pending, but the *design* makes the pending test a likely fail.

**H-2 — Nothing registers `voix-keyboard://`, so the auto-return to
the origin app does not happen.** (UX of the headline flow.)

`returnToKeyboard` (VoixKeyboardBridge.swift L147) calls
`UIApplication.shared.open(URL("voix-keyboard://done?…"))`. I grepped
every plist and source: **no target registers the `voix-keyboard`
scheme.** The architecture (Decision 3) told the implementer to
register it on the extension's Info.plist; the implementer omitted it
— and omitting it is arguably *correct*, because an app extension is
not launchable via `openURL` regardless. There is no configuration of
this design where `UIApplication.shared.open` "bounces the user back
to Notes": `open` launches the app *registered for the scheme*, of
which there is none, so it returns `success = false` and iOS stays in
the voix app. The architecture's premise ("iOS bounces the user back
to the previous app") is simply not how `openURL` works — there is no
public "return to previous app" API on iOS.

Consequence: after capture the user is **stranded in the voix host
app** and must manually swipe back to Notes. `KeyboardCaptureScreen`
even half-admits this ("user can press Home + re-select Notes",
L114-116). Combined with H-1, the manual swipe-back is *also* where
the transcript gets dropped. The manual's step 6 ("Host returns to
Notes after ~3s") describes behavior that will not occur.

This is High not Blocker because it degrades to "manual return" rather
than data loss *by itself* — but it stacks with H-1 into a flow that,
on first device test, produces nothing in the text field.

**H-3 — `extensionContext.open` from a keyboard is the entire
load-bearing assumption and has never been executed.** The architect
explicitly flagged this (Decision 3 escalation clause). Research
asserts it works with Full Access, but the cited sources are general
extension docs, not a keyboard-specific iOS 17/18 confirmation —
keyboard extensions have historically been the *one* extension type
where `open:` behavior is inconsistent. The forward bounce (H-2's
sibling) and the "Open Settings" CTA (H-5) both depend on it. The
implementer wired a `success == false` handler on the forward open
(good — shows "voix host app not found"), so failure is at least
visible, but if `open` no-ops on the target iOS version the keyboard
is dead on arrival. This must be the *first* thing Tom runs on
device, before anything else in the manual.

**H-4 — Single-purpose, zero-key keyboard whose only action launches
another app is the textbook App-Review-rejection pattern, and no
counter-rationale exists.** Guideline 2.5.1 / 4.2 (minimum
functionality): a Custom Keyboard is expected to *be a keyboard*. A
keyboard with no character input that exists solely to bounce to a
sibling app is exactly what App Review has bounced before. The
architecture's Risk 1 names the precedents (Gboard/SwiftKey/Grammarly)
but those ship *full keyboards* and bounce only for secondary
surfaces — the text-expansion/typing IS the primary value, the bounce
is the garnish. voix inverts that: the bounce is the *only* value.
The implementer report adds **no** App-Store-positioning rationale and
no fallback. Per my brief: if there's no answer, the keyboard may
never ship. There's no answer. File it now so it's not discovered at
submission. (Mitigation worth speccing for M24.5: a minimal inline
"type" affordance or framing this as a Dictation companion in the
listing — but that's a product/review-strategy decision, not a code
fix.)

### Medium

**M-1 — `done` + no-speech collapses to a silent no-op; the
"Didn't catch anything" toast can never fire.** `KeyboardCaptureScreen`
finalises an empty capture as `status: "done", transcript: null,
error: "no_speech"` (L158-161, L191-196). The host's `writeSession`
then writes `done` with no `.txt` (transcript nil → the `if let text`
guard skips the `.txt` write, L110-114). On return, the keyboard hits
`applyDone` (KVC L235), `readTranscript` returns nil → `""` → empty,
so `insertText` is skipped and it goes straight to `.idle` with **no
toast.** The carefully-written "Didn't catch anything" copy in
`applyFailed` (L262-264) is unreachable for this path, because the
keyboard only consults `error` on `status == .failed`, never on
`.done`. Net: a no-speech capture looks identical to a crash. Either
send `status: "failed", error: "no_speech"` from the screen, or have
`applyDone` fall back to the toast (and to the JSON `transcript` field)
when the `.txt` is empty.

**M-2 — `.txt` write failure is swallowed and the JSON transcript is
never used as fallback.** Host writes the transcript to `.txt` with
`try?` (VoixKeyboardBridge.swift L112) — errors discarded. The
keyboard reads *only* the `.txt` (`applyDone` → `readTranscript`),
ignoring the `transcript` field that's sitting right there in the
decoded JSON. So a `.txt`-write hiccup (disk pressure, protection
class, races) yields `status: done` + empty insert + no error. The
JSON already carries the text; read from it when `.txt` is missing.

**M-3 — The "Open Settings" CTA in the no-Full-Access state needs
Full Access to work.** The onboarding stack appears precisely when
`!hasFullAccess`; its button calls `extensionContext.open(
openSettingsURLString)` (KVC L330-344). But URL invocation from a
keyboard requires Open Access (== Full Access) to be granted — the
very thing the user hasn't granted yet. So in the state where the
button matters most, it's a dead control: `open` returns false and the
code only `os_log`s it — no fallback, no "this won't work, do it
manually" hint. The onboarding copy does print the literal Settings
path, so the user isn't fully bricked, but the prominent CTA is a lie.
At minimum, detect `success == false` and surface the manual path more
loudly; better, don't render a tappable "Open Settings" when you know
it can't fire.

### Low

**L-1 — Data-protection class is inherited, not pinned.** The code
correctly avoids `.complete`, but it never *explicitly* writes with
`NSFileProtectionCompleteUntilFirstUserAuthentication` either — it
relies on the container default. If anyone later adds an app-wide
"Data Protection: Complete" entitlement to the host, these writes
silently inherit `.complete` and the keyboard loses read access mid-
bounce — the exact failure Decision 2 warns against, reintroduced
through a back door. Pin the class explicitly on `writeState` /
`writeTranscript` so intent is enforced, not assumed.

**L-2 — ISO8601 date interop is correct today but fragile.** Keyboard
encodes `createdAt` via `JSONEncoder.dateEncodingStrategy = .iso8601`
(no fractional seconds); host emits it via `ISO8601DateFormatter()`
(also no fractional seconds) into a `String` field; keyboard decodes
with `.iso8601`. They line up *only* because neither side enables
`.withFractionalSeconds`. The moment one side adds fractional seconds,
`readState` throws and the keyboard treats every session as a read
error. Two duplicated schemas (`KeyboardSessionState` vs
`KeyboardSessionStatePayload`) with a hand-managed contract — the
implementer flagged the duplication; the date-format coupling is the
sharp edge inside it. A shared round-trip test would catch drift.

**L-3 — No explicit input-view height constraint.** SwiftUI root is
pinned to the input view's edges, but the input view itself has no
height set, so the keyboard renders at iOS's default height. Probably
fine, but worth a glance on device — a single-purpose keyboard that
comes up short-framed would clip the globe key (compliance-critical).

### Cleared / non-issues (so the Coordinator knows I checked)

- **App Group entitlements**: byte-identical, correct string. (S-1)
- **Globe key preserved**: `advanceToNextInputMode()` on tap,
  `handleInputModeList(from:with:)` on long-press, 44×44 target,
  bottom-right. User is never stranded on voix. (adversarial task)
- **Empty container on first launch**: idle phase reads nothing;
  `readState`/`readTranscript` return nil cleanly; `consumeBounced`
  only runs post-tap. No spurious error states. (adversarial task)
- **`parseKeyboardCaptureUrl`**: handles both `voix://capture` and
  slashless `voix:capture`, rejects foreign/malformed URLs. Sound.
- **Percent-encoding of `return=`**: custom CharacterSet strips
  `=&+?#/` so the nested URL survives round-trip. Correct.

---

## Tom-day prediction (falsifiable)

**On the first real-device acceptance run (manual step 6), Tom taps
"Talk to voix" in Notes, the voix app opens and records "test entry
one," and then he is left sitting in the voix app — it does NOT
auto-return to Notes. When he manually swipes back to Notes, the text
field is empty: nothing inserts, no toast, just the idle pill.**

Two independent causes, either sufficient: (H-2) `voix-keyboard://` is
unregistered so the auto-return never fires; (H-1) the keyboard
extension is recycled during the RN-app foreground, so the fresh
instance returns with `phase == .idle` and never consumes the `done`
session.

**Falsifier:** add `os_log` to `viewDidLoad` and `viewDidAppear`
printing `state.phase` and an `extensionContext.open` completion log
to `returnToKeyboard`'s caller. If, on return to Notes, the log shows
(a) `returnToKeyboard` opened with `success = true` AND (b)
`viewDidAppear` sees `phase == .bounced` and runs
`consumeBouncedSession` → the prediction is wrong. I expect (a)
`opened: false` and (b) a fresh `phase == .idle`. If the text *does*
land reliably across 5 trials in ≥4 apps, I'm wrong — but I'd bet the
text only ever appears in the lucky runs where the extension wasn't
reclaimed.

---

## Architectural pushback

1. **The whole "bounce back to the previous app" model rests on an
   API that doesn't exist.** There is no iOS API to programmatically
   return the user to the app that was foreground before you. Decision
   3 leans on `UIApplication.shared.open(voix-keyboard://…)` to do
   this; it can't. The honest design is: (a) accept that the user
   manually returns, and (b) make the *keyboard side durable* so that
   whenever it next appears — fresh instance or not — it scans the
   container and inserts any `done` session for the active field.
   That turns H-1+H-2 from "silent loss" into "text is waiting when
   you come back," which is a shippable experience. The current design
   optimizes the cosmetic auto-return (which can't work) and skips the
   durability (which is what actually matters).

2. **The verification trio was told to "focus on the source/logic
   side."** Fine — but that framing let the one genuinely load-bearing,
   unproven assumption (`extensionContext.open` works for keyboards on
   the target OS, end to end) ride entirely on a Tom-pending manual
   step. For a feature whose *entire value* is the bounce, "compiles +
   sim build green" is close to no signal. The first device test
   should be a 10-minute `open:`-smoke (forward open returns true?
   return open returns true? does the extension survive the round
   trip?) *before* the full manual, so a dead `open:` doesn't get
   discovered at step 6 after an hour of setup.

3. **App Review (H-4) is a Phase-6-closing risk parked as "Risk 1" and
   never owned.** Tagging `v0.phase-6` and marking the phase closed
   while the keyboard's shippability is genuinely in question
   overstates done-ness. The source is in; whether Apple will let this
   keyboard exist is unanswered, and nobody wrote down why they think
   the answer is yes.

The plumbing is good work. The problem is that the half that was
sim-coverable is solid and the half that decides whether the feature
exists at all is the half that wasn't run.
