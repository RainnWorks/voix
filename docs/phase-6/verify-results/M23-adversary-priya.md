# M23 Verify — Priya (accessibility-first adversary)

Status: **NOT CLEAN** — 1 Blocker, 3 High, 2 Medium, 2 Low.

The empty Blockers + High slot would have been suspicious for a
milestone introducing 3 new screens + a textbox + a colour-coded brand
treatment. It is not empty.

---

## Receipts

Files read (`stat -f "%Sm %z %N"`):

```
May 31 20:01:49 2026   6433 voix-backend/src/voices/types.ts
May 31 20:02:44 2026  13921 voix-backend/src/voices/builtins.ts
May 31 20:03:41 2026  11230 voix-backend/src/voices/store.ts
May 31 20:06:48 2026   7672 packages/ui/src/voices/VoiceList.tsx
May 31 20:06:59 2026  10111 packages/ui/src/surfaces/SurfaceList.tsx
May 31 20:08:05 2026  12418 packages/ui/src/conversations/TalkButton.tsx
May 31 20:08:29 2026   9025 packages/ui/src/conversations/ConversationList.tsx
May 31 20:10:44 2026   7561 packages/ui/src/settings/DaemonUrlInput.tsx
May 31 20:11:56 2026  17087 packages/ui/src/settings/SettingsScreen.tsx
May 31 20:12:13 2026   7879 packages/ui/src/components/AppShell.tsx
May 31 20:14:08 2026  12152 packages/ui/src/onboarding/Onboarding.tsx
May 31 20:14:23 2026   3497 packages/ui/src/App.tsx
May 31 20:09:21 2026   1119 packages/ui/src/platform/permissions.ts
May 31 20:06:05 2026   6007 packages/ui/src/lib/api.ts
```

`git diff 67b65d5..HEAD` walked: 10 commits, ~1.5 kSLOC net.

Seeded-suspicion verdicts up front:

| # | Seed | Verdict |
|---|------|---------|
| 1 | Onboarding can't replay | **CONFIRMED** — no Reset, no fallback. |
| 2 | HA-blue contrast on bgSubtle | **CONFIRMED FAIL** — 2.49:1 (need 4.5:1). |
| 3 | Settings/Onboarding VoiceOver labels | **CONFIRMED** — zero `accessibilityLabel`/`accessibilityRole` in either file. |
| 4 | `intent: Intent` required at type level | **PASS** — type is required + no runtime default. |
| 5 | Welcome screen focus management | **CONFIRMED** — no focus primitives at all. |
| 6 | Tone `maxLength={80}` + daemon clamp | **PASS** — both sides clamp at 80. |

---

## Findings

### BLOCKER

#### B1 — Tone snippet fails WCAG AA contrast on every card surface

**Seeded #2 confirmed with math.**

