# M17 audit — Marina (macOS HIG zealot)

**Files audited**: `ConversationList.tsx` + `ConversationDetail.tsx`

## Punch list (6 items, 4 fixed)

1. Row hit target ~46 px, under 44 px floor when preview collapses.
   Set `minHeight: 44`.
2. Middot soup in row header — 4 facts on one line. Split.
3. `shaped` tag matches the m16 micro-tag pattern. Keep.
4. Section pattern matches PhaseBlock — good. Sections "float"
   without a hairline. Defer: works.
5. Context KV grid: `minWidth: 100` on keys causes ragged wrap.
   Use `flexBasis: 140` + `flexShrink: 0`.
6. Audio: bare `mic`/`speaker` mono lowercase is inconsistent
   with `sectionLabel` font. Promote.

**Carry-overs**: `formatDuration` + `formatTimestamp` are
hand-rolled — extract.

**Net**: hold / fix 3 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M17** — minHeight 44 |
| 2 | **Fix in M17** — split header into two lines |
| 3 | (already shipped) |
| 4 | **Defer** — section rhythm works |
| 5 | **Fix in M17** — flexBasis on keys |
| 6 | **Fix in M17** — Wren's parallel call to rename mic/speaker covers this |
| carry-over | **Defer** — locale + dedupe sweep |
