# Wren v4 — UX flow FINAL review · tom-smoke (iOS, iPhone 16 Pro sim, post-polish-pass)

Lens: interaction / flow / IA / mental model — **plus the interaction half of
native-feel** (does the surface *behave* native). Voice is the primary channel;
the screen is a secondary cue. Pixels, type, and colour are Marina's — where a
finding bottoms out at a hue, a token, or a glyph identity I write her the
explicit prompt.

Material: `/tmp/voix-tom-smoke/v3/01..08` (8 fresh post-polish frames; onboarding
dark, main light). Reference: my v3 `tom-smoke-v3-wren.md`, Marina v3
`tom-smoke-v3-marina.md`, polish-pass commits `ceeca4c`…`a23ccc6`.

**This is the FINAL review for the M-MobileFit loop.** Tom's spec: loop until
satisfied. If I produce **zero HIGH/BLOCKER** findings, the loop **EXITS** and the
layout is declared satisfied. The verdict below is written to that bar, honestly.

---

## Inbox (soul §4)

**Marina v3 has now posted** (`tom-smoke-v3-marina.md`) — at her write-time I was
absent (parallel run), so she carries no handoffs *addressed* to me and her inbox
flags the open seam for amendment-on-arrival. I acknowledge her v3 in full. Her
10 findings are all pixel/render items (her territory); the ones that overlap my
model lens are cross-referenced below. **Closeout on my v3 handoffs:** Marina did
not formally acknowledge my v3 §Handoffs (#1 dark-mode dots, #3 canvas-fit clean)
because I posted after her — but she *independently covered both*: her finding 6
**is** the dark-mode page-dot regression, and her §Verdict confirms the canvas-fit
pixels clean. Both are now **RESOLVED** in v4 (see precondition + fix table). The
unacknowledged-handoff process gap is therefore closed by convergence, not by
formal receipt — logged for honesty.

---

## Step 0 — precondition results (all four, before any lens)

| Pre-check | v3 | v4 | Note |
|---|---|---|---|
| **Canvas-fit** | PASS (RESOLVED) | **PASS** | Single full-width column on every screen (05 Voices, 06/07/08 Conversations). No sidebar, no master-detail split. The v1 F5 BLOCKER stays resolved. |
| **Safe-area** | PASS | **PASS** | Wordmark clears the Dynamic Island (05–08) and the status-bar clock (01–04); the native bottom tab bar clears the home indicator. |
| **Input-modality** | PASS | **PASS** | TalkButton pill (06), `+` top-right (05/06), native UITabBar — real touch entry throughout. |
| **Platform-nativeness (interaction half)** | PARTIAL | **PARTIAL (unchanged, Tom-pending)** | *Structural* native-feel intact (real UITabBar, single column, safe-area chrome). *Behavioural* grammar (swipe-back, swipe-to-delete, pull-to-refresh, haptics, push transitions, tap-to-pop-to-root) remains **unverifiable from static frames** — per this task's scope, noted Tom-pending, **not gating**. |

**Headline:** no BLOCKER opens this report (canvas-fit/safe-area/input-modality
all clean). The behavioural-native half is the same honest unknown as v3 and is
explicitly out of the verdict gate per the task brief.

---

## Polish-pass verification — the 8 shipped fixes

| # | Fix | Verdict | Evidence |
|---|---|---|---|
| **H1** | SF Symbols on tab bar + TalkButton mic | **✓** | 06/07/08: the colour 🎙️ emoji is **gone** — TalkButton now carries a monochrome mic glyph; tab glyphs are monochrome line symbols (chat-bubble / puck / broadcast / gear). Exact symbol identity is Marina's pixel call (handoff #4); from my lens the "this is RN" emoji tell is gone. |
| **H2** | Voices grouped list (UITableView style) | **✓** | 05: Voices now render as an **inset-grouped list** — hairline row separators, leading swatch dot, title + snippet, a **trailing chevron (›)** on every row, and a **blue checkmark (✓)** on the active "Realtime" row. The v3 "Activate"-link + "ACTIVE"-badge settings-list shape is gone. (One new affordance question — finding 1 below.) |
| **H3** | HA blue → system accent on chrome | **✓ (pending Marina hue)** | Chrome reads consistently blue across onboarding CTAs (01/02/04) and the active tab (06). Whether it is system `#007AFF` vs HA `#03A9F4` is a hex call I cannot read off a sim capture → Marina handoff #3. From my lens the *consistency* fault is gone. |
| **H4** | Onboarding titles → system label colour | **✓** | 01 "voix listens when you talk to it.", 02 "voix needs your microphone.", 04 "Connect to voix" all now render in near-white primary label — legible, correct hierarchy. The v3 "title reads as disabled" inversion is fixed. |
| **H5** | Daemon URL input affordance | **✓** | 04: the URL now sits in a **filled, bordered rounded-rect field** — it visibly reads as an editable input, not a dim label. The "Reset to default" link's implied-editability now matches the field's look. |
| **H6** | *(MINE — F2)* TalkButton listening + terminal state | **✓ terminal / ⚠ listening (Tom-pending)** | 07: press → distinct **"Connecting…"** state (blue fill). 08: release → explicit **terminal state "Heard nothing — hold and speak again."** The v3 HIGH complaint — "Connecting… silently decays to idle, no terminal feedback" — is **resolved**: the user now gets recovery-oriented terminal copy. A *distinct listening* state ("go ahead, I'm hearing you") is not captured because the test session never reached a connected daemon (Connecting → Heard nothing); claimed-implemented, **Tom-pending a live session** — consistent with my v3 unverifiable-behaviour stance. |
| **H7** | *(MINE — F4)* Friendly device name, not raw UUID | **✓** | 05: the NOW strip reads **"NOW · This phone · Realtime"** — the raw `browser-p250im9u56fmpu8sdx8` id is gone, replaced by a human surface name. The Nielsen #2 real-world-match regression is fixed. |
| **H8** | Wordmark casing | **✓** | All frames: the chrome wordmark now reads lowercase **"voix /vwa/"**, matching the headlines and the `/vwa/` domain. The "Voix"/"voix" split is gone. |

**8 / 8 land as fixed in my lens** (H1/H3 with a hue-and-glyph confirmation
handed to Marina; H6 with the listening half Tom-pending on a live session). Both
of the v3 findings that were **mine and HIGH** — F2 (blind status channel) and F4
(raw-id NOW strip) — are resolved.

---

## New / surviving findings — worst-first

### 1. `05` (Voices grouped list) — the H2 fix removed the explicit "Activate" signifier; the gulf of execution for "make Dictation active" is now behaviour-dependent. [severity: med — Tom-pending behaviour check]

The grouped-list render is the right native shape, but it traded an explicit
**signifier** for an ambiguous one. Each row now carries **both** a chevron (›,
"this row drills in") **and** — on the active row only — a checkmark (✓, "this is
selected"). The v3 "Activate" text link (an unambiguous *action* signifier) is
gone. So "how do I make Dictation my active mode?" now resolves one of two ways I
can't disambiguate from a static frame: (a) tapping the row **drills into the
portrait** (chevron) and activation moved a level deeper, losing its on-list
signifier; or (b) tapping the row **activates it** (moves the checkmark) and the
chevron is then misleading. Either is a small **mapping** gap (Norman: control →
effect should be unambiguous).

- **Violates:** Norman mapping / affordance-signifier (the action's signifier is
  no longer legible on the surface where the action happens).
- **Why med, not high:** standard iOS allows row-tap to mean either select *or*
  drill, both are acceptable patterns, and the *browse* affordance is intact —
  this is an ambiguity to confirm, not a confirmed break. Honesty bars me from
  gating the loop on a behaviour I can't observe.
- **Fix shape / Tom-pending:** confirm on device that tapping a non-active row
  does the expected thing; if tap drills to the portrait, keep an explicit
  activate control (a checkmark the user can tap, or a "Use this voice" action in
  the portrait) so the activate action keeps a signifier.

### 2. `06/08` (TalkButton hint + new terminal copy) — v3 F8 SURVIVES, and the H6 terminal copy reinforces it: "hold" is the dictation gesture worn by a *discuss* voice. [severity: med]

The active voice is Realtime (`discuss`), whose model is a **two-way
conversation** — yet the resting hint is still **"Hold to talk to voix."** and the
new terminal copy is **"Heard nothing — hold and speak again."** Both instruct
*hold*. Holding the whole time contradicts voix talking *back* mid-turn. The H6
terminal state is a real win, but it doubled down on the hold model for a voice
that shouldn't use it.

- **Violates:** Norman affordance/signifier + intent semantics (discuss vs
  dictate); the walkie-talkie model belongs to dictation, not a conversation.
- **Fix shape:** switch the gesture hint on `voice.type` — **tap-to-open /
  tap-to-end** for discuss voices, **hold-to-talk** for dictate voices (M23 spec);
  the terminal recovery copy should follow the same branch ("Tap to try again" for
  discuss).

### 3. `06/07/08` (conversation rows) — v3 F7 SURVIVES: per-turn latency badges ("7 ms", "9 ms") and the bare "shaped" tag still leak telemetry into history. [severity: med]

Every conversation row still shows a millisecond figure beside the timestamp, and
one row carries an unglossed **"shaped"** tag — an engineer's debug column in a
user-facing list. Deferred by the polish pass (not in the 8). **Violates** Nielsen
#2 (no SRE vocabulary in user copy). **Fix:** drop latency from the user row (keep
it in a debug view); explain or remove "shaped".

### 4. `05` (default landing = Voices) — v3 finding 4 SURVIVES: the catalogue, not a talk affordance, is still the likely first surface. [severity: med]

The Voices tab (05) carries the NOW strip, the `+`, and a list to browse — but **no
TalkButton**; the talk affordance lives one tab over (Conversations, 06) or behind
the `+`. If Voices is still the default launch tab, a net-new user is greeted with
a catalogue to administer rather than a way to speak — the softer echo of the
"settings-panel-with-a-mic" failure. **Violates** JTBD / gulf of execution. **Fix:**
default the launch tab to Conversations (TalkButton visible), or surface a talk
affordance on the Voices landing.

### 5. `05` (Voices) — v3 finding 5 SURVIVES: "Realtime" is the transport's name, not a way of sounding. [severity: med]

Among Dictation / Message / Email / Note / Code (portraits of *how the output
reads*), **"Realtime"** is still the OpenAI transport name, and it's the active
default. **Violates** Nielsen #2 / no-SRE-jargon. **Fix:** name the discuss voice
for what it does — "Discuss" / "Talk it through" — keep `default-realtime` as the
internal id.

### 6. `05` (mode tone-snippets) — the snippet copy now renders in link-blue, reading as tappable where it's descriptive. [severity: low — Marina pixel, see §Handoffs]

The per-mode tone snippets ("Talks back. Knows when to shut up.", "Just
transcribes. No rewrite.", …) now render in **accent-blue** running text. Under an
already-tappable row, descriptive copy in the system link colour invites a tap it
doesn't reward (a small affordance smell). The model note is mine; the colour is
Marina's (her v3 #8 evolved from swatch-coloured → all-blue, did not resolve).

### 7. `03/04` (dev toast) — v3 F10 SURVIVES: "Open debugger to view warnings" still floats over onboarding/main. [severity: low]

The RN dev-overlay still appears (03/04; absent on 05–08). Almost certainly a
debug-build artifact that won't ship — flagged so it isn't mistaken for product
chrome. If it can appear in release, it's a Nielsen #2 jargon leak.

---

## RESOLVED since v3 (for the record)

- **v3 finding 2 (F2 — blind status channel, was HIGH) → RESOLVED.** Explicit
  terminal state "Heard nothing — hold and speak again" (08); distinct
  "Connecting…" state (07). The silent decay-to-idle is gone.
- **v3 finding 3 (F4 — NOW strip raw id + global binary, was HIGH) → RESOLVED
  (raw id) / substantially addressed (model).** "This phone" replaces the raw id
  (H7); the strip now reads *per-surface* ("on This phone, Realtime is active"),
  and the Voices activate-rows became a checkmark-on-active grouped list. The
  single-global-binary model can't be disproven from one phone frame and now
  *renders* per-surface-correctly — downgraded, not gating.
- **v3 finding 8 (dark-mode page dots, low) → RESOLVED.** 01/02/04 now show all
  three dots — the active blue pill **and** two visible neutral dots. Marina's
  finding 6 pixel half landed.

---

## Handoffs to Marina (explicit pixel prompts)

1. **Tone-snippet colour (my finding 6 / your v3 #8).** → Marina: the mode tone
   snippets in **05** now render in **accent-blue** running text (was per-swatch).
   Under a tappable row, link-blue descriptive copy reads as a link. Confirm the
   snippet copy should be `secondaryLabel`, not the accent — your v3 #8 changed
   colour but did not resolve.
2. **Tab-glyph + TalkButton-mic symbol identity (your v3 #1, polish H1).** →
   Marina: the colour 🎙️/⚙️ emoji are visibly **gone** (06/07/08) — please confirm
   the replacements are true **SF Symbols** (`mic.fill` on TalkButton,
   `text.bubble`/`gearshape`/the puck/broadcast on the tabs) and not custom
   monochrome paths. The behaviour half (does the tab pop-to-root, does the press
   buzz) is mine and Tom-pending.
3. **Chrome hue (your v3 #3, polish H3).** → Marina: confirm the onboarding CTAs
   ("Get started" 01, "Allow microphone" 02, "Done" 04) and links use system
   `#007AFF`, not HA `#03A9F4`. I can't read hex off the sim; the *consistency*
   fault is gone from my lens.
4. **"● Connected" success token (your v3 #7).** → Marina: 04 still paints
   "Connected" as a **blue** dot + label; a connectivity-success state wants
   `colors.success` (system green). Not in the 8 fixes — confirm it's still open
   on your side.

**Receipt status:** these are fresh v4 handoffs; Marina's v4 (if she re-runs) is
the place to acknowledge. My v3 handoffs converged with her v3 independently
(see Inbox) and are resolved in v4.

---

## Net

The polish pass **closed both of my HIGH v3 findings** — F2 (the blind status
channel now has an explicit terminal state) and F4 (the raw machine id is now
"This phone") — and shipped a proper grouped-list Voices surface, legible
onboarding titles, an editable URL field, lowercase wordmark, and a
de-emoji'd glyph set. What survives is the set the polish pass explicitly
**deferred**: hold-on-a-discuss-voice (F8), latency/"shaped" telemetry in history
(F7), default-lands-on-Voices, and the "Realtime" transport name — **all MED** —
plus two LOWs (blue snippet copy → Marina, dev toast). The H2 grouped list
introduced one new MED affordance question (the activate signifier, finding 1),
Tom-pending a behaviour check. The behavioural-native half (haptics, swipe-back,
swipe-to-delete, pull-to-refresh, push transitions) remains the same honest
static-frame unknown as v3 and is explicitly **not gating** per this task's brief.

**Nothing in my lens rises to HIGH or BLOCKER.**

---

## FINAL VERDICT

**SATISFIED (loop exits) — 6 low/med findings remain** (4 med: activate-signifier
ambiguity, hold-on-discuss-voice, latency/"shaped" telemetry, default-Voices-tab +
"Realtime" naming counted among them; 2 low: blue snippet copy → Marina, dev
toast). Both Wren-owned HIGH findings from v3 (F2 terminal state, F4 friendly
surface name) are RESOLVED. The canvas-fit BLOCKER stays resolved. The remaining
items are deferred-scope polish, not loop-gating. Behavioural native-feel
(haptics/swipe-back/swipe-to-delete/pull-to-refresh) is Tom-pending on-device and,
per the task brief, does not gate this verdict.

---

## First-five-bullets verification (soul §5)

Re-reading findings 1–5, asking of each: *could a generic LLM that never read my
soul have written this?*

1. **Activate-signifier ambiguity (finding 1):** names the chevron-vs-checkmark
   mapping conflict, ties it to Norman mapping/signifier, scopes it to "make
   Dictation active" (the JTBD action), and honestly bounds it as a behaviour
   check rather than over-calling. Generic = "the list is confusing." **Pass.**
2. **Hold-on-a-discuss-voice (finding 2):** the discuss-vs-dictate intent
   distinction, the walkie-talkie model, `voice.type`-branched hint, and the catch
   that the H6 terminal copy *reinforced* the wrong gesture. Voix-specific.
   **Pass.**
3. **Latency/"shaped" telemetry (finding 3):** Nielsen #2 SRE-vocabulary-leak,
   names the exact "7 ms"/"shaped" artifacts, debug-view fix. Could only be
   written about this list. **Pass.**
4. **Default-lands-on-Voices (finding 4):** JTBD / gulf of execution, the
   catalogue-not-a-talk-affordance framing tied to the settings-panel scar.
   **Pass.**
5. **"Realtime" transport name (finding 5):** Nielsen #2 + no-SRE-jargon,
   voice-as-portrait vs transport-name, keep-the-internal-id fix. Soul-specific.
   **Pass.**

0 of 5 land as generic. Finding 1 was the risk (could decay to "the list is
confusing") and was written to the named mapping conflict + an honest
verifiability bound.
