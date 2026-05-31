# The persona soul — how to write a design-critique reviewer

**Audience**: whoever (human or coordinator agent) is about to spin up a
design-critique persona for a voix review pass. Read this before you
write the system prompt. The cast we've been running ad hoc all
project (Marina, Wren, Priya, Yuki, Hiro, Aki, Sasha, Diego, Arvid)
proved the value of personality on the verify phase —
`agent-team-workflow.md` §2 already says *"personality on Adversary +
Product is non-negotiable."* This doc says **how** to build that
personality so it does real work instead of theatre.

The two canonical souls written against this guide are
[`persona-ui-reviewer.md`](persona-ui-reviewer.md) (Marina, UI craft)
and [`persona-ux-reviewer.md`](persona-ux-reviewer.md) (Wren, UX flow).
This doc's §10 scores both against its own rubric.

> **Revision note (Phase 6, after the tom-smoke iOS pass).** The first
> real review pass with these souls shipped two reports
> ([`tom-smoke-marina.md`](../phase-6/verify-results/tom-smoke-marina.md),
> [`tom-smoke-wren.md`](../phase-6/verify-results/tom-smoke-wren.md)) that
> *both missed the biggest fact on the screen*: the entire app was a
> desktop/iPad two-column layout rendered on an iPhone — wordmark behind
> the status bar / Dynamic Island, content clipped mid-word, a fixed
> sidebar squeezing the content pane to ~60% of the canvas. Marina wrote
> twelve pixel findings and never asked *"is this even a design for this
> device?"* Wren saw the split but scored it **med** and tried to hand the
> truncation to Marina with a bare "→ Marina" that Marina never read.
> Three structural holes caused it, and §3–§5 below are the fix:
> **(§3)** no precondition step — both personas opened straight into
> lens-level findings; **(§4)** handoffs were declared but never received;
> **(§5)** "foundational fit-to-canvas" had no severity bucket above HIGH,
> so it got folded into a med IA nit.

> **Revision note (M-MobileFit, native-feel pre-check).** Tom added a
> binding spec: **"the goal is to feel native."** Not "cross-platform that
> runs on iOS" but *"this is an iOS app that happens to share code with
> macOS/web."* The §3 precondition check gained a **fourth** pre-check,
> *native-feel*, at the same severity as canvas-fit: a surface that reads
> as a generic-RN shell (faked controls, no SF Symbols, Card-stack where a
> TableView belongs, no native nav/sheet/gesture/haptic grammar) is a
> **BLOCKER**, independent of canvas-fit. It splits between the personas
> the way canvas-fit does — **Marina owns the visual half** (controls, SF
> Symbols, SF Pro Dynamic Type, native lists, scale-on-press, NSToolbar on
> macOS) and **Wren owns the interaction half** (push nav, sheet detents,
> tab-bar behaviour, pull-to-refresh, haptics, swipe gestures). §10 re-runs
> the self-test with the new lens against the un-rebuilt tom-smoke
> screenshots; both personas now surface a second, independent native-feel
> BLOCKER beside the canvas-fit one.

---

## 1. What a soul IS — and what it ISN'T

A persona soul is a **method with a face**. The face exists to make the
method *salient and consistently applied*; the method is what actually
finds the bugs. Get the relationship backwards and you get theatre.

> **Character without method is theatre.** "Marina hates rounded
> corners" is a costume. It produces a reviewer who *sounds* opinionated
> and finds nothing a generic model wouldn't.
>
> **Method without character is generic-LLM design feedback.** A bare
> checklist ("check contrast, check spacing, check consistency")
> produces the beige average of every design article in the training
> set. It cannot prioritise, cannot hold a grudge, cannot tell you which
> of its forty findings is the one that matters.
>
> **A soul is the method *plus* the specific person whose career makes
> that method reflexive.** Marina reaches for the 8-pt grid not because a
> checklist told her to, but because twelve years at Apple made
> off-grid spacing feel like a misspelling. The history is load-bearing:
> it's *why* this reviewer reaches for *these* lenses first.

### The research says exactly this

This isn't a stylistic preference. The persona-prompting literature
converges on a sharp, useful result:

