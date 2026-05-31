# Wren v3 — UX flow re-review · tom-smoke (iOS, iPhone 16 Pro sim, post-M-MobileFit)

Lens: interaction / flow / IA / mental model — **plus the interaction half of
native-feel** (does the surface *behave* native: push nav, swipe-back, sheets
with detents, tab-bar behaviour, pull-to-refresh, haptics, swipe-to-delete).
Voice is the primary channel; the screen is a secondary cue. Pixels, type, and
colour are Marina's — where a finding bottoms out at a hex value, a contrast
token, or a font I write her the explicit pixel prompt and verify receipt.

Material: `/tmp/voix-tom-smoke/v2/01..07` (fresh install + onboarding, dark
mode). Reference: my v1 `tom-smoke-wren.md`, Marina v1 `tom-smoke-marina.md`,
`M-MobileFit-implementer-report.md`. Marina v3 is running in parallel and had
not posted at the time of writing — handoff receipt is an open closeout item
(see §Handoffs).

---

## Inbox (soul §4)

No Marina v3 report exists yet (parallel run), so there are no fresh inbound
handoffs to acknowledge. From Marina **v1**, her standing pixel items (#2
disabled-looking onboarding titles, #3 URL-field-as-label, #4 "Connected" in
brand blue, #6 colour-coded tone snippets) were explicitly **out of
M-MobileFit scope** and I can confirm from the frames they all **still render
unchanged** — they remain hers, not re-litigated here. My v3 has one **new**
pixel handoff to her (the dark-mode page-dot invisibility, §Handoffs).

---

## Step 0 — precondition results (all four, before any lens)

| Pre-check | v1 | v3 | Note |
|---|---|---|---|
| **Canvas-fit** | **FAIL (BLOCKER, F5)** | **PASS — RESOLVED** | Single-column, full-width content pane on every main screen; the fixed conversation sidebar is gone; the conversation list became a bottom tab. One context owns the screen at a time. |
| **Safe-area** | FAIL (Marina pixel) | **PASS** | Header (`Voix /vwa/` wordmark) now clears the Dynamic Island / status bar on onboarding (01–03) and main (04–07). The OS clock no longer bleeds through the wordmark. |
| **Input-modality** | FAIL (F1: `+New` bound to `⌘N`) | **PASS — RESOLVED** | `+` top-right is wired (AX "New conversation") and a persistent "Talk to voix" button lives on the Conversations tab. The phone has a real touch entry now. |
| **Platform-nativeness (interaction half)** | n/a in v1 | **PARTIAL** | *Structural* native-feel **resolved** (native bottom UITabBar + single-column + safe-area chrome — the canonical iOS shape). *Behavioural* grammar (swipe-back, swipe-to-delete, pull-to-refresh, haptics, push transitions, tap-to-pop-to-root) is **unverifiable from 7 static frames** and several reflexes appear absent. See finding 1. |

**Headline verdict:** the v1 **F5 canvas-fit BLOCKER is RESOLVED**, and with it
the safe-area and input-modality pre-checks. There is therefore **no opening
BLOCKER** in this report. The native-feel pre-check has flipped from a
*structural* fail (a desktop layout forced on a phone — the generic-RN gestalt)
to a *behavioural* punch list: the surface now **looks** like an iOS tab-bar
app; whether it **behaves** like one is the open question, and one I cannot
close from screenshots.

---

## Acknowledgements — v1 findings RESOLVED by M-MobileFit

- **F1 (dead `+New conversation` front door) — RESOLVED.** The `+` top-right
  (04/05/06/07) carries AX "New conversation" and is wired to land on the
  Conversations surface with the TalkButton showing. The gulf-of-execution
  front door now has a handle.
- **F5 (iPad/desktop master-detail split on iPhone) — RESOLVED (was BLOCKER).**
  The two-competing-nav-contexts violation is gone: full-width single column,
  sidebar retired into a bottom tab. *Marina's pixel half is also clean* — the
  mid-word truncation receipts ("Talks back. Knows…", "ACTIV[E]") no longer
  clip; 04 renders "Talks back. Knows when to shut up." in full.
- **F3 (net-new user has no path to talk) — RESOLVED via F1 + the tab bar.**
  The Conversations tab now carries a persistent "Talk to voix" button at the
  top, and `+New` routes there. The catalogue-first dead-end is gone. *(Minor
  residue folded into finding 4 below: the default landing tab is Voices, which
  has no TalkButton — the user must tap `+` or the Conversations tab.)*

---

## Findings — worst-first

### 1. `05/06/07` (Conversations tab + rows + TalkButton) — the surface now *looks* native, but the iOS interaction reflexes are unconfirmed and several appear absent. [severity: high — requires on-device verification]

The structural win is real: a native bottom UITabBar (Conversations / Voices /
Surfaces / Settings) replaced the desktop sidebar. But native-feel is a
*behaviour*, not a layout, and the behaviours the user's hands already own are
not visible in static frames — and the frames that exist suggest gaps:

- **Conversation rows show no swipe-to-delete affordance.** A history list is
  exactly where the thumb reaches to swipe a row away (the iOS destructive-red
  action). Nothing in 05/06/07 confirms the rows honour it.
- **No pull-to-refresh** signifier on the history list — the gesture the user
  tugs for on any iOS list.
- **Haptics on the talk beat are unverifiable.** TalkButton press
  (`impactMedium`) and session-open (`success`) are the two beats where the
  user needs to *feel* the press registered on a voice surface. Cannot confirm
  from images; must be tested.
- **Push-nav + swipe-back on row drill-in is unverifiable.** Tapping a
  conversation row should **push** (slide-from-right) into the conversation
  with a native back button and the swipe-back edge gesture. The frames don't
  capture the transition.
- **Tab-bar tap-to-pop-to-root** (re-tapping the active tab returns to its
  root) — unconfirmed.

**Violates:** `soul.md` §3 #4 native-feel (interaction half); HIG *Gestures* /
*Navigation* / *Playing haptics*. **Why this is high, not a BLOCKER:** the
*gestalt* is no longer generic-RN — it's a recognizable iOS tab-bar app missing
specific gestures, which is a punch list, not the foundational fail F5 was.
**Fix shape / verification ask:** confirm on a physical device (the sim can't
prove haptics): swipe-to-delete on conversation rows, pull-to-refresh on the
list, `impactMedium` on TalkButton press + `success` on session-open,
slide-from-right + swipe-back on row drill-in, tap-to-pop-to-root on the tab
bar. Each absent one is its own native-feel finding once observed.
*The visual half of native-feel — whether the rows render as a TableView vs
Cards, faked vs real controls — is Marina's (§Handoffs).*

### 2. `06`→`07` (idle → "Connecting…" → idle) — v1 F2 SURVIVES: after the press the user still can't tell whether voix is listening, ended, or heard nothing. [severity: high]

The press cycles "Talk to voix" → "Connecting…" → straight back to "Talk to
voix." There is **no distinct listening state** ("go ahead, I'm hearing you")
and **no terminal state** ("Heard nothing — hold and speak again" / "Done").
On the phone there is no puck LED or chime, so the screen is the *only* status
cue — and it shows only *connecting*, then silently decays to idle. M-MobileFit
explicitly deferred this. It remains the killer flow's blind status channel.

- **Violates:** Nielsen #1 (visibility of system status), the reflexive
  heuristic for a voice product — **listening must be distinguishable from
  connecting, replying, and failed**, or the user talks into a dead session and
  never learns it heard nothing.
- **Fix shape:** a distinct **listening** state once the session opens, and an
  explicit **terminal** state on close; never let "Connecting…" decay silently
  to idle.

### 3. `04` (NOW strip) — v1 F4 SURVIVES and regressed in copy: the single global ACTIVE strip now shows a raw machine surface id. [severity: high]

The strip reads **"NOW · browser-p250im9u56fmpu8sdx8 · Realtime"**. Two
problems compound: (a) it's still a **single global active/NOW binary** that
assumes one surface (the v1 F4 model fault — design-brief §7 wants per-surface
active-mode, deferred by M-MobileFit), and (b) the surface is now identified by
a **raw generated id** (`browser-p250im9u56fmpu8sdx8`) where a human surface
name belongs. The Voices list below it is still the activate-rows / "ACTIVE"
badge settings-list shape, not a portrait gallery (also F4, deferred).

- **Violates:** Nielsen #2 (match to the real world — a raw id is SRE plumbing,
  not user language); design-brief §7 (per-surface active-mode); red flags
  "Activate as a global binary" and "a NOW · device · mode strip that assumes
  one device."
