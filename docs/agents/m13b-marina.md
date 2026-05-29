# M13b audit — Marina (macOS HIG zealot)

**File audited**: `voix-backend/ui/src/voices/VoiceEditor.tsx` (rewrite)
**Reference**: `m04-marina.md` (prior audit), `theme.ts`, desktop guide

## M04 follow-up
Items 1-10, 12, 13, 15 **fixed**. Items 11, 14, 16 **deferred** (per
triage decisions in m04-marina.md).

## New punch list (7 items)

1. **TypeOption uses HA blue for chrome** — selection bg/border/title
   all `haBlue`. That's chrome, brand reserves `sysAccent`. Also
   triple-uses HA blue on one screen (puck + Required tag + selected
   type). Swap to sysAccent; pick one HA-blue moment per screen.
2. **TypeOption off 8-pt grid** — `gap: spacing.xs` (4) between
   title/subtitle plus 11/lineHeight 16 yields 27-pt block. Bump
   subtitle to 12/18 to match `phaseHint`.
3. **Required/Optional tags compete with section label** — same
   mono 11 uppercase as the heading next to it. Drop to 10 with
   tighter pill, or sentence-case UI font.
4. **Layout shift on type switch** — Realtime has 24-pt rail gutter,
   Dictation does not; textarea jumps ~36 px left. Keep rail gutter
   on SimplePhase for column alignment.
5. **Keyboard order surprise** — TypeOption is a `Pressable` with no
   `role="radiogroup"` / `accessibilityRole="radio"`, no arrow-key
   nav. Treat as a real radio group.
6. **phaseRailLineBottom uses negative `bottom: -spacing.lg`** to
   bleed into the gap. Fragile against token changes; render the
   rail as a single span across both phases.
7. **donePromptFilled hides Output phase section** when prompt is
   empty. Toggling discoverability away from the user. Show disabled
   rather than disappear.

**Net**: hold / fix 7 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M13b** — sysAccent on type chooser |
| 2 | **Fix in M13b** — subtitle 12/18 |
| 3 | **Fix in M13b** — drop pill size; softer wording (also Wren #4) |
| 4 | **Fix in M13b** — rail gutter on SimplePhase |
| 5 | **Defer** — accessibility audit is its own milestone |
| 6 | **Defer** — rail-as-single-span needs more layout surgery |
| 7 | **Fix in M13b** — show output section disabled when empty |