The tone snippet (M23 Decision 1's brand moment) renders italic 11pt
`colors.haBlue` (`#03A9F4`) on `colors.bgSubtle`, which is
`rgba(0,0,0,0.025)` composited over `colors.bgElevated` (`#ffffff`).

Effective background colour:
- `0.025 × (0,0,0) + 0.975 × (255,255,255)` = `RGB(248.6, 248.6, 248.6)` ≈ `#f9f9f9`.

WCAG 2.1 relative luminance:
- `#03A9F4` →
  - R: 3/255 → linearised 0.000906
  - G: 169/255 → linearised 0.3937
  - B: 244/255 → linearised 0.9112
  - L = 0.2126·0.000906 + 0.7152·0.3937 + 0.0722·0.9112 = **0.3476**
- `#f9f9f9` ≈ 248/255 → linearised 0.9396 → **L = 0.9396**

Contrast ratio = (0.9396 + 0.05) / (0.3476 + 0.05) = **2.49 : 1**.

WCAG AA requires:
- 4.5:1 for normal-weight body text.
- 3.0:1 for "large" (≥18pt regular or ≥14pt bold). 11pt italic is neither.

**2.49:1 fails AA for body text AND fails AA-Large.** Even AA-AAA-Large
(4.5:1) is 1.8× away.

This isn't subtle. Anyone with mild low-vision, anyone on a glare-y
phone in daylight, anyone with deuteranopia / tritanopia where blue
hue cues are degraded, sees a near-invisible smudge under each voice
name across:
- `packages/ui/src/voices/VoiceList.tsx:243` — `cardTone.color: colors.haBlue`
- `packages/ui/src/surfaces/SurfaceList.tsx:236` — `rowTone`
- `packages/ui/src/conversations/ConversationList.tsx:227` — `rowTone`

It's also a colour-only signal — there's no glyph, no weight contrast,
no other affordance distinguishing tone from `rowDesc`. Strip the
colour (CB-friendly simulation) and the line is just an italic
muted-grey copy with no semantic differentiation.

The architect's Decision 1 rationale ("HA-blue is correct: tone is
voice-identity (brand moment)") is defensible aesthetic intent but
wasn't audited against the bg it lands on. The brand colour is fine
when it's the foreground accent against ink-on-elevated; the moment it
becomes 11pt italic copy it has to clear AA like every other text
node.

**Fix paths (pick one):**

1. Use `colors.ink` (#18181b) for the body of the snippet + reserve
   `haBlue` for an opening 4pt vertical rule or a leading bullet
   character. Keeps the visual identity, lifts the text to ~14:1.
2. Darken `haBlue` to a `haBlueText` token at ~`#0277BD` (Material
   blue 800) — 4.62:1 on `#f9f9f9`. The brand-blue cousin Tom can sign
   off in one Marina round.
3. Drop italic, bump to 12pt + weight 500 + use the existing
   `colors.textBody`. Brand moment moves to the puck glyph instead.

**Severity rationale**: blocker because the WHOLE NEW DECISION 1
brand surface ships at 2.49:1, on every card screen the user opens.
Cannot ship to a public app store with this — App Store reviewers
flag a11y but more importantly the entire "tone is the voice's
identity" thesis fails when 8–12% of users literally can't read it.

---

### HIGH

#### H1 — Onboarding is a one-shot trap with no recovery affordance

**Seeded #1 confirmed.**

`App.tsx:26-38` reads `voix.onboarding.completed`; if `"true"`,
renders `AppShell`; otherwise `Onboarding`. Onboarding's `persistComplete`
(`Onboarding.tsx:86`) stamps `"true"` to AsyncStorage and never
unsets.

`SettingsScreen.tsx` (read in full) has **no "Reset onboarding"
control, no "Re-run setup" CTA, nothing to clear the flag**. Grep:

```
$ grep -n "onboarding\|Reset onboarding\|ONBOARDING" \
    packages/ui/src/settings/SettingsScreen.tsx
(nothing — only the file-level comment mentions Risk 4)
```

Failure modes:

1. **Pre-grant gauntlet skip**. User taps "Skip setup" on screen 1
   (they thought it was an ad). Flag → `true`. They land on Voices
   with no mic permission, no daemon URL, no idea how to surface the
   3 screens again.
2. **Half-skipped flow**. User accepts mic, then on screen 3 (daemon
   URL) the URL probe stays `unreachable` (wrong subnet). `canDone`
   gate (`Onboarding.tsx:233`) allows them through with a soft hint
   ("voix will work as soon as it's reachable"). Flag → `true`. User
   never finds Settings to fix the URL because… see B-list issue
   below: Settings has no `accessibilityLabel` on the gear, so a
   VoiceOver user just hears `"Button"`. Even sighted users may not
   recognise `⚙` (Linux-y, not iOS-native — the iOS default is the
   pill / Settings app icon).
3. **Stale install across daemon move**. Tom shuffles the daemon to a
   new box. Settings → daemon URL works (he can edit it). But there's
   no "let me see the welcome again" — onboarding is gone for the
   lifetime of the install.

**Architect's Risk 3 said exactly this**: "Settings is a sidebar
Section (Decision 2) — does NOT depend on `voicesApi.list()` to
render. Daemon URL row works offline. 'Reset to default' button next
to the field." That's there. But it doesn't help a user who never got
through screen 2 (mic deny) and now is stuck on Conversations with
the talk button erroring at every press.

**Fix**: add an "About → Reset setup" row in Settings (or an "Advanced"
collapsed group) that clears `voix.onboarding.completed` and
hard-bounces to `<Onboarding>`. ~6 lines. Pair with `onboarding.completed`
being read on `AppState change → active` (not only on mount) so the
re-show happens without a relaunch.

#### H2 — Zero accessibilityLabel / accessibilityRole on every new screen

**Seeded #3 confirmed.**

```
$ grep -rn "accessibilityLabel\|accessibilityRole\|accessible=" \
    packages/ui/src/settings/ packages/ui/src/onboarding/ \
    packages/ui/src/conversations/TalkButton.tsx
(no output)
```

That's 25+ tap targets shipping with VoiceOver naming defaults that
are wrong for every one of them:

**Onboarding.tsx**:
- `Pressable` "Skip setup" → VoiceOver: "Skip setup" (text inside —
  passes by accident).
- `Pressable` "Get started" → ditto.
- `Pressable` "Allow microphone" → ditto.
- `Pressable` "Open settings" (deny path) → "Open settings" (which
  settings? voix? iOS? VoiceOver gives no role hint).
- `Pressable` "Skip for now" → ditto.
- `Pressable` "Done" → "Done" with no context — VoiceOver doesn't
  speak "button" because RN doesn't infer button role on a
  `Pressable` containing a `Text`.

The label-from-Text fallback works for SIMPLE cases but:
- **None get role="button"** — VoiceOver doesn't say "Done, button",
  it just says "Done". The user doesn't know it's interactive without
  the swipe hint.
- **No state semantics** — the disabled "Done" Pressable on
  `Onboarding.tsx:246` (`disabled={!canDone}`) is dimmed visually
  (`ctaDisabled: { opacity: 0.5 }`) but exposes no
  `accessibilityState={{ disabled: !canDone }}` so VoiceOver users
  hear "Done" and try to activate; nothing happens.

**SettingsScreen.tsx**:
- VoicePicker chips (`SettingsScreen.tsx:336`): just the voice name,
  no `role="radio"` / `accessibilityState={{ selected }}` so blind
  users can't tell which voice is currently the default. The visual
  `chipSelected` style is colour-only differentiation.
- "Open settings" Pressables (lines 189, 200, 229) — at least three
  of these on the same screen, none labelled, none telling VoiceOver
  whether they open iOS Settings or macOS System Settings or voix's
  own settings (the user is ALREADY in voix's settings).
- "Re-prompt" (line 200) — VoiceOver reads "Re-prompt". Re-prompt
  what?

**DaemonUrlInput.tsx**:
- `TextInput` (line 128) has no `accessibilityLabel`. Just placeholder.
  VoiceOver reads "Text field, http://192.168.99.86:8765/" — the
  placeholder gets confused as the value when the field is empty.
- "Reset to default" Pressable has no role.
- `StatusIndicator` is a `View` + `Text` with no `accessibilityLiveRegion`
  on the label, so the "Probing… / Connected / Unreachable" state
  change is silent for VoiceOver users.

**Fix scope**: ~25 props, ~30 lines. The Wordmark + Puck on the
welcome screen also need `accessibilityRole="header"` and
`accessibilityLabel="voix — push-to-talk voice assistant"` so the
hero block names itself.

#### H3 — Daemon URL has no validation, no error state, no malformed-input copy

**Adversarial task #3 — confirmed.**

`packages/ui/src/platform/appInfo.native.ts:59-62`:

```ts
async setApiBase(url: string): Promise<void> {
  apiBaseCache = url;
  await storage.setItem(API_BASE_KEY, url);
}
```

Zero validation. Whatever the user types persists. `DaemonUrlInput`'s
`handleBlur` (line 110) just calls `setApiBase(url)`.

Real cases the user types and the daemon stores:
- `http://` → `${base}api/voices_count` becomes `http:///api/voices_count`
  → fetch fails ambiguously → "Unreachable" → user confused, no copy
  explains why.
- `foo` → no protocol → fetch attempts `foo/api/voices_count` →
  fetch rejects → "Unreachable" again.
- `https://localhost` → "Unreachable" on a device that isn't
  localhost (i.e. all iPhones). No copy says "localhost only works on
  the simulator."
- `http://192.168.0.1` (typo of 99.1) → "Unreachable" forever, looks
  like the user's network is down, no nudge to recheck the URL.

The `unreachable` indicator is the *same* error state for all of
these — "Couldn't probe." There's no `URL.parse(url)`-style sanity
check, no "this URL is malformed" red dot, no inline correction
suggestion. The Onboarding `DaemonStep` even tells the user "voix
will work as soon as it's reachable" — completely wrong copy when the
URL is malformed (it WON'T work, the URL is broken).

**Fix**: a 4-line sanity check that requires `https?:\/\/[^/]+/?` at
the input level, plus a separate "Malformed URL" indicator that's
distinct from "Unreachable." Bonus: warn on `localhost` /
`127.0.0.1` on iOS devices (not simulator) since that's the #1 wasted
hour for new users.

---

### MEDIUM

#### M1 — Welcome screen does not focus its heading; VoiceOver lands on Skip first

**Seeded #5 confirmed.**

`Onboarding.tsx::Welcome` (line 146) renders, in order:
1. `Wordmark` + `Puck` in `heroRow` (no `accessibilityRole="header"`).
2. `Text` title "voix listens when you talk to it." (no `accessibilityRole="header"`).
3. `Text` body.
4. `Pressable` "Get started".

But the surrounding `Onboarding` shell (line 105) ALWAYS renders the
`Skip setup` Pressable in the header — visually top-right, but in
DOM-order it's the **first** focusable element on the screen.

Apple HIG: "When a new view appears, move focus to the most
informative element — typically the heading or the primary action."

Today, VoiceOver on first render:
1. Reads the wordmark (unlabelled component, just says "voix" if
   Wordmark's text content reads as a label).
2. Reads "Skip setup" → user thinks the whole app is a skip option.
3. Reads "voix listens when you talk to it." → finally informative.

No `useEffect` calls `AccessibilityInfo.setAccessibilityFocus(handle)`
on the title; no `accessibilityElementsHidden={true}` on the skip in
the first-pass focus order; no `autoFocus` on the CTA. Same pattern
on screens 2 and 3.

**Fix**: ref the title `Text`, on mount `findNodeHandle` →
`AccessibilityInfo.setAccessibilityFocus`. Per-step. ~5 lines.

#### M2 — Default-voice picker silently breaks when the chosen voice is deleted

**Adversarial task #2 — confirmed.**

`SettingsScreen.tsx::handleSetDefaultVoice` (line 113) persists
`voix.settings.default_voice_id`. The UI then computes:

```ts
const activeVoiceId = devices[0]?.voiceId;
```

(line 140) — note: the override is only USED in the empty-name
fallback at line 168 and the chip value at line 173. The actual
device assignment is via `devicesApi.setVoice(device.deviceId,
voiceId)`.

Deletion path: user opens VoiceList → swipes / deletes voice X →
`voicesApi.delete(X)` succeeds (X was not built-in). voix-backend
`deleteVoice` (`store.ts:279`) **does not check whether X is
referenced as a device's `voiceId`**. The device row keeps
`voiceId: X`. Next PTT:

- `ConversationList.tsx:99` —
  `activeVoice?.type === "dictation" ? "dictate" : "discuss"`.
  `activeVoice` is `voiceById[X]` → `undefined` (X is gone). `intent`
  silently falls back to `"discuss"`.
- The TalkButton call goes through with whatever voice id the device
  thinks it has, OR the daemon's `/api/voices_count` probe finds
  nothing.
- On the daemon side: a session with `voice_id: X` against a missing
  voice — looking at how `voicesApi.update` errors with "cannot
  update unknown voice" (line 252) — the session likely errors with
  a decline that surfaces as "voix couldn't start this session."

**Fix paths:**
1. Daemon-side: `deleteVoice` should refuse if any device references
   the voice, OR cascade-update to the default. Mirror the
   builtin-refusal at line 282-284.
2. UI-side: Settings.Default voice should listen to
   `voicesApi.list()` changes and silently re-fall-back the
   `defaultVoiceOverride` to a still-existing voice (or
   `DEFAULT_VOICE_ID`).

Today neither happens. The override sits in AsyncStorage pointing at a
voice that doesn't exist. The next PTT shows "Something went wrong"
and the user has no clue why.

---

### LOW

#### L1 — Voice with `type: null` or unknown enum value falls back silently to `discuss`

**Adversarial task #1.**

`ConversationList.tsx:99`:

```ts
const intent: Intent = activeVoice?.type === "dictation" ? "dictate" : "discuss";
```

`MacOverlay.native.tsx` hardcodes `"dictate"` (independent path).

If a voice on disk has `type: null` (legacy?) or `type: "assist"`
(architect's types.ts:36 mentions this), the strict equality fails
and intent becomes `"discuss"` — TalkButton opens a realtime session,
which the daemon may decline if the voice isn't realtime-configured.
No crash, but a silent semantic regression.

It's a Low because the daemon's normalisation should guarantee
`type ∈ { "realtime", "dictation" }` for any voice in the cache — but
I didn't find a normaliser that hard-rejects unknown types at load
time. `normalisePhasePrompts` (store.ts:86) doesn't touch `type`.
Recommend asserting on load or a runtime fallback to a sane
`discuss`/`dictate` based on `donePrompt` presence.

#### L2 — DaemonUrlInput docstring lies about HTTP method (HEAD vs GET)

`DaemonUrlInput.tsx:9` says:

> Debounced 600 ms after edits, fires `HEAD ${url}api/voices` to
> decide the indicator state.

The actual fetch (line 73) is an implicit GET (no `method:` option) to
`api/voices_count`. Two divergences: GET-not-HEAD, and
`voices_count`-not-`voices`. Architect's Decision 2 spec was "HEAD
`${base}api/voices`". The implementer switched to GET probably
because RN/web `fetch` HEAD is finicky cross-origin, and to
`voices_count` because it's a tiny payload. Both calls are fine; the
comment is just stale.

Cosmetic, but the kind of drift that bites the next implementer
trying to write a server-side probe stub.

---

## Architectural pushback

**The brand-colour-as-text problem is going to keep biting.** This is
the *third* place (M22 puck pulse → was OK because it's a glyph;
M23 tone snippet → fails AA; the daemon URL "Connected" green dot at
`DaemonUrlInput.tsx:165` also uses `colors.haBlue` for the status
label, which is going to fail too against bgSubtle).

Decision: `colors.haBlue` should be classified as an **accent /
fill** colour, NOT a text colour. Introduce
`colors.haBlueText` = `#0277BD` or similar — anchored at 4.5:1
against `bgElevated` — and use that anywhere haBlue currently lands
as a foreground text node. The pulse, the puck, the chip-fill, the
buttons-bg all keep `haBlue`; only the text changes.

That's a 5-line theme.ts change + replaceAll across ~6 call sites,
catches B1 + L2's stale-comment-mismatch territory + future-proofs
M23.5's chord-recorder UI.

**Onboarding flag pattern is one-way; needs a reset surface.** Risk
4 covered "user denies mic + comes back" but not "user skipped
entirely + can't replay." A flag that only persists in one direction
is a footgun for every cold-start QA flow including Tom's manual
step 2 (`xcrun simctl uninstall …`) — the only way Tom can re-run
onboarding today is to uninstall the app. Settings → Reset is the
cheapest fix.

**Required-prop pattern from Decision 3 worked.** Adversarial check
on `intent: Intent` vs `intent?: Intent`: confirmed required at TS
level (`TalkButton.tsx:53`); no runtime `intent ?? "discuss"`
fallback inside the body. Both callers
(`ConversationList.tsx:104,117` + `MacOverlay.native.tsx`) pass
explicitly. This is the right shape for new required props — adopt
for any future "must-pass" semantics.

---

## Tom-day prediction (falsifiable)

**The thing M23's manual smoke will reveal: Tom hits step 4
(walk onboarding) on the iPhone 16 Pro sim, the welcome screen's
tone snippet on the very next step (step 5 voice cards) is so faint
on the iPad-bright sim that Tom asks "is the tone field actually
rendering?" — opens Safari, inspects via Metro debug, sees the
italic light-blue text is there but illegible.**

He'll either ask "did Marina sign off on the colour?" (no — Decision
1 specified haBlue without contrast math) or quietly bump the colour
darker before the demo and never re-open the call.

Falsifiable: if Tom completes step 5 of `m23-manual.md` and the
manual reports "tone snippets render correctly" without mentioning
the contrast, prediction failed.

**Second-likeliest miss**: Tom tap-throughs onboarding to get to
voices fast, taps "Skip setup" on screen 1, lands on Voices. Mic
permission was never requested. Step 5 PTT fails. Tom looks for "Re-
do onboarding" in Settings, can't find it, opens Xcode, deletes the
app, reinstalls. Files a friction note. (See H1.)

---

## Summary table

| ID | Severity | One-liner | File(s) |
|----|----------|-----------|---------|
| B1 | Blocker | Tone snippet 2.49:1 contrast (need 4.5:1) on every card | VoiceList:243, SurfaceList:236, ConversationList:227 |
| H1 | High | Onboarding flag is one-way; no Settings "Reset" | App.tsx:36, SettingsScreen.tsx (absence) |
| H2 | High | Zero accessibilityLabel/Role on 25+ tap targets | settings/, onboarding/, DaemonUrlInput |
| H3 | High | No URL validation; malformed URLs silently persist | appInfo.native.ts:59, DaemonUrlInput.tsx:110 |
| M1 | Medium | Welcome screen doesn't focus heading; Skip catches focus first | Onboarding.tsx:105,146 |
| M2 | Medium | Default-voice override survives voice deletion → broken PTT | SettingsScreen.tsx:113, store.ts:279 |
| L1 | Low | `voice.type` outside {realtime,dictation} silently → "discuss" | ConversationList.tsx:99 |
| L2 | Low | DaemonUrlInput docstring claims HEAD; actually GET to voices_count | DaemonUrlInput.tsx:9,73 |

**Recommend**: do not close M23 without addressing **B1** (the
brand-colour text-contrast tax is a ship blocker for the App Store
Connect accessibility nutrition label) + **H1** (one-shot
onboarding is a known QA / re-test footgun). H2 + H3 can land in
M23.5 if they're scoped + tracked.