- **Fix shape:** per-surface active-mode ("in use on: ‹surface›"), and render
  the surface by a human name, never the raw `browser-…` id.

### 4. `04` (default landing = Voices tab) — the app opens on the catalogue, not on a talk affordance. [severity: med]

A fresh launch lands on **Voices** (activate-rows), which has no TalkButton —
only the NOW strip, the `+`, and a list to *administer*. The talk affordance
lives one tab over (Conversations) or behind the `+`. F3's dead-end is fixed,
but the *default* surface still greets a net-new user with a catalogue to
configure rather than a way to speak — a softer echo of the
"settings-panel-with-a-mic" failure.

- **Violates:** JTBD / gulf of execution (the user hired voix to *speak through
  it*, and the first screen asks them to pick from a list).
- **Fix shape:** default the launch tab to Conversations (TalkButton visible),
  or surface a talk affordance on the Voices landing too.

### 5. `04` — v1 F6 SURVIVES: "Realtime" is the transport's name, not a way of sounding. [severity: med]

Among Dictation / Message / Email / Note (portraits of *how the output reads*),
"Realtime" is still the OpenAI Realtime API transport name, and it's the ACTIVE
default. Deferred by M-MobileFit. **Violates** Nielsen #2 / no-SRE-jargon.
**Fix:** name the discuss voice for what it does — "Discuss" / "Talk it
through" — keep `default-realtime` as the internal id.

