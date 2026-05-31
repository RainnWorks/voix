# Marina v3 — UI-craft review, Phase 6 iOS smoke re-run (post-M-MobileFit)

> Lens: pixels, type, colour, spacing, brand-glyph fidelity, native control
> & glyph fidelity, layout-fit, state legibility. **Not** flow / IA / mental
> model (Wren's). Disposition (ship/hold/fix) is the coordinator's — this is
> a punch list. Surface under review: the **app** (onboarding dark + main
> light), iPhone 16 Pro sim, fresh clean-install run. Marketing exemptions
> do not apply here.
>
> **This is a verification pass.** M-MobileFit shipped to fix the v1
> canvas-fit BLOCKER. The headline question — *did the BLOCKER resolve?* — is
> answered in the precondition block and again, explicitly, in the closing
> §Verdict.

## Inbox

- **Wren v3 (`tom-smoke-v3-wren.md`): ABSENT at write time.** Checked at start
  and at close — file not yet present. No inbound handoffs to acknowledge or
  refute. **If Wren's v3 lands, this section must be amended** with an
  explicit accept/refute per handoff (`soul.md` §4) — flagging the open seam
  rather than silently dropping it (the exact tom-smoke miss).
- Carry-over from v1: Wren handed me **F5 truncation pixels** ("Talks back.
  Knows…", "ACTIV[E]", "puck-1 · Realtime" clipped) and **F9 page-dot
  contrast**. Both are re-checked below against the fresh frames — F5
  truncation is **RESOLVED** (canvas-fit fixed); F9 is **NOT** resolved in
  dark mode (finding 6, a regression of the attempted fix).

## Precondition result (soul §3 — all four checks)

| Pre-check | v1 | v3 | Result |
|---|---|---|---|
| 0a **Canvas-fit** | **FAIL** (220px sidebar + master-detail split on a 393pt phone; content squeezed to ~60%, copy clipped mid-word) | **PASS** | ✅ **RESOLVED** |
| 0b **Safe-area** | **FAIL** (wordmark at the status-bar / Dynamic Island row; OS clock bleeding through) | **PASS** | ✅ **RESOLVED** |
| 0c **Input-modality** | (not separately filed) | **PASS** (CTAs are large pills ≥44pt; tab items read ≥49pt) | ✅ |
| 0d **Native-feel (visual)** | (lens not yet in soul at v1) | **PARTIAL — not a BLOCKER, but high-severity findings** | ⚠️ findings 1–2 |

**0a Canvas-fit — RESOLVED.** Frame **04** renders a single **full-width**
content pane: no sidebar, no master-detail split. The truncation that was the
BLOCKER's pixel receipt is gone — "Talks back. Knows when to shut up." reads
end-to-end, and the NOW pill shows the **full** session id
"browser-p250im9u56fmpu8sdx8 · Realtime" with no clip. The desktop split is
correctly reserved for the wide canvas (per implementer report). **The wrong
design is no longer on the screen.**

**0b Safe-area — RESOLVED.** The "Voix /vwa/" wordmark now sits **below** the
Dynamic Island in **04/05/06/07** (the black pill is clear above it) and well
below the status-bar clock in onboarding **01/02/03** (clock 23:5x at the top
row, wordmark a third of the way down). The bottom tab bar sits **above** the
home indicator. Chrome clears every region the OS owns.

**0d Native-feel — PARTIAL.** *Judgment call, and I am deliberately NOT firing
a native-feel BLOCKER* (`soul.md` §Failure-modes, "Native-feel over-fire").
The surface has genuine iOS scaffolding: a **real `UITabBar`** (not faked
tabs), **SF Pro** system type throughout (not a smuggled webfont), the system
accent `#007AFF` driving chrome selection (active "Conversations" tab), and
correct safe-area insets. It does **not** wholesale read as a generic-RN
shell. But the **glyph vocabulary and one list pattern are not native**
(findings 1–2), so 0d is a *partial* pass with high-severity findings, not the
clean pass the other three checks earn.

**No BLOCKER opens this report.** Findings run worst-first by severity, then
by §Method lens priority. Each is tagged **[NEW]** (a v3 / native-feel finding)
or **[CARRIED]** (a v1 colour/type item left out of M-MobileFit's scope and
re-confirmed present in the fresh frames — listed compactly, not re-litigated).

## Receipts — finding → evidence frame

| # | Finding (short) | Tag | Evidence frame(s) |
|---|---|---|---|
| 1 | Emoji & custom glyphs where SF Symbols belong | NEW | 05/06/07 (🎙️ TalkButton + ⚙️ Settings, ◇ Surfaces, ▤ Conversations tabs) |
| 2 | Voices rendered as a Card stack, not a grouped TableView | NEW | 04 |
| 3 | HA blue worn as chrome on onboarding CTAs / connect links | CARRIED (#1) | 01/02 (Get started / Allow microphone), 03 (Done, Reset, Connected) |
| 4 | Onboarding titles render as disabled text | CARRIED (#2) | 01, 02, 03 |
| 5 | Daemon-URL field styled as a label, no input affordance | CARRIED (#3) | 03 |
| 6 | Page-dot "fix" invisible in dark mode (regression) | NEW (verif.) | 01, 02, 03 |
| 7 | "Connected" painted in brand blue, not a success token | CARRIED (#4) | 03 |
| 8 | Mode tone-snippets set as swatch-coloured running text | CARRIED (#6) | 04 |
| 9 | Debugger toast occludes the new bottom tab bar | CARRIED (#8) | 04 |
| 10 | Wordmark casing "Voix" vs headline "voix" | CARRIED (#11) | all frames (chip) vs 01/03 (titles) |

Note: I read hue off a simulator capture, so I name the *structural* colour
fault, not a pixel-exact hex. Glyph-identity findings (1) are confirmable
against the component source; the render is the evidence and it is enough to
log.

---

## Findings — worst-first

1. **[NEW] TalkButton + bottom-tab glyphs (05/06/07) — the icon vocabulary is
   colour emoji and hand-drawn shapes, where SF Symbols exist.** The primary
   "Talk to voix" CTA — the product's front door — carries the **🎙️ studio
   microphone EMOJI** (a full-colour skeuomorphic Apple glyph), not the SF
   Symbol `mic.fill`. The **Settings** tab carries the **⚙️ gear EMOJI**
   (metallic shading, an emoji not `gearshape`). **Surfaces** is a custom
   outline **◇ diamond**; **Conversations** is a custom **▤ lined-square**.
   Three of four tab glyphs — and the single most important button on the
   surface — are emoji/custom where the system ships the symbol. Only the
   **Voices** puck is a sanctioned custom glyph (the brand mark, exempt).
   Native-feel lens (§0d / lens 5) + the "custom glyph where an SF Symbol
   exists" red flag, applied at the worst possible spot (the CTA). An emoji
   on the primary affordance is the loudest "this is an RN app, not an iOS
   app" tell on the screen. Fix: `mic.fill` on the TalkButton, `gearshape`
   for Settings, `square.on.square`/`rectangle.on.rectangle` for Surfaces,
   `bubble.left`/`text.bubble` for Conversations — all SF Symbols, tinted to
   match state; keep only the puck custom. [severity: high]

2. **[NEW] Voices list (04) is a stack of individually-bordered Cards, where
   iOS would render an inset-grouped `TableView`.** Each voice (Realtime,
   Dictation, Message, Email, Note) is its own rounded-rect card with a full
   border and an inter-card gap — no section header, no hairline row
   separators, no row chevron, and an "Activate" **text link** standing in
   for a native row accessory / trailing control. This is the signature
   "Card-stack-of-rows" generic-RN tell verbatim. (Contrast the Conversations
   list in 05/07, which is closer — rows with hairline separators — and shows
   the app *can* render a native list.) Native-control-fidelity lens (lens 5)
   + the "list rendered as a Card stack" red flag. Fix: render Voices as an
   inset-grouped `FlatList`/`TableView` — one section, hairline 0.5px
   separators, the swatch dot as the leading accessory, a checkmark on the
   active row (not an "ACTIVE" badge + per-row "Activate" link), and a chevron
   if the row drills in. [severity: high]

3. **[CARRIED #1] Onboarding CTAs & connect-screen links wear HA blue
   (`#03A9F4`) as generic chrome.** "Get started" (01), "Allow microphone"
   (02), "Done" / "Reset to default" / the "● Connected" label (03) are all
   the bright cyan HA blue — the colour the brand reserves for the *voix
   moment* (the puck, the listening state). M-MobileFit correctly routed the
   **active-tab** tint to system `#007AFF` (good — confirmed in 05/06/07), but
   the onboarding buttons and connect links were out of its scope and still
   spend the reserved blue as button chrome. When the TalkButton later lights
   blue to mean "listening," it is the same family as every onboarding button
   already pressed. Colour-discipline lens / brand §9 ("HA blue is a costume,
   not a wardrobe"). Fix: route onboarding CTAs + links to system accent;
   reserve `#03A9F4` for the puck + listening/connecting state only.
   [severity: high]

4. **[CARRIED #2] Onboarding titles (01 "voix listens when you talk to it.",
   02 "voix needs your microphone.", 03 "Connect to voix") render in a near-
   black grey on the black background — the screen title is the *least*
   legible text on the screen and reads as disabled.** 01 and 02 are the same
   resting state, not a fade frame. Hierarchy is inverted: the only element
   with presence is the blue CTA. Out of M-MobileFit's scope; still present.
   Hierarchy + colour-discipline lens (de-emphasise the secondary, don't
   flatten the title to one grey). Fix: title → primary system `label`
   (near-white in dark mode); body → `secondaryLabel`. [severity: high]

5. **[CARRIED #3] Daemon URL (03, "http://192.168.99.86:8765/") is styled as
   plain dim grey text — no border, no fill, no focus affordance — yet it is
   the one editable field on the screen.** The "input styled to look like a
   label" red flag, unchanged. "Reset to default" implies it's editable, so
   the field must *look* editable. Component-composition lens / HIG controls.
   Fix: a grouped-fill or bordered text-field treatment with a visible focus
   ring. [severity: high]

6. **[NEW / verification] Onboarding page indicator (01/02/03) still renders
   as a single orphaned blue pill in dark mode — the M-MobileFit "real 3-of-N
   dots" fix did not land on the surface it ships on.** The implementer set
   inactive dots to `rgba(0,0,0,0.2)` (black at 20% alpha). On the **black**
   onboarding background that is mathematically invisible — confirmed by
   brightening the dot band to **20× gain**, at which only the single cyan
   active pill appears and *no* neutral dots resolve. The fix is correct for a
   light background and a no-op for the dark one it actually renders against.
   Colour + composition lens; a dark-mode contrast regression of the intended
   fix. Fix: drive the inactive dot colour from a system fill that adapts to
   the colour scheme (`rgba(255,255,255,0.25)` in dark / `tertiaryLabel`),
   not a hard-coded black alpha. [severity: med]

7. **[CARRIED #4] "● Connected" (03) is painted in brand blue (blue dot + blue
   label) instead of a semantic success colour.** A connectivity-success
   state is exactly what `colors.success` (system green) is for; blue both
   mis-codes the meaning and piles onto finding 3's blue overuse. Colour-
   discipline lens (state colours are semantic tokens, never the accent). Fix:
   system green dot + label. [severity: med]

8. **[CARRIED #6] Mode tone-snippets (04: "Talks back. Knows when to shut
   up.", "Just transcribes. No rewrite.", "Crisp messages. No fluff.", …) are
   set in each mode's swatch colour as running text.** Colour identity already
   lives on the icon dot; tinting the copy too turns the list into a stack of
   differently-coloured sentences and fights restraint. Hierarchy + colour-
   discipline lens. Fix: snippet copy in `secondaryLabel`; let the swatch
   appear only on the dot. [severity: med]

9. **[CARRIED #8] The "Open debugger to view warnings" dev toast (04) floats
   as a full-bleed dark bar over the bottom edge — and now overlaps the new
   bottom tab bar.** M-MobileFit added the tab bar at the bottom inset; the RN
   dev toast sits on top of it (visible in 04; absent in 05/06/07, so it's an
   intermittent dev-overlay artifact, almost certainly debug-build-only). Its
   trailing affordance is still an empty grey circle with no glyph. Layout /
   composition lens. Flagging so it isn't read as product chrome and so the
   tab-bar collision is on record; weight low pending confirmation it's
   debug-only. [severity: low]

10. **[CARRIED #11] Wordmark casing is inconsistent: the chrome chip reads
    "Voix" (title-case) while every headline lowercases "voix".** One product,
    two capitalisations of its own name. Brand-fidelity lens. Fix: the
    lowercase "voix" the headlines and the `/vwa/` domain already use.
    [severity: low]

---

**Net.** 10 findings — 5 high, 3 med, 2 low. **The v1 canvas-fit BLOCKER is
RESOLVED** (see §Verdict). The new spine is **native-feel**: the surface is
now structurally a native iOS shell (real tab bar, SF Pro, system accent, safe
areas) but wears **colour emoji and hand-drawn glyphs where SF Symbols belong**
(1) and renders **Voices as a Card stack instead of a grouped TableView** (2) —
two high-severity native-feel findings that did *not* rise to a precondition
BLOCKER, but are the loudest remaining "RN, not iOS" tells. The carried colour/
type items (3–5, 7, 8, 10) are exactly the set M-MobileFit declared out of
scope, re-confirmed present. One attempted fix regressed in dark mode (6).

---

## §Verdict — is the v1 canvas-fit BLOCKER resolved?

**YES. RESOLVED.** Both halves of the v1 BLOCKER are gone in the fresh frames:

- **Canvas-fit (0a):** the phone now renders a **single full-width column**
  (04). No 220px sidebar, no master-detail split, no ~60% squeeze. The
  truncation receipts — "Talks back. Knows…", "ACTIV[E]", "puck-1 · Realtime"
  clipped — are all gone; the same strings render in full. The desktop split
  is correctly gated to the wide canvas.
- **Safe-area (0b):** the wordmark clears the Dynamic Island (04/05/06/07) and
  the status-bar clock (01/02/03); the bottom tab bar clears the home
  indicator.

The fix landed. M-MobileFit did what it set out to do, and it did not
introduce a canvas-fit or safe-area regression. The findings above are all
*lens-level* (native-feel, colour, type, one dark-mode dot regression) — none
re-opens the BLOCKER, and none is itself BLOCKER-severity. **My v1
verdict-overriding BLOCKER no longer stands.**

---

## First five bullets — §5 self-test

*Could a generic LLM that never read this soul have produced this finding — no
named location, no SF Symbol / system token, no brand rule?* "Yes" = generic.
**≥3 "yes" → rewrite.**

| # | First-five finding | Generic-LLM possible? | Why |
|---|---|---|---|
| 1 | Emoji/custom glyphs where SF Symbols belong | **No** | Names the exact emoji (🎙️/⚙️) on the exact controls, the SF Symbol each should be (`mic.fill`, `gearshape`, `square.on.square`, `text.bubble`), and the puck-only glyph exemption. A generic pass says "use consistent icons," not "an emoji on the primary CTA is the loudest RN tell." |
| 2 | Voices as a Card stack, not a grouped TableView | **No** | Names the `TableView`/`FlatList` target, the missing section header / hairline separators / chevron, the "Activate"-link-not-accessory fault, and cross-checks against the Conversations list that *does* render native. The "Card-stack-of-rows" red flag verbatim. |
| 3 | HA blue as chrome on onboarding CTAs | **No** | "Costume not wardrobe" brand rule, `#03A9F4` vs `#007AFF`, the listening-state-can't-signal argument, and credit that the active-tab tint was *correctly* fixed. Generic = "use a consistent accent." |
| 4 | Onboarding titles render as disabled | **No** | Inverted hierarchy, the `label`/`secondaryLabel` system ramp, frame 01/02 as a resting-state receipt. Generic = "improve contrast." |
| 5 | URL field styled as a label | **No** | The "input styled to look like a label" red flag, focus-ring/grouped-field fix, the "Reset to default implies editable" cross-check. Generic = "make the field clearer." |

**Tally: 0 of 5 generic.** All five carry a frame reference, a named
SF-Symbol/system/brand unit, and a point of view a generic model wouldn't
volunteer. Rewrite threshold (≥3) not met.

---

## Self-check (soul §rubric)

1. **All four pre-checks + inbox before lens 1?** Yes. Inbox logged (Wren v3
   absent, amend-on-arrival flagged). Precondition block runs 0a–0d before any
   finding. Canvas-fit and safe-area both **pass** (no BLOCKER opens the
   report — correct, the surface now fits its canvas). Native-feel is a
   *partial* pass: high findings (1–2), **deliberately not** escalated to a
   BLOCKER per the over-fire failure-mode (real `UITabBar` + SF Pro + system
   accent mean it isn't a wholesale generic-RN shell). The judgment is stated,
   not buried.
2. **First-five not generic?** 0/5 generic (table above).
