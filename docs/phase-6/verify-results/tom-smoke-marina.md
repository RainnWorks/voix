# Marina — UI-craft review, Phase 6 iOS smoke (iPhone 16 Pro sim)

> Lens: pixels, type, colour, spacing, brand-glyph fidelity, component
> treatment, state legibility. **Not** flow / IA / mental model (Wren's).
> Disposition (ship/hold/fix) is the coordinator's — this is a punch list.
> Surface under review: the **app** (onboarding + main). The marketing
> brand's hand-set exemptions do not apply here, so grid/colour/type rules
> are in force.

## Receipts — which frame is the evidence for each finding

| # | Finding (short) | Evidence frame(s) |
|---|---|---|
| 1 | HA blue is the wardrobe, not a costume | 05 + 07/09 (chrome) vs 01 + 08 (voix moment) |
| 2 | Onboarding title renders as disabled text | 01, **02** (same screen 10 min later — proves it's the resting state, not a fade-in) , 03, 04 |
| 3 | Daemon URL field styled as a label, no input affordance | 04 |
| 4 | "Connected" status painted in brand blue, not a success token | 04 |
| 5 | Puck inner-circle ratio drifts off the 35% spec | 01 (hero) vs 05 (card pucks) vs wordmark chip (all frames) |
| 6 | Mode tone-snippets set as coloured running text | 05 |
| 7 | "Connecting…" wraps the ellipsis + uses ASCII dots | 08 |
| 8 | Debugger toast occludes the bottom nav / last row | 04, 05, 07, 08, 09 |
| 9 | Mic glyph left neutral while its state goes blue | 07 → 08 → 09 |
| 10 | Onboarding header anchor shifts between steps | 01 vs 03 vs 04 |
| 11 | Wordmark casing "Voix" vs headline "voix" | all frames (chip) vs 01/03/04 (titles) |
| 12 | Page control renders a single dot for a 3-step flow | 01, 03, 04 |

Note on the blue hue: I am reading hex off a simulator capture, so I name
the *structural* fault, not a pixel-exact value — see #1. Glyph-proportion
and field-affordance findings (#3, #5) should be confirmed against the
source SVG / component, but the render is the evidence and it's enough to
log.

---

## Findings — worst-first

1. **TalkButton / sidebar / CTAs — HA blue (`#03A9F4`) is worn as chrome,
   not reserved for the voix moment.** The cyan-blue on the sidebar
   selection fill (07/09 "Kitchen quick chat"), the "Get started" /
   "Allow microphone" / "Done" pills (01/03/04), the "Activate" /
   "Reset to default" links and the "NOW · Realtime" pill (05) is the
   *same* hue family as the puck dot (01) and the "Connecting…" listening
   state (08). When the talk button lights up blue to say *"voix is
   listening,"* it is the same blue as every button already on screen — so
   the one colour the brand reserves to mean "a voix beat is happening"
   carries no signal. This holds even if chrome is system `#007AFF` and the
   puck is HA `#03A9F4`: those two blues are close enough that the listening
   state still doesn't separate from the action chrome. Colour-discipline
   lens / brand §9 ("HA blue is a costume, not a wardrobe"). Fix: route all
   chrome (selection, generic buttons, links) to the system accent and
   reserve `#03A9F4` strictly for the puck + listening/connecting state; if
   they must share the indigo family, push the voix-moment blue to a
   distinctly more saturated/cyan value so the listening state reads as a
   state change, not as another button. [severity: high]

2. **Onboarding titles (01 "voix listens when you talk to it.", 03 "voix
   needs your microphone.", 04 "Connect to voix") render in a tertiary
   dark-grey on black — the same value as the body copy — so the screen
   title is the *least* prominent text on the screen and reads as disabled.**
   02 is the identical screen 10 minutes later and is still dim, so this is
   the resting state, not a fade-in frame. Hierarchy is inverted: the only
   element with presence is the blue CTA. Hierarchy + colour-discipline lens
   (Refactoring UI: hierarchy by size/weight/**colour**; de-emphasise the
   secondary, don't flatten everything to one grey). Fix: title → primary
   `label` (near-white system label colour), body → `secondaryLabel`; let
   the colour ramp do the work the single grey currently refuses to.
   [severity: high]

3. **04 daemon URL ("http://192.168.99.86:8765/") is styled as plain dim
   grey text — no border, no fill, no focus affordance — indistinguishable
   from the body copy beside it, yet it is the one editable field on the
   screen.** This is the "input styled to look like a label" red flag
   exactly. Component-composition lens / HIG controls (inputs must carry a
   real affordance). Fix: give it a bordered or grouped-fill text-field
   treatment with a visible focus ring; "Reset to default" implies it's
   editable, so the field must *look* editable. [severity: high]

4. **04 "Connected" status is painted in brand blue (blue dot + blue
   label) instead of a semantic success colour.** A connectivity-success
   state is exactly what a semantic `success` token is for; rendering it in
   the accent/brand blue both mis-codes the meaning (blue ≠ "good to go")
   and adds yet another blue to the pile in #1. Colour-discipline lens
   (state colours are semantic tokens, never the brand accent). Fix:
   `colors.success` (system green) for the dot + label. [severity: med]

5. **Puck inner-circle ratio drifts off the locked 35% spec, and isn't
   constant across sizes.** The hero puck (01) reads with an inner circle
   roughly half the squircle's width (~48–51%), well over the 35% spec; the
   wordmark-chip puck and the mode-card pucks (05) read tighter (~30–35%).
   Glyph *sizes* are grid-exempt, but the *proportions* are not negotiable —
   and here they aren't even consistent between sizes. Brand-glyph-fidelity
   lens (squircle 22% radius, circle 35% of side, centred). Fix: re-derive
   every puck from the spec'd vector so the circle is 35% of the side at all
   sizes; confirm against the source SVG. [severity: med]

6. **05 mode tone-snippets ("Talks back. Knows…", "Just transcribes…",
   "Crisp messages…") are set in each mode's swatch colour as running
   text.** Colour identity belongs on the icon dot (which already carries
   it); tinting the copy as well turns the card column into a stack of
   differently-coloured sentences and fights restraint. Hierarchy +
   colour-discipline lens (de-emphasise the secondary; don't colour-code
   prose). Fix: snippet copy in `secondaryLabel`, let the puck dot be the
   only place the mode swatch appears. (Confirm exact swatches at full res.)
   [severity: med]

7. **08 "Connecting…" wraps the ellipsis onto a second line and uses three
   ASCII periods ("...") rather than a typographic ellipsis (…).** The pill
   grows to two lines and the word sits off the vertical centre; the
   stock-punctuation dots violate the hand-set-punctuation rule. Type-craft
   lens / brand §9. Fix: a single typographic "Connecting…" on one line; if
   the dots animate, reserve fixed-width space so the pill doesn't reflow as
   they cycle. [severity: med]

8. **The debugger toast (04, 05, 07, 08, 09) floats as a full-bleed dark
   bar over the light UI and overlaps the bottom "Settings" nav row and the
   last conversation card — it occludes chrome instead of insetting above
   it.** Its trailing affordance is an empty grey circle with no glyph
   (ambiguous action). Component-composition / layout lens. Fix: inset the
   toast with a margin so it floats *above* the nav rather than over it;
   give the trailing control a real icon or remove it. [severity: med]

9. **The mic glyph stays neutral dark while the rest of the TalkButton goes
   blue (idle 07 → connecting 08 → idle 09).** Label, border and fill all
   adopt the state colour; the icon alone is left chromatically orphaned, so
   the lockup half-commits to the state. Motion / state-legibility lens
   (one state = one coherent treatment). Fix: tint the glyph with the state
   colour too, or keep the whole lockup neutral and signal the state some
   other way — don't split it. [severity: low]

10. **Onboarding header anchor shifts between steps.** 01 leads with a large
    centred hero puck above a left-aligned title; 03 and 04 drop the hero
    puck entirely and float the wordmark+title block at *different* vertical
    positions. The three steps don't share a vertical grid, so the header
    visibly jumps as you advance. Spacing/grid + composition-consistency
    lens. Fix: one shared header anchor and a consistent hero treatment
    across all three steps. [severity: low]

11. **Wordmark casing is inconsistent: the chrome chip reads "Voix"
    (title-case) while every headline lowercases "voix".** The brand name
    can't have two capitalisations in one product. Brand-fidelity lens. Fix:
    pick one lockup (the lowercase "voix" the headlines and the domain
    `/vwa/` already use) and apply it to the chip. [severity: low]

12. **The onboarding page control (01, 03, 04) renders a single low-centred
    blue dot for a 3-step flow.** As one dot it reads as an orphaned blue
    decoration, not a 3-of-N progress indicator. (Whether the user *needs*
    progress is Wren's; that the control renders a single dot is the pixel
    fact.) Colour + composition lens. Fix: render the full dot group with an
    active/inactive treatment, or remove the control. [severity: low]

---

**Net.** 12 findings — 3 high, 4 med, 5 low. The spine is colour: the brand
blue is spent everywhere (#1), which is the same disease that paints the
"Connected" success state blue (#4) and the mode snippets in swatch colour
(#6). Fix the colour discipline and three of the twelve resolve together.
The two non-colour high-severity items are independent and concrete: the
disabled-looking onboarding titles (#2) and the URL field with no input
affordance (#3). Glyph proportions (#5) want a source-SVG confirmation but
the render already shows the drift.

---

## First five bullets — §5 self-test

The self-test question: *could a generic LLM that never read this soul file
have produced this finding — no named location, no system text-style /
colour token, no brand rule?* A "yes" is a failing (generic) bullet. **Three
or more "yes" → rewrite.**

| # | First-five finding | Could a generic LLM have produced it? | Why |
|---|---|---|---|
| 1 | HA blue is chrome, not a voix moment | **No** | Cross-frame evidence (05/07/09 vs 01/08), the "costume not wardrobe" brand rule, `#03A9F4` vs `#007AFF`, and the specific argument that the *listening state can't signal* because chrome already owns the colour. A generic pass says "use a consistent accent," not "the reserved colour can't do its job." |
| 2 | Onboarding titles render as disabled text | **No** | Names the inverted hierarchy and the `label`/`secondaryLabel` system colour ramp, and uses frame 02 as a receipt that it's the *resting* state, not a fade. Generic = "improve contrast." |
| 3 | URL field styled as a label, no affordance | **No** | The "input styled to look like a label" red flag verbatim, plus focus-ring / grouped-field fix and the "Reset to default implies editable" cross-check. Generic = "make the field clearer." |
| 4 | "Connected" status in brand blue | **No** (borderline) | A generic LLM might say "connected should be green," but the finding's spine is *semantic-token vs brand-accent discipline* and the link back to the #1 over-use-of-blue thesis — that's the soul, not the cliché. |
| 5 | Puck inner-circle ratio drifts off 35% | **No** | Cites the locked spec (22% squircle radius, 35% circle, centred) and the cross-size *inconsistency*, with eyeballed ratios. Pure brand-glyph-fidelity lens; a generic pass never knows the 35% number exists. |

**Tally: 0 of 5 "yes" (generic).** All five carry a frame reference, a named
system/brand unit, and a point of view a generic model wouldn't volunteer.
The rewrite threshold (≥3 generic) is not met, so no rewrite of the first
five is required.
