# Marina v4 — UI-craft FINAL verification, Phase 6 iOS smoke (post-polish-pass)

> Lens: pixels, type, colour, spacing, brand-glyph fidelity, native control &
> glyph fidelity, layout-fit, state legibility, **visual native-feel**. **Not**
> flow / IA / mental model (Wren's). Disposition is the coordinator's — this is
> a punch list. Surface: the **app** (onboarding dark 01–04 + main light 05–08),
> iPhone 16 Pro sim, fresh clean-install run. Marketing exemptions do not apply.
>
> **This is the FINAL review of the M-MobileFit loop.** The polish-pass shipped
> 8 HIGH fixes (commits `ceeca4c`…`a23ccc6`) against my v3 + Wren's v3. Per Tom's
> spec ("go in a loop until they're satisfied"), if this pass finds zero HIGH or
> BLOCKER findings, the loop EXITS. The verdict is in §FINAL VERDICT.

## Inbox (soul §4)

Wren v3 (`tom-smoke-v3-wren.md`) **is present** this round — three explicit
handoffs to me. All three **acknowledged and verified RESOLVED**:

1. **Dark-mode page-dot invisibility (Wren f8 / my v3 #6).** → **RESOLVED.** On
   01/02/03 (dark) the page control now renders the active blue pill **plus two
   visible neutral-grey inactive dots** on the near-black background. The fixed
   black-alpha token is gone; the 3-of-N indicator reads as three markers. The
   pixel cause I owned is fixed.
2. **Native-feel visual half (Wren f1).** → **VERIFIED CLEAN.** Conversation
   rows render as a native list with hairline separators (06/07/08); the
   Voices list is now an inset-grouped TableView (05); tab-bar glyphs are SF
   Symbols (06); "Connecting…" uses a single-line typographic ellipsis (07).
   Every render item Wren handed me is native.
3. **Canvas-fit pixel half (Wren f5 / BLOCKER receipts).** → **CONFIRMED
   CLEAN.** Full-width single column, no squeezed pane, no mid-word truncation
   (05 renders "Talks back. Knows when to shut up." end-to-end). The BLOCKER's
   pixel receipts stay closed. We jointly close the BLOCKER.

No unacknowledged inbound handoffs remain.

## Precondition result (soul §3 — all four checks)

| Pre-check | v3 | v4 | Result |
|---|---|---|---|
| 0a **Canvas-fit** | PASS | **PASS** | ✅ single full-width column, desktop split gated to wide canvas |
| 0b **Safe-area** | PASS | **PASS** | ✅ wordmark clears Dynamic Island (04–08) + status clock (01–03); tab bar clears home indicator |
| 0c **Input-modality** | PASS | **PASS** | ✅ CTAs are pills ≥44pt; tab items ≥49pt |
| 0d **Native-feel (visual)** | ⚠️ PARTIAL (2 HIGH) | **PASS** | ✅ real UITabBar + SF Symbols + inset-grouped TableView + SF Pro + system accent — the two v3 HIGH native-feel tells are gone |

**0d flips from PARTIAL → PASS.** The two high-severity native-feel findings
that defined my v3 spine — emoji/custom tab glyphs (v3 #1) and a Voices
Card-stack (v3 #2) — are **both resolved** (see table below). The surface no
longer carries any "RN, not iOS" visual tell. **No BLOCKER opens this report,
and no precondition is even partial.**

---

## Polish-pass verification table (the 8 HIGH fixes)

| # | Fix | Status | Evidence |
|---|---|---|---|
| **H1** | SF-Symbol glyphs (tab bar + TalkButton mic) replace emoji | **✓** | 06: TalkButton carries a **monochrome `mic.fill`** glyph (no colour 🎙️). Tab bar: Conversations = speech-bubble SF Symbol, **Voices = brand puck (exempt)**, Surfaces = `dot.radiowaves` SF Symbol (was custom ◇), **Settings = outline `gearshape`** (was metallic ⚙️ emoji). No emoji residue anywhere. |
| **H2** | Voices as inset-grouped TableView (not card stack) | **✓** | 05: one rounded-rect container, **0.5px hairline row separators**, leading swatch-dot accessory in a squircle tile, **trailing row chevron on every row**, and a **blue checkmark on the active "Realtime" row** (replacing the "ACTIVE" badge + per-row "Activate" link). The signature Card-stack tell is gone. |
| **H3** | HA blue → system accent on chrome; HA blue reserved for voix moments | **✓** | 01 "Get started", 02 "Allow microphone", 04 "Done" / "Reset to default" now render in **system blue `#007AFF`** (royal, not cyan). HA cyan `#03A9F4` survives only on the **puck dot** (chip + hero), the **"NOW" label** (05), and the **Connecting state** (07) — all legit voix moments. |
| **H4** | Onboarding titles → high-contrast system `label` | **✓** | 01 "voix listens when you talk to it.", 02 "voix needs your microphone.", 04 "Connect to voix" now render **full-contrast white**; body copy correctly demoted to `secondaryLabel` grey. The inverted hierarchy is corrected. |
| **H5** | URL field gets a real input affordance | **✓** | 04: the daemon URL now sits in a **filled, rounded-rect text field** (visible darker fill + corner radius) — reads as editable, no longer a bare dim label. |
| **H6** | TalkButton distinct listening + explicit terminal state | **✓** (within sim limits) | Three **distinct** states captured: idle (06, white pill / black mic), **Connecting…** (07, blue-tinted pill, blue border, blue mic + ellipsis), and an **explicit terminal line "Heard nothing — hold and speak again"** (08) instead of silent decay to idle. The sustained *listening* state isn't capturable (sim has no mic; session closes fast) but is in `e8250c5`; connecting + terminal are confirmed pixel-distinct. Wren f2's "blind status channel" is addressed on the render side. |
| **H7** | NOW pill shows "This phone", not raw UUID | **✓** | 05: pill reads **"NOW · This phone · Realtime"** — the raw `browser-p250im9u56fmpu8sdx8` id is gone, replaced by a human surface name. |
| **H8** | Wordmark chip lowercase "voix" | **✓** | All frames: chip reads **lowercase "voix /vwa/"**, matching the headlines and domain. The v3 "Voix" title-case inconsistency is gone. |

**8 / 8 fixes verified ✓.** No fix regressed; no fix introduced a canvas-fit or
safe-area regression. Bonus: my v3 #6 (dark-mode page dots) and v3 #10 (wordmark
casing) — both deferred carry-overs — also landed.

---

## New / surviving findings — worst-first

No BLOCKER. No HIGH. The remaining items are all carried colour-discipline
items that were out of the polish-pass's stated scope, re-confirmed present.

1. **[CARRIED MED] "● Connected" (04) is still painted in brand blue, not a
   semantic success colour.** The connectivity-success indicator (dot + label)
   renders in blue where `colors.success` (system green) belongs. A reachability
   success is exactly what the success token is for; blue mis-codes the meaning
   and re-spends the reserved family. Colour-discipline lens (state colours are
   semantic tokens, never the accent). Fix: system-green dot + label.
   [severity: med]

2. **[CARRIED/MORPHED MED] Voices subtitle snippets (05: "Talks back. Knows when
   to shut up.", "Just transcribes. No rewrite.", …) render in accent blue, not
   `secondaryLabel` grey.** My v3 #8 flagged these as *per-swatch coloured*
   running text; the polish-pass unified them — but to a **single accent blue**,
   not to the neutral secondary label a grouped-list subtitle should use. Blue
   body copy in every row reads as tappable/link text and fights restraint
   (Refactoring UI: de-emphasise the secondary). The swatch identity already
   lives on the leading dot. Colour + hierarchy lens. Fix: subtitle copy →
   `secondaryLabel`; reserve colour for the dot. [severity: med]

3. **[CARRIED LOW] "Open debugger to view warnings" dev toast (03/04/05) still
   floats over the bottom edge and overlaps where the tab bar sits (05).**
   Present on 03/04/05, absent on 06/07/08 — an intermittent RN dev-overlay
   artifact, almost certainly debug-build-only. Flagged so it isn't read as
   product chrome and the tab-bar collision is on record. [severity: low]

---

**Net.** 8/8 polish-pass fixes landed cleanly. The v3 spine — two HIGH
native-feel tells (emoji glyphs, Voices card-stack) plus three HIGH carried
colour/type items (onboarding CTAs in HA blue, disabled-looking titles,
label-styled URL field) — is **fully resolved**. The surface now reads as a
genuine iOS app: real UITabBar with SF Symbols, inset-grouped TableView, SF Pro
type, system accent on chrome with HA blue correctly costumed to the puck /
NOW / connecting beats, high-contrast titles, an editable URL field, a
human-named NOW pill, and a TalkButton with distinct connecting + terminal
states. What remains is 2 MED + 1 LOW, all colour-token / debug-artifact polish
— none re-opens a precondition, none is HIGH.

---

## §FINAL VERDICT

**SATISFIED (loop exits) — 3 low/med findings remain (2 med, 1 low), no high or
above.**

The v1 canvas-fit BLOCKER stays resolved; all four preconditions PASS (0d
native-feel flipped PARTIAL → PASS); all 8 polish-pass HIGH fixes verified ✓;
all three Wren v3 handoffs acknowledged and confirmed resolved. The only
surviving items are 2 MED colour-discipline nits ("Connected" should be success
green; Voices subtitles should be `secondaryLabel` not accent blue) and 1 LOW
debug-build toast. **The M-MobileFit layout loop can close from the UI-craft
side.**

---

## First-five-bullets self-test (soul §5)

*Could a generic LLM that never read this soul have produced this finding — no
named location, no SF Symbol / system token, no brand rule?* "Yes" = generic.
**≥3 "yes" → rewrite.** (Findings here are few, so the five = the 3 findings +
the two load-bearing verification calls H1/H2.)

| # | Item | Generic? | Why |
|---|---|---|---|
| 1 | H1 verified: `mic.fill` / `gearshape` / `dot.radiowaves` SF Symbols, puck exempt | **No** | Names each glyph's SF Symbol and the puck-only exemption; a generic pass says "icons look consistent now." |
| 2 | H2 verified: inset-grouped TableView, 0.5px hairlines, leading swatch accessory, active checkmark vs "Activate" link | **No** | Names the exact native-list anatomy and the accessory it replaced. |
| 3 | "Connected" should be `colors.success` not the accent | **No** | State-colour-is-a-semantic-token rule + the specific frame; generic = "use green." |
| 4 | Voices subtitles → `secondaryLabel`, not accent blue | **No** | Names the system text-colour role, the de-emphasise principle, and the swatch-already-on-the-dot cross-check; generic = "make subtitles less loud." |
| 5 | Dev toast / tab-bar collision, weighted low pending debug-only confirmation | **No** | Names the exact frames it appears/absent on and bounds severity to its build origin. |

**Tally: 0 / 5 generic.** Rewrite threshold (≥3) not met.

## Self-check (soul §rubric)

1. **All four pre-checks + inbox before lens 1?** Yes. Inbox: Wren v3 present,
   all three handoffs acknowledged + verified resolved. Precondition 0a–0d all
   PASS (0d flipped from PARTIAL). No BLOCKER opens the report — correct, the
   surface fits its canvas and renders native.
2. **First-five not generic?** 0/5 generic (table above).