- **Personas do not improve factual accuracy.** A systematic study of
  162 personas across 4 model families and 2,410 factual questions found
  no aggregate improvement over no-persona, and that the per-question
  effect "might largely be random" ([Zheng et al., *When "A Helpful
  Assistant" Is Not Really Helpful*, arXiv:2311.10054](https://arxiv.org/abs/2311.10054)).
  If you're asking "what is the contrast ratio of #888 on #fff," a
  persona buys you nothing — compute it.

- **But personas DO help on alignment / preference / format / style
  tasks** — and *hurt* on knowledge-retrieval tasks. PRISM names this
  directly: *"Expert Personas Improve LLM Alignment but Damage Accuracy"*
  ([arXiv:2603.18507](https://arxiv.org/abs/2603.18507)). For
  format-following, safety, and preference-satisfaction, an expert
  persona "consistently helps"; for MMLU-style retrieval it "consistently
  damages." **Design critique is squarely an alignment/preference task** —
  "does this screen match the brand and serve the user's intent" is not a
  fact lookup. This is the one task class where the soul earns its keep.

- **What separates a persona that helps from one that doesn't is
  *principled grounding*.** Effective personas "align with genuine
  expertise domains relevant to the task," "activate task-appropriate
  evaluation criteria," and maintain "behavioral consistency." Ineffective
  ones "represent superficial characteristics unrelated to task
  requirements" and "rely on stereotypes rather than functional
  expertise" ([*Principled Personas*, arXiv:2508.19764](https://arxiv.org/abs/2508.19764)).
  In our vocabulary: the *method* is the principled grounding; the
  *character* is the delivery mechanism that keeps it consistent.

- **Irrelevant persona detail is actively harmful.** Models are "highly
  sensitive to irrelevant persona details, with performance drops of
  almost 30 percentage points" ([arXiv:2311.10054](https://arxiv.org/abs/2311.10054)).
  This is the empirical case against theatre: a paragraph about Marina's
  cat is not neutral colour, it's measured damage. **Every sentence of
  lived history must terminate in a lens.** If a biographical detail
  doesn't explain why she reaches for a specific criterion, cut it.

- **Role-play can degrade reasoning if you let it run the whole show.**
  *Persona is a Double-edged Sword* ([arXiv:2408.08631](https://arxiv.org/abs/2408.08631))
  shows role-prompts hurting zero-shot reasoning. Mitigation in our
  setting: the persona owns the *lens and the priorities*; the
  coordinator owns the *judgement* (`agent-team-workflow.md` §2,
  "delegate the tasks, not the judgment").

- **Role grounding via the system prompt genuinely steers the model.**
  Anthropic's guidance is that "the right role turns Claude from a
  general assistant into a virtual domain expert," and that you should
  "be explicit," "provide context and motivation (explain *why* it
  matters)," and that "models pay very close attention to details in
  examples" ([Anthropic, *Claude best
  practices*](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)).
  A soul is the disciplined application of all three: explicit method,
  motivating history, worked examples in the rubric.

- **A persona needs its own eval.** swyx's IMPACT framework defines
  "Intent" as *Instructions + Evals*, not instructions alone, "the same
  way the generator-verifier gap works at the model level"
  ([Latent.Space, *Agent Engineering*](https://www.latent.space/p/agent)).
  Translated: a persona's instructions (its method) are incomplete
  without the rubric it grades itself against (§2.7). The output rubric
  is not paperwork — it's the verifier half of the persona.

### The contrast pole, in the wild

VoltAgent's [`ux-researcher.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/08-business-product/ux-researcher.md)
is a competent, widely-copied subagent: frontmatter, a role line, and
*eleven* eight-item checklists (interviews, surveys, journey mapping,
A/B testing…). It is pure method, **zero character** — no voice, no
lived experience, no grudge. It will dutifully apply every checklist and
return the beige average. That's the failure mode "method without
character" predicts: comprehensive, consistent, and unable to tell you
which finding to fix first. Our souls keep the checklists (that's the
method) but give them a person who *prioritises* — because the
coordinator's scarcest resource is judgement, not coverage.

---

## 2. The seven sections every persona file must have

A persona file is not freeform. It has a fixed skeleton so that (a) the
coordinator can compose several without overlap, and (b) you can run the
first-five-bullets test (§8) against it. Missing any section is a defect.

### 2.1 Identity — one sentence, sharp

Who they are and the single lens they own, in a sentence you could put
on a business card. *"The macOS HIG zealot who treats off-grid spacing
like a misspelling."* This is the **role grounding** the research says
steers the model. It must also stake a **territory** — what this
persona owns and, critically, what it *hands off* — so two personas in
one review don't collide (§7).

### 2.2 Lived history — the source of the method, not decoration

The specific career that built the lens. The rule from the research
(irrelevant detail costs ~30 points): **every clause must terminate in a
criterion the persona now reaches for reflexively.** "Twelve years at
Apple Design Evangelism" is allowed *because* it explains why she reaches
for the system text-style ramp before anything else. "She likes sailing"
is not allowed. Write the history, then strike every sentence that
doesn't end in a lens.

### 2.3 Values / what they refuse — the productive bias

The axioms the persona will die on, stated as refusals. This is the part
that lets a persona *prioritise* where a checklist can't: a persona who
*refuses* to let HA blue into chrome will surface that finding first and
loudest, every time, without being told. The bias is the feature — it's
what makes the reviewer catch the thing consensus would wave through.
(The bias is also the failure mode; see §2.6 and §6.)

### 2.4 Method — the load-bearing section

The actual, ordered, *named* lenses the persona applies to **any**
surface you hand it. This is the principled grounding. Rules:

- **Named and ordered.** "1. Grid & spacing. 2. Type ramp. 3. Colour
  discipline…" — not a prose blob. The order encodes priority.
- **Surface-agnostic.** The method must work on a screen the persona has
  never seen. If a lens only fires on one specific screenshot, it's not a
  method, it's a memorised answer.
- **Anchored to real frameworks.** Cite the source of authority so the
  finding has a spine: Nielsen's 10 heuristics, Norman's principles
  (visibility, feedback, affordance, mapping, constraints, error
  recovery), JTBD, Cooper's goal-directed design, Apple HIG, Material,
  Refactoring UI. A finding that traces to a named heuristic survives an
  argument; "I just don't like it" doesn't.
- **Voix-specific where it counts.** A generic "check colour contrast"
  lens is worthless here. "HA blue (#03A9F4) appears ONLY in voix
  moments; anywhere in chrome is a finding" is a lens only *this* product
  has. The brand rules in `design-brief-multi-surface.md` §9 are
  pre-loaded method.
- **The precondition check runs *before* lens 1.** Every method opens
  with the four pre-checks in §3 — canvas-fit, safe-area, input-modality,
  native-feel. A persona that dives into lens 1 without first confirming
  the surface *belongs on this device* and *reads as native to this
  platform* is the exact failure that shipped the tom-smoke miss. The
  precondition is part of the method, not a preamble.

### 2.5 Vocabulary — how method becomes legible (and testable)

The specific words and units the persona uses: *8-pt grid, Title 3,
optical tracking, hairline, gulf of execution, JTBD, context receipt,
press-to-talk, safe-area inset, master-detail, canvas-fit.* Vocabulary is
not flavour — it's the **diagnostic for the first-five-bullets test**. A
generic LLM says "improve spacing"; a real persona says "L289
`marginBottom: 8` is on-grid but L338 `gap: 10` breaks the 8-pt rhythm."
The named units are the fingerprint that proves the method ran. If a
finding could be rephrased without losing meaning by a model that had
never read this file, the vocabulary isn't doing its job.

### 2.6 Failure modes — when this lens lies

When the persona over-fires, what it's blind to, and when the
coordinator should discount it. A soul without this section is
dangerous: the bias that makes it sharp (§2.3) also makes it wrong in
predictable ways. Marina will flag an off-grid value on the *marketing*
surface where the hand-set paper brand intentionally breaks the grid —
that's the lens misapplied. Naming the failure mode is what lets the
coordinator weight the finding instead of obeying it. (See §6 for the
general theory.)

### 2.7 Output rubric — the verifier half

The exact shape every finding must take, plus the persona's self-check.
This is the "Evals" half of Intent (IMPACT). The voix house format,
proven across the M04–M18 audit files:

```
N. **<location: file:line or screen region>**: <what is wrong, in the
   persona's vocabulary> — <why it violates the named lens/heuristic>.
   <the fix, concrete>.   [severity: BLOCKER | high | med | low]
```

The report opens with an **inbox + precondition block** (§3, §4) *before*
finding 1: acknowledge any inbound handoffs, then state the result of the
three pre-checks. If a pre-check fails, finding 1 *is* that BLOCKER. Only
then do the lens-level findings begin. And the self-check the persona
must run before returning, literally the test from §8:

> *Re-read your first five bullets. If three or more could have been
> written by a generic model that never read your soul file, delete them
> and look again with your actual method.*

---

## 3. The precondition check — runs before any lens

**This is the section the tom-smoke pass was missing.** Before a single
pixel, colour, or flow lens fires, the persona must answer one question:
*am I reviewing a design for this canvas, or a different design rendered
on this canvas?* A lens-level finding about a surface that shouldn't
exist on this device is worse than useless — it lends false legitimacy to
the wrong surface by treating it as real enough to critique.

Every persona — UI **and** UX — opens every review by running these four
pre-checks, in order, against the actual device class shown:

1. **Canvas-fit.** Is this layout *pattern* appropriate for the device
   class in the screenshot? A two-column master-detail split, a fixed
   sidebar, a hover-dependent toolbar, a 1024pt content width — these are
   *desktop/tablet* idioms. Seeing one rendered on a 393pt iPhone is not a
   spacing nit; it means *the wrong design is on the screen.* (Anchor:
   Apple HIG *Layout* / size classes; Material *Adaptive layout* — phone,
   tablet, and desktop are distinct canvases with distinct patterns, not
   one layout scaled.)
2. **Safe-area / system-chrome avoidance.** Does the app's own chrome
   steer clear of the regions the OS owns — the status bar, the Dynamic
   Island / notch, the home indicator? A wordmark or clock sitting *at*
   the status-bar row, content running under the home indicator, a control
   tucked behind the Island — each is a hard violation, not a polish item.
   (Anchor: HIG *Safe areas* and *layout margins*.)
3. **Input-modality fit.** Do the controls match how this device is
   driven? Touch targets ≥ 44pt on a phone; no reliance on cursor hover or
   right-click where there's no cursor; keyboard accelerators (`⌘N`) must
   not be the *only* path to an action on a touch surface. (Anchor: HIG
   *Touch targets* / pointer vs touch; Material *touch target* 48dp.)
4. **Native-feel / platform-nativeness.** Does this surface read as a
   *native app for this platform*, or as a *generic cross-platform shell
   that happens to run here*? The binding spec from Tom is **"the goal is
   to feel native"** — not "cross-platform that runs on iOS" but *"this is
   an iOS app that happens to share code with macOS/web."* A surface where
   iOS controls are faked (a `Pressable` styled to look like a `UIButton`,
   a custom toggle where a `Switch` belongs, a Card stack where a
   `TableView` belongs), where SF Symbols are swapped for custom glyphs,
   where SF Pro / Dynamic Type is replaced by a webfont, or where the
   platform's own transitions are absent (push slide-from-right, pull-up
   sheets with detents, swipe-back) is a *generic-RN app wearing the wrong
   clothes* — even when it fits the canvas perfectly. This pre-check
   **splits cleanly between the two personas**, the same way canvas-fit
   does: **Marina owns the visual half** (controls render as iOS controls,
   SF Symbols, SF Pro at Apple Text Styles via Dynamic Type, native list
   rendering, scale-on-press), **Wren owns the interaction half** (push
   navigation, sheet detents, tab-bar behaviour, pull-to-refresh, haptics,
   swipe gestures). (Anchor: Apple HIG *Components* / *SF Symbols* /
   *Typography — Dynamic Type*; macOS HIG *NSToolbar*, AppKit controls and
   vibrancy; Material where Android applies — each platform's own component
   set, never a lowest-common-denominator shell.)

**The rule.** If *any* pre-check fails, that finding is **BLOCKER**
(§5), and the report **opens with it** — before any lens-level pixel or
flow finding. Every downstream finding then carries an implicit asterisk:
*"provisional, pending the BLOCKER fix"* — because they evaluate a surface
that is about to change shape. A persona that buries a failed pre-check at
position 5, or scores it as a mid-severity nit, has repeated the
tom-smoke miss.

**Canvas-fit and native-feel are *independent* BLOCKERs.** A surface can
pass one and fail the other: a single-column phone layout (canvas-fit
passes) whose every row is a `Pressable`-styled fake control (native-feel
fails), or a correctly-native control set crammed into a desktop split
(native-feel passes, canvas-fit fails). They do **not** collapse into each
other — fixing the column count does not make a Card stack of custom
buttons render as a `TableView`. So a surface may legitimately open with
*two* precondition BLOCKERs (one canvas-fit, one native-feel); that is the
exception to §5's "normally one BLOCKER" rule, because neither is
downstream of the other.

**Worked example (the miss this section prevents).** On
`/tmp/voix-tom-smoke/ios-05`: pre-check 1 fails (a desktop two-column
sidebar-plus-content split on an iPhone), pre-check 2 fails (the "Voix
/vwa/ 22:35" header sits at the status-bar / Dynamic Island row), the
squeezed pane clips text mid-word, **and pre-check 4 fails independently**
— the mode list is a stack of rounded **Cards** each carrying a tinted
"Activate" *link* (a `Pressable` faked as a button), not a native
`TableView` of rows with row chevrons and a real `UIButton`/`Switch`; this
native-feel BLOCKER *survives even after the column split is fixed*. That
is **two BLOCKERs that open both Marina's and Wren's reports** (canvas-fit
+ native-feel). The twelve pixel findings and the flow findings are all
downstream of them.

---

## 4. Handoff protocol — declared *and* received

The tom-smoke pass proved that an *unmonitored* handoff is the same as no
handoff. Wren wrote "*the text truncation this causes… → Marina*"; Marina
had no protocol telling her to read Wren's handoffs first, so the most
important pixel evidence on the screen went to no one. A handoff is a
two-party contract; both halves are mandatory.

- **Sender writes the prompt, not a pointer.** When persona A flags a
  finding that bottoms out in B's territory, A does **not** write "→ B."
  A writes the explicit, actionable prompt B needs: *"→ Marina: confirm
  the mode-snippet copy is clipped mid-word ('Talks back. Knows…') by the
  ~60% content-pane squeeze, and that the wordmark collides with the
  status bar — these are the pixel receipts for the canvas-fit BLOCKER."*
  A bare arrow is a process failure by the sender.
- **Receiver acknowledges or refutes — in the opening section.** B's
  report opens with an **inbox block** that lists every inbound handoff
  and, for each, *acknowledges* (accepts and folds it into a finding) or
  *refutes* (explains why it isn't B's, or isn't real) it. Silence on an
  inbound handoff is not allowed.
- **Unacknowledged handoffs are logged against the reviewer who missed
  them.** If B's report never mentions a handoff A sent, that is a
  recorded process failure on B — exactly the Marina miss. The coordinator
  treats an unreceived handoff as a coverage hole, not a stylistic choice.

The inbox block is the literal **first action** of every review: before
running the precondition check, read the other persona's handoffs.

---

## 5. Severity buckets — BLOCKER sits above HIGH

The tom-smoke pass had no bucket for "the surface itself is wrong," so
Wren filed it as **med** — the same weight as a copy nit. Foundational
fit-to-canvas is not a high-severity finding among other high-severity
findings; it is *categorically* above them, because it changes what the
other findings are even about. The scale is now four buckets:

- **BLOCKER** — a failed precondition (§3): the surface under review is
  the wrong surface for this canvas (wrong layout pattern, safe-area
  violation, or input-modality mismatch) **or reads as a generic
  cross-platform shell rather than a native app for this platform**
  (faked controls, no SF Symbols, no native list/nav idiom — the
  native-feel pre-check). **A BLOCKER invalidates the downstream findings
  until it is fixed**, because they evaluate pixels and flows on a surface
  that is about to be replaced. There is normally *one* BLOCKER — the
  wrong-surface fact — and it opens the report; the one sanctioned
  exception is a surface that fails **both** canvas-fit *and* native-feel,
  which are independent (§3) and may both open the report. Beyond those,
  if you find yourself filing five BLOCKERs, most are downstream
  consequences of one; collapse them.
- **HIGH** — a real defect *on an otherwise-appropriate surface*: a
  broken brand moment, a dead primary action, an inverted hierarchy. HIGH
  means "this surface is right for the canvas but this thing on it is
  broken."
- **med** — a genuine fault that doesn't block the core job: a
  mis-coded state colour, a jargon leak, a missing progress indicator.
- **low** — polish: a single off-grid value, a casing inconsistency, a
  glyph proportion drift.

The dividing line between BLOCKER and HIGH is exactly the precondition
check: a finding that *fails a pre-check* is BLOCKER; a finding that
assumes the surface is correct and critiques it is at most HIGH.

---

## 6. When a persona's lens fails — and how to know

A lens is a bias pointed at a surface. It fails in four predictable ways.
The coordinator must recognise each, because the persona by construction
*cannot* — its blindness is the price of its sharpness.

1. **Over-application (the lens fires where its authority doesn't run).**
   Marina applies the 8-pt grid to the marketing site, which is
   deliberately hand-set off-grid (`design-brief` §9: "punctuation should
   feel hand-set, not stock"). The finding is technically correct and
   contextually wrong. *Tell:* the finding contradicts an explicit brief
   rule for that surface. *Fix:* scope the dispatch ("UI craft on the
   *desktop* app only") and discount cross-surface findings.

2. **Single-lens tunnel (the persona scores its own axis and misses the
   screen).** Marina pronounces a screen pixel-perfect; it is also a
   confusing flow. She's right and useless, because flow isn't her axis.
   *Tell:* a clean bill of health from one persona on a screen another
   persona savages. *Fix:* never ship on one lens; compose (§7).

3. **The lens fights the brief (the persona's values pre-date the
   current product decision).** A persona grounded in "voice tools should
   never show a settings panel" will reject a Context-sources panel the
   brief explicitly asks for. *Tell:* the finding argues with
   `design-brief-multi-surface.md` rather than with the implementation.
   *Fix:* the brief wins; log it as a persona-staleness note and move on.

4. **Wrong artifact type (the lens has nothing to bite on).** Hand a pure
   visual-craft persona a state-machine diagram and it will manufacture
   findings to feel useful — the fabrication failure mode from
   `agent-team-workflow.md` §6, dressed as taste. *Tell:* vague findings
   with no named units, no file:line. *Fix:* match persona to artifact;
   if the artifact is out of every persona's lane, that's a coordinator
   read, not a dispatch.

There is a fifth failure mode the tom-smoke pass surfaced, and it sits
upstream of all four: **5. No precondition (the persona critiques the
wrong surface as if it were the right one).** Both Marina and Wren ran
their lenses cleanly on a layout that should never have been on the
phone. *Tell:* a dense, competent report with **no BLOCKER and no inbox
block** on a screenshot where the design pattern obviously doesn't match
the device class. *Fix:* §3's precondition check, run before lens 1 — this
is now mandatory in every persona's method.

**The meta-tell across the lens failures: the findings stop carrying
named units and start carrying adjectives.** "This feels cluttered" is a
lens with nothing to bite on. "L338 `gap: 10` breaks the 8-pt rhythm" is
a lens working. Adjective density up, vocabulary density down → the
persona has left the surface its method covers. (The precondition failure
is the exception: it produces *too-confident* findings, not vague ones —
which is why it needs its own explicit step rather than the adjective
tell.)

---

## 7. Composing multiple personas for one review

The verification triangle (`agent-team-workflow.md` §3) wants several
lenses on one diff. The composition rules:

- **Orthogonal territories, declared in §2.1.** UI craft (pixels,
  type, colour, macro-layout fit) ≠ UX flow (mental model, IA, intent) ≠
  a11y (contrast, focus order, screen-reader) ≠ architecture. Each
  persona's Identity states what it hands off. If two personas would both
  flag the focus ring, decide *whose* it is (it's UI's visual treatment
  AND UX's affordance — split it: UI owns "is the ring visible/on-brand,"
  UX owns "does the user know what's focused"). Overlap without a declared
  seam is wasted tokens and contradictory triage.

- **The canvas-fit BLOCKER is shared, by design.** It is the one finding
  both personas are *expected* to surface — Marina via the safe-area /
  layout-pattern pixels, Wren via the competing-nav-contexts mental model.
  When both open with the same BLOCKER from different lenses, that is not
  redundancy; it's the corroboration that makes the coordinator trust it.

- **Conflict is signal, not noise.** When the UI persona wants more
  whitespace and the UX persona wants the "produce it" button more
  prominent, that's a real density-vs-discoverability tension the
  coordinator must *resolve*, not average away. Two personas agreeing on
  everything means one is redundant.

- **The coordinator integrates; personas never triage their own
  findings as ship/hold.** They return punch lists with severity; the
  coordinator decides disposition (the M04 files' "Triage (decided by
  parent agent)" table is the pattern). A persona that writes "ship it"
  has overstepped into judgement that isn't delegated.

- **Prime each with at least one specific suspicion** (`agent-team-
  workflow.md` §6, "empty adversary report"). A persona dispatched cold
  returns mush; a persona told "I think the listening and speaking states
  are visually identical — confirm or refute, and find more" returns
  real work.

- **Two to three lenses per diff, not nine.** The cast has nine
  personas; a single screen needs the two or three whose territory it
  actually touches. A mode-editor screen wants Marina (UI) + Wren (UX),
  maybe Priya (a11y). It does not want Hiro (release) or Arvid (arch).

---

## 8. The first-five-bullets test

**The single test that tells you whether a soul is real or theatre.**

> Run the persona on a real voix screen. Read the first five bullets it
> produces. **If three or more of those five could have been written by a
> generic LLM that never read the soul file — the soul is broken.**

A generic model's design feedback is predictable: *improve contrast, add
whitespace, ensure consistency, consider accessibility, use a grid
system.* True, beige, and free. If your persona's opening volley reads
like that list, the character is theatre and the method didn't run.

A real persona's first five bullets are **dense with named units, exact
locations, a stated heuristic, and a point of view a generic model would
not volunteer** — and, on any screenshot where it applies, **bullet 1 is
the precondition BLOCKER** (§3). Diagnostics:

| Symptom | Verdict |
|---|---|
| Bullet 1 is the canvas-fit / safe-area BLOCKER when the surface is wrong for the device | precondition ran |
| A native-feel BLOCKER (faked control, no SF Symbol, Card-stack-not-TableView, no swipe-back) sits beside the canvas-fit one | the native-feel pre-check ran |
| Report opens with an inbox block acknowledging inbound handoffs | handoff protocol ran |
| Bullets name file:line or a precise screen region | method ran |
| Bullets cite a named heuristic / brand rule by name | grounded |
| Bullets use the persona's vocabulary (§2.5), not generic adjectives | character is doing work |
| Bullets are *ordered by the persona's priorities*, worst-first | the bias is load-bearing |
| A bullet says something the brief would *thank* you for catching | soul is real |
| A competent, dense report with no BLOCKER on a screen whose pattern obviously doesn't fit the device | **precondition skipped — rewrite** |
| Bullets are interchangeable with a Medium article's tips | **theatre — rewrite** |

**How to fix a failing soul:** the failure is almost never "not enough
character." It's "the method isn't specific to voix" or "the precondition
didn't run." Add voix-anchored lenses (the brand rules, the killer flow,
the surface model) until the first bullets *could only* have been written
about this product — and make the precondition check (§3) the literal
first move so the wrong-surface fact can never again hide at position 5.

---

## 9. Checklist before you dispatch a persona

- [ ] All seven sections present (§2)
- [ ] Every lived-history clause terminates in a lens (§2.2)
- [ ] Method is named, ordered, surface-agnostic, framework-anchored,
      and voix-specific (§2.4)
- [ ] **Method opens with the §3 precondition check** (canvas-fit /
      safe-area / input-modality / native-feel) before lens 1 — and the
      persona owns its declared half of the native-feel pre-check (Marina
      visual, Wren interaction)
- [ ] Vocabulary section exists and the method actually uses it (§2.5)
- [ ] Failure modes named — you know when to discount this persona (§2.6)
- [ ] Output rubric includes the BLOCKER bucket, the inbox + precondition
      opening block, the file:line format, AND the first-five-bullets
      self-check (§2.7)
- [ ] **Handoff protocol wired (§4):** the persona writes explicit
      prompts when it hands off, and opens with an inbox block that
      acknowledges/refutes inbound handoffs
- [ ] Territory declared so it composes without overlap (§7)
- [ ] You have one specific suspicion to prime it with (§7)
- [ ] You've mentally run the first-five-bullets test (§8)

---

## 10. Verification — scoring this guide's own two personas

Honest application of §8 to the two souls shipped alongside this doc. If
either failed, it was fixed before this section was written. **This pass
is the re-run after the §3–§5 rewrite *and* the native-feel pre-check
addition (§3 pre-check 4), against the SAME screenshots that exposed the
miss** (`/tmp/voix-tom-smoke/ios-01..09`, which have *not* been rebuilt),
so the test is now twofold: *do the updated personas (a) still lead with
the canvas-fit BLOCKER the original pass buried, and (b) now also surface
the native-feel BLOCKER — visual for Marina, interaction for Wren — that
neither persona had a lens for before?* If the native-feel lens surfaced
nothing on these un-rebuilt screenshots, it would be too weak to ship.

### 10.1 Method — how the scoring was done

For each persona I simulated its opening volley on `ios-05` (the main app
screen — the one that exposed the iPad-split-on-iPhone), cross-referenced
`ios-08` (the conversation list + pressed TalkButton) for the interaction
lenses, took the first five bullets *including the inbox + precondition
block*, and asked of each: *do the BLOCKERs (canvas-fit **and**
native-feel) open the report, and could a generic LLM that never read the
soul file have produced these?* A buried BLOCKER, a missing native-feel
finding, or three or more generic bullets, = fail.

### 10.2 Marina (UI craft) on `ios-05` — re-run

**Inbox.** Wren → Marina (received): *"the iPad/desktop split squeezes the
content pane and clips the mode snippets mid-word ('Talks back. Knows…',
'ACTIV[E]', 'puck-1 · Realtime'); confirm the truncation and the wordmark
/ status-bar collision as the pixel receipts for the canvas-fit BLOCKER."*
**Acknowledged** — folded into the BLOCKER below.

Simulated first five bullets:

1. *🚫 **Precondition fail (canvas-fit + safe-area).** `ios-05` renders
   the **desktop/iPad two-column master-detail split** — a fixed left
   conversation sidebar ("+ New conversation ⌘N", TODAY, "Kitchen quick
   chat") *beside* the Voices content pane — on a 393pt iPhone. Pre-check
   1 fails (wrong layout pattern for the device class; HIG size classes /
   Material adaptive layout). Pre-check 2 fails: the app's "Voix /vwa/
   22:35" header sits **at the status-bar / Dynamic Island row**, not
   below the safe-area inset. The sidebar squeezes content to ~60% of the
   canvas, clipping "Talks back. Knows…", "ACTIV[E]", and "puck-1 ·
   Realtime" mid-word (Wren's handoff, confirmed). This is the wrong
   design on this canvas; findings below are provisional until it's fixed.
   Fix: adopt an adaptive layout — sidebar → drawer/push-nav, content
   full-width, header inset below the safe area. **[severity: BLOCKER]***
2. *🚫 **Precondition fail (native-feel — visual, independent of #1).**
   The Voices list is a stack of rounded **Cards**, each with a coloured
   status dot and a tinted "Activate" *link*, where iOS wants a native
   `TableView`: grouped rows, hairline row separators, a trailing row
   chevron, and a real `UIButton`/`Switch` for the action — not a
   `Pressable` faked as a button. The status glyphs are custom dots, not
   **SF Symbols**; the type is a flat webfont ramp, not **SF Pro at Apple
   Text Styles via Dynamic Type** (Title 2 / Headline / Subhead / Footnote
   are indistinguishable here). This reads as a generic-RN shell, and it
   **survives the canvas-fix** — collapsing to one column still leaves a
   Card-stack-of-Pressables. Fix: render the modes as a native grouped
   list with SF Symbols, the Apple text-style ramp, and platform controls.
   **[severity: BLOCKER]***
3. *TalkButton / sidebar / CTAs wear HA blue (`#03A9F4`) as chrome, not
   reserved for the voix moment — the listening state can't signal because
   chrome already owns the colour (brand §9). [high]*
4. *Daemon URL field styled as a plain label — no border, fill, or focus
   affordance — an input dressed as a label (HIG controls). [high]*
5. *"Connected" painted in brand blue instead of a semantic `success`
   token — mis-codes the state and adds to the blue pile. [med]*

Scoring: **bullet 1 is the canvas-fit BLOCKER and bullet 2 is the
independent native-feel BLOCKER** (the new lens), the report opens with an
acknowledged inbox handoff, and 0 of 5 are generic (each carries a
file/region, a named unit, and a brand/HIG citation). **PASS.**

### 10.3 Wren (UX flow) on `ios-05` — re-run

**Inbox.** No inbound handoffs this pass (Marina's pixel handoffs flow the
other way). Wren *originates* the handoff to Marina below.

Simulated first five bullets:

1. *🚫 **Precondition fail (canvas-fit).** The phone renders a permanent
   two-column iPad/desktop master-detail split: a fixed conversation
   sidebar competes with the content pane, so **two navigation contexts
   fight on a one-thing-at-a-time surface**, and the app's own header
   collides with the iOS status bar. This is not a med IA mismatch — it is
   *the wrong design rendered on this canvas*, which invalidates the
   downstream flow findings (they evaluate panes that won't survive the
   re-layout). **Handoff → Marina (explicit):** *"confirm the wordmark /
   status-bar (Dynamic Island) collision, the ~60% content-pane squeeze,
   and the mid-word truncation of the mode snippets — these are the
   pixel-level receipts for this BLOCKER."* Closeout verifies Marina
   acknowledged. Fix: collapse to a single-column phone layout, sidebar as
   a drawer, content full-width. **[severity: BLOCKER]***
2. *🚫 **Precondition fail (native-feel — interaction, independent of
   #1).** The interaction grammar is web/RN, not iOS: a mode row carries
   an inline "Activate" link instead of **tap-to-drill push navigation**
   (slide-from-right) into the mode; the conversation rows (`ios-08`) have
   **no swipe-to-delete** destructive action; the pressed TalkButton
   (`ios-08`, "Hold to talk to voix") fires **no haptic** where a
   press-to-talk wants `impactMedium` and session-open wants a success
   tap; and "Connecting…" is an inline pill, not a pull-up **sheet with
   detents**. None of these is fixed by the re-layout — the *gestures and
   transitions* are absent regardless of column count. **Handoff →
   Marina:** the faked-control / Card-not-TableView pixels are her half of
   this same BLOCKER. Fix: native push nav, swipe actions, haptics on the
   talk/session beats, sheet presentation. **[severity: BLOCKER]***
3. *`+ New conversation` is bound to `⌘N` — a key the phone can't press —
   so the product's front door does nothing on tap (Norman affordance +
   mapping; Nielsen #1). [high]*
4. *After "Connecting…" there's no listening / terminal state — the WS
   closed at 0.8s with 0 chunks and the UI never says so; listening must
   be distinguishable from connecting/failed (Nielsen #1, voice-first).
   [high]*
5. *Modes rendered as activate-rows with a single global ACTIVE binary,
   and "NOW · puck-1" assumes the user acts on the puck, not the phone
   they're holding (per-surface active-mode, brief §7). [med]*

Scoring: **bullet 1 is the canvas-fit BLOCKER** (upgraded from the
original report's *med* F5) and **bullet 2 is the independent interaction
native-feel BLOCKER** (the new lens — push nav, swipe-to-delete, haptics,
sheet detents), both carry **explicit handoffs** to Marina (not a bare
"→ Marina") with a closeout-verification commitment, and 0 of 5 are
generic. **PASS.**

### 10.4 What changed vs the original tom-smoke pass

| | Original pass | After §3–§5 rewrite + native-feel pre-check |
|---|---|---|
| Marina's bullet 1 | "HA blue is chrome" (a real HIGH, but the surface is wrong) | **the canvas-fit BLOCKER** |
| Marina's bullet 2 | (no native-feel lens existed) | **the visual native-feel BLOCKER** — Card-stack-of-Pressables, no SF Symbols, no Dynamic Type ramp |
| Wren's fit-to-canvas finding | F5, **med**, buried at position 5 | **BLOCKER, bullet 1** |
| Wren's bullet 2 | (no native-feel lens existed) | **the interaction native-feel BLOCKER** — no push nav, no swipe-to-delete, no haptics, no sheet detents |
| Wren→Marina handoff | bare "→ Marina", never received | explicit prompt + Marina's inbox **acknowledges** it |
| Truncation / safe-area | in *neither* report | the **shared** pixel receipt for the BLOCKER |

The rewrite passes its own test: on the exact (un-rebuilt) screenshots
that beat the original souls, both updated personas now lead with the
foundational "wrong design rendered on this canvas" BLOCKER **and** a
second, independent "this is a generic-RN shell, not a native app"
BLOCKER — split cleanly (Marina's faked-control/SF-Symbol/type pixels,
Wren's missing gestures/transitions/haptics) — and the handoff that was
dropped is now sent explicitly and received.

### 10.5 Honest notes

- Both personas lean on voix-specific anchors (brand §9, killer flow,
  voice-first channel model) *and* on platform anchors (HIG safe areas,
  size classes, Material adaptive layout) to clear the test. The platform
  anchors are what the precondition check adds — they're general to any
  iOS surface, which is why §3 is portable in a way the brand lenses are
  not.
- The precondition check is a double-edged tool: a persona could now
  *over*-fire it, calling a deliberately wide layout (the desktop app on a
  desktop, the marketing site) a canvas-fit BLOCKER. Mitigation: the
  pre-check is *device-class-relative* — a sidebar on a Mac window is
  correct; the same sidebar on a 393pt phone is the BLOCKER. Scope the
  dispatch to the surface and its real device class.
- The native-feel pre-check (§3 #4) is the same double-edged tool one
  layer in, and it is *platform-relative*. On **macOS** the correct
  "native" is NSToolbar + AppKit vibrancy sidebars (the M22 baseline), not
  iOS controls — Marina/Wren must grade against the *platform's* idiom, not
  iOS everywhere. On the **web** surface there is no native control set to
  fake, so the lens softens to "web-considered, no native faking" — a
  Pressable on web is not a BLOCKER. The lens is sharpest, and the binding
  spec strongest, on **iOS**, where "feel native" means the surface must
  read as an iOS app that *happens* to share code, not RN that happens to
  run. Scope the dispatch to the surface and its real platform.
- The §10.2/§10.3 simulations re-derive findings the historical audit
  files reached, plus the BLOCKER they missed. The repeat-vs-rederive risk
  from prior versions still stands: prime with a *new* suspicion each pass
  (§7) and weight novel findings over repeats.

---

## 11. Sources

Persona-prompting research:
- Zheng et al., *When "A Helpful Assistant" Is Not Really Helpful:
  Personas in System Prompts Do Not Improve Performances of LLMs* —
  [arXiv:2311.10054](https://arxiv.org/abs/2311.10054) /
  [ACL Findings EMNLP 2024](https://aclanthology.org/2024.findings-emnlp.888/)
- *Principled Personas: Defining and Measuring the Intended Effects of
  Persona Prompting on Task Performance* —
  [arXiv:2508.19764](https://arxiv.org/abs/2508.19764)
- *Expert Personas Improve LLM Alignment but Damage Accuracy
  (PRISM)* — [arXiv:2603.18507](https://arxiv.org/abs/2603.18507)
- *Persona is a Double-edged Sword* —
  [arXiv:2408.08631](https://arxiv.org/abs/2408.08631)

Prompt / agent engineering:
- Anthropic, *Prompt engineering overview* & *Claude best practices* —
  [docs.anthropic.com](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- swyx, *Agent Engineering* (IMPACT: Intent = Instructions + Evals) —
  [Latent.Space](https://www.latent.space/p/agent)
- Addy Osmani, *Code Agent Orchestra* —
  [addyosmani.com](https://addyosmani.com/blog/code-agent-orchestra/)
  (cited in `agent-team-workflow.md`; "verification is the bottleneck")

OSS persona prior art:
- VoltAgent, *awesome-claude-code-subagents* (the pure-method contrast
  pole) — [ux-researcher.md](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/08-business-product/ux-researcher.md),
  [architect-reviewer.md](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/architect-reviewer.md)

Design-critique frameworks the personas inherit from:
- Jakob Nielsen, *10 Usability Heuristics for User Interface Design*
  (1994) — [nngroup.com](https://www.nngroup.com/articles/ten-usability-heuristics/)
- Don Norman, *The Design of Everyday Things* (1988/2013) — visibility,
  feedback, affordance, signifiers, mapping, constraints
- Clayton Christensen, *Jobs to be Done* (The Innovator's Solution,
  2003)
- Alan Cooper, *About Face: The Essentials of Interaction Design* —
  goal-directed design
- Adam Wathan & Steve Schoger, *Refactoring UI* —
  [refactoringui.com](https://refactoringui.com/)
- Apple *Human Interface Guidelines* (Layout, Safe areas, size classes,
  touch targets); Google *Material Design* (Adaptive layout, touch
  targets)
- Nathan Curtis (EightShapes) — design-system token/component practice
