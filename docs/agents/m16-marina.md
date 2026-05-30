# M16 audit — Marina (macOS HIG zealot)

**File audited**: `voix-backend/ui/src/surfaces/SurfaceList.tsx`
**References**: m04-marina, m13b-marina, m15-marina

## Punch list (7 items, 4 fixed in M16)

1. **HA blue on `clientKindTag`** — third audit running into this. The
   clientKind is a taxonomy label, not a "voix moment". Use
   `bgSubtle`. Carry-over of m04 #1 + m13b #1.
2. **Tag/chip soup** — two pills inline with the name, then mono pills
   below at the same treatment. Indistinguishable. Distinguish: tags
   = sentence-case UI font @ 10, chips = mono @ 11.
3. **Puck at 36 px** off 8-pt grid. Should be 32 or 40.
4. **`formatLastSeen` hand-rolled** — `Intl.RelativeTimeFormat` would
   handle plurals + locale. Inconsistent with the `toLocaleDateString`
   fallback that DOES localise.
5. **Empty state copy reads like docs.** "A surface is …" is a
   definition paragraph. Settings-page voice: one sentence.
6. **`rowMeta` mixes axes** — last-seen is state, voice is assignment.
   Two facts on one line with a middot reads as one.
7. **`gap: 0` on scroll** — relies entirely on hairline rule for
   rhythm; tight inside `rowBody`.

**Net**: hold / fix 3 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M16** — swap to `bgSubtle` |
| 2 | **Fix in M16** — distinguish tag vs chip treatment |
| 3 | **Fix in M16** — bump to 32 |
| 4 | **Defer** — locale work, not blocking |
| 5 | **Fix in M16** — shorter, friendlier copy |
| 6 | **Fix in M16** — split last-seen vs voice onto two lines |
| 7 | **Defer** — works; would tune in a follow-up sweep |