### 6. `05/06/07` — v1 F8 SURVIVES: "Hold to talk to voix" is the dictation gesture on a discuss voice. [severity: med]

The active voice is Realtime (`discuss`), whose killer model is a *two-way
conversation*, but the hint is still the fixed dictation/walkie-talkie "Hold to
talk to voix." Holding the whole time contradicts voix talking *back*. M23
specced the hint to switch on `voice.type`; deferred. **Violates** Norman
affordance/signifier + intent semantics (discuss vs dictate). **Fix:**
tap-to-open / tap-to-end for discuss voices, hold-to-talk for dictate.

### 7. `05/06/07` — v1 F7 SURVIVES: per-turn latency badges ("7 ms", "9 ms") and the bare "shaped" tag still leak telemetry into history. [severity: med]

Every conversation row still shows a millisecond figure beside the timestamp,
and one row carries an unglossed "shaped" tag — an engineer's debug column in a
user-facing list. Deferred. **Violates** Nielsen #2. **Fix:** drop latency from
the user row (keep in a debug view); explain or remove "shaped".

### 8. `01/02/03` (page indicator, dark mode) — v1 F9 SURVIVES *in dark mode*: only the active pill is visible; the user still can't read "step X of 3". [severity: low — Marina pixel, see §Handoffs]

M-MobileFit drew three dots, but in dark mode only the active blue pill shows —
the two inactive dots are invisible on the near-black background. The user
still can't tell their position in the sequence. **Violates** Nielsen #1
(visibility). The model finding is mine; the cause is a contrast token →
Marina (§Handoffs).

### 9. `03` — F10 SURVIVES: "Open debugger to view warnings" dev toast still appears. [severity: low]

The RN dev-overlay still floats over onboarding/main on some frames (03; absent
on 05–07). Almost certainly a debug-build artifact that won't ship — flagged so
it isn't mistaken for product chrome. If it can appear in release, it's a
Nielsen #2 jargon leak ("debugger", "warnings").

---

## Handoffs to Marina (explicit, with receipt-verification pending)

1. **New (v3) — dark-mode page-dot invisibility (finding 8).** → Marina: on the
   onboarding page control (frames 01/02/03, **dark mode**), only the active
   blue pill is visible — the two inactive dots use a **black-based alpha**
   (`rgba(0,0,0,0.2)` per the M-MobileFit report, fix `e`) which is invisible
   on the near-black onboarding background, so the 3-of-N indicator still reads
   as **one orphaned marker** in dark mode. Confirm the inactive-dot token is
   **theme-aware** (a light neutral on a dark background) and not a fixed black
   alpha. This is the pixel cause of my finding 8.

