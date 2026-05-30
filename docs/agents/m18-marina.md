# M18 audit — Marina (macOS HIG zealot)

**File audited**: `voix-backend/ui/src/conversations/TalkButton.tsx`

## Punch list (2 items)

1. **Listening vs speaking visually identical.** JSDoc promises a
   pulse halo on listening and assistant halo on speaking; neither
   is implemented. Right now both states render an identical blue
   pill + blue dot. Speaking especially needs distinction so the
   user knows to stop talking.
2. **Error position wrong.** Errors render *above* the Pressable
   inside the same column. On error, the button shoves down,
   breaking spatial stability. Move below the hint.

HA blue on active: appropriate ("voix moment"). Pill shape +
gesture + hint copy correct.

**Net**: ship / hold / fix 2 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Partial fix** — distinguish speaking via dot ring + label colour; pulse animation deferred |
| 2 | **Fix in M18** — error moves below the hint |
