# M16 audit — Wren (voice-first product designer)

**File audited**: `voix-backend/ui/src/surfaces/SurfaceList.tsx`
**References**: m04-wren, m13b-wren, m15-wren

## Punch list (5 items, 3 fixed in M16)

1. **"Surfaces" doesn't land cold.** With one puck and zero alt
   endpoints shipping, a sidebar entry labelled "Surfaces" is a
   riddle. Empty-state copy proves it — it has to *explain* what a
   surface is. Until row 2 is visibly not a puck, "Devices" is more
   honest. (Build plan dictates the rename, so I'm keeping the
   sidebar label — but addressing the cold-read problem in the
   empty state.)
2. **Chip strip is a spec sheet, not a character beat.** "mic 16 kHz
   mono / speaker 24 kHz / AEC on chip" is diagnostic gold for me
   debugging an echo, pure noise for the user. Brief is opinionated
   against settings-soup.
3. **"hello" in the empty state is protocol jargon.** Voice-first
   user has no model for this. Rephrase as "first time they connect".
4. **Active voice is named, not embodied.** Surfaces row is the
   *right* home for a tone snippet — the surface is where the voice
   is speaking. M04 #8 deferred again though.
5. **No glyph distinction by `clientKind`.** Every row gets a `Puck`
   regardless of kind. That visual cue is the *one* thing that earns
   the "Surfaces" rename — without it, "Surfaces" is "Devices with a
   fancier word."

**Net**: hold / fix 4 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Partial fix** — sidebar label stays per build plan, empty state reframed to set expectation |
| 2 | **Defer / partial** — kept the chip strip (Marina counts on it for diagnostics) but reworded copy; full collapse-to-human-chip is design work for a future sweep |
| 3 | **Fix in M16** — "first connection" not "hello" |
| 4 | **Defer** — needs schema field for tone snippet, M17+ |
| 5 | **Fix in M16** — kind-aware glyph (puck/phone/browser) |
