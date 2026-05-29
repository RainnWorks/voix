# M04 audit — Marina (macOS HIG zealot)

**Persona**: 12 years at Apple Design Evangelism, now a consultant.
Believes in the system. SF Pro Text/Display weighted exactly as Apple
does, system focus rings, 8-pt spacing grid, native menu-bar
conventions. Allergic to "let's invent our own input style."

**File audited**: `voix-backend/ui/src/voices/VoiceEditor.tsx`
**Reference docs supplied**: `theme.ts`, `voix-desktop-guide.html`

## Punch list (16 items)

1. **L74**: `ActivityIndicator color={colors.haBlue}` — HA blue in a
   loading spinner is chrome. Use `sysAccent` or no tint.
2. **L93–106**: `nameInput`/`descInput` strip borders + padding +
   background; read as labels, not inputs. Zero focus affordance, zero
   hit target. Use system TextInput look or restore an affordance.
3. **L144–152, 187–195**: `textarea` and inline `input` have no
   `outlineStyle` / explicit focus state. Verify browser default ring
   still renders; nothing preserves it.
4. **Magic spacing numbers**: L289 `marginBottom: 8`, L290 `gap: 4`,
   L325 `gap: 4`, L332 `marginBottom: 4`, L338 `gap: 10` (not on 8-pt
   grid), L344 `padding: 2.5`, L364 `gap: 2`. Use tokens.
5. **L293**: voice-name `fontSize: 18, fontWeight: "500"`. Apple's
   Title 3 is 20/semibold or Headline 17/semibold. 18/500 is felt.
6. **L279, 302, 311, 329, 367, 372, 380, 390**: scattered font sizes
   (13, 12, 10, 11). Apple's text styles: 17/15/13/12/11. The 10-pt
   section label is below Caption 2 minimum.
7. **L286, 313**: `letterSpacing: 1` and `1.5` on uppercase mono
   labels. JetBrains Mono is wide; tracked uppercase is a 2014
   dashboard tic. Pick one or none.
8. **L327–333**: `phaseHint` line-height 16 hard-coded. Use a ratio.
9. **L383 vs L394**: same control family, two radii (`radius.sm` vs
   `radius.md`). Pick one.
10. **L382**: inline input `padding: 6` not on grid. `spacing.sm` (8).
11. **L406–412**: error box hand-rolls `#fff3f0`, `#f5c6c0`, `#a02d20`.
    No semantic `colors.danger*` tokens.
12. **L411**: `fontWeight: "500"` with no size set — inherits default.
13. **L142, 185**: em dashes in placeholder hints. Desktop guide says
    hand-set; comma or period.
14. **L66, 85**: `← Back` / `← Voices` literal Unicode arrow in body
    text. Use SF Symbol `chevron.left` or system back affordance.
15. **L91**: `<Puck size={56}>` — 56 not on 8-pt grid. Should be 48 or 64.
16. **L161, L200–210**: free-text `TextInput` for enumerable values
    (TTS voice list, OpenAI/OpenRouter provider). Should be Picker or
    segmented control. Provider's `onChangeText` silently coerces.

**Net**: hold / fix 16 items first.

## Triage (decided by parent agent)

| # | Disposition |
|---|---|
| 1 | **Fix in M04** — spinner colour swap, trivial |
| 2 | **Fix in M04** — add focus-revealed border to name/desc inputs |
| 3 | **Fix in M04** — explicit focus visibility verification |
| 4 | **Fix in M04** — replace magic numbers with `spacing.*` tokens |
| 5 | **Fix in M04** — bump name to 17/600 (Headline) |
| 6 | **Fix in M04** — consolidate to Apple's scale (15/13/12/11) |
| 7 | **Fix in M04** — drop letterSpacing on mono labels |
| 8 | **Fix in M04** — use ratio `lineHeight` where reasonable |
| 9 | **Fix in M04** — same radius family for inputs + textarea |
| 10 | **Fix in M04** — bump to `spacing.sm` |
| 11 | **Defer** — add `colors.danger*` tokens in a follow-up theme PR |
| 12 | **Fix in M04** — give error title an explicit size |
| 13 | **Fix in M04** — replace em dashes |
| 14 | **Defer** — needs RN-Web SF Symbols shim; not blocking |
| 15 | **Fix in M04** — Puck → 48 or 64 |
| 16 | **Defer** — Picker primitive belongs in `clients/shared/`; M19+ |