2. **Native-feel visual half (finding 1).** → Marina: I own the *behaviour*
   (does the row swipe, does the press buzz, does drill-in push); you own the
   *rendering* — whether the conversation rows render as a native grouped
   **TableView** vs Cards, whether the tab-bar glyphs are SF Symbols vs custom,
   whether "Connecting…" uses a typographic ellipsis on one line (your v1 #7).
   Please confirm the row/control rendering when you re-run.

3. **Canvas-fit pixel half — now clean (please confirm).** → Marina: the v1
   truncation receipts ("Talks back. Knows…", "ACTIV[E]", "puck-1 · Realtime"
   clipped) that were the pixel evidence for the F5 BLOCKER are **resolved** in
   04 (full copy renders, full-width pane). Please confirm in your v3 that the
   squeezed-pane geometry and mid-word clipping are gone so we can jointly close
   the BLOCKER.

**Receipt status:** Marina v3 had not posted at write-time, so none of these
three are acknowledged yet. **Open closeout item:** verify Marina v3 picks up
handoff #1 (dark-mode dots) and #3 (canvas-fit pixels clean) — an
unacknowledged handoff is a logged process failure (`soul.md` §4), the exact
gap that sank the original tom-smoke pass. Coordinator: please ensure Marina v3
sees this §.

---

## Net

The M-MobileFit pass fixed the two things that most broke the product on a
phone: the **canvas-fit BLOCKER (F5) is RESOLVED** — single-column, full-width,
native bottom tab bar, safe-area chrome — and the **dead front door (F1) is
RESOLVED**, which also reopens the talk path (F3). What survives is everything
M-MobileFit explicitly deferred: the **blind status channel** (F2 — no
listening/terminal state), the **single-global NOW strip now showing a raw
machine id** (F4, regressed copy), and the voice-naming / gesture / telemetry
nits (F6/F7/F8). The new question the fix *opens* is **behavioural native-feel**
(finding 1): the surface now looks native, but swipe-to-delete, pull-to-refresh,
haptics, and push/swipe-back are unverifiable from screenshots and must be
tested on a device. Disposition is the coordinator's.

**Critical verdicts (as required):**
- **v1 F5 canvas-fit BLOCKER: RESOLVED.**
- **Platform-nativeness: structural half RESOLVED (native tab bar + single
  column + safe-area); behavioural half UNVERIFIED — downgraded from BLOCKER to
  a high punch list pending on-device test (finding 1).**
- **Survived M-MobileFit:** F2 (high), F4 (high, +raw-id regression), F6/F7/F8
  (med), F9-dark-mode (low), F10 (low) — all matching the implementer's
  declared out-of-scope list.

---

## First-five-bullets verification (soul §5)

Re-reading findings 1–5, asking of each: *could a generic LLM that never read my
soul have written this?*

1. **Native interaction grammar (finding 1):** names the specific iOS reflexes
   (swipe-to-delete, pull-to-refresh, `impactMedium`/`success` haptics,
   slide-from-right + swipe-back, tap-to-pop-to-root), distinguishes the
   *behaviour* half (mine) from the *render* half (Marina's), and honestly
   bounds what static frames can prove. A generic pass says "make it feel
   native"; this enumerates the gestures and scopes the verdict. **Pass.**
2. **F2 survives (no listening/terminal state):** Nielsen #1 voice-first, the
   listening-vs-connecting-vs-failed distinction, screen-as-only-cue on a
   no-puck phone. Voix-specific. **Pass.**
3. **F4 raw-id NOW strip:** design-brief §7 per-surface model, Nielsen #2
   real-world match, the two named red flags, and the specific `browser-…` id
   evidence. Could only be written about this product. **Pass.**
4. **Default-lands-on-Voices (finding 4):** JTBD / gulf of execution, the
   "catalogue not a talk affordance" framing tied to the settings-panel scar.
   **Pass.**
5. **F6 Realtime-name survives:** Nielsen #2 + no-SRE-jargon, voice-as-portrait
   vs transport-name. Soul-specific. **Pass.**

0 of 5 land as generic. Finding 1 was the risk (could decay to "feel native")
and was written to its named gestures + an honest verifiability bound rather
than an adjective.
