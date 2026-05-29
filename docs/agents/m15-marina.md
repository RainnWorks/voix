# M15 audit — Marina (macOS HIG zealot)

**File audited**: `voix-backend/ui/src/voices/VoiceEditor.tsx`
**References**: `m04-marina.md`, `m13b-marina.md`

## Punch list (6 items, 3 fixed in M15)

1. **Hint vs SectionLabel competes** — long paragraph above a 2-choice
   toggle + the `Engine` row's own `desc` is redundant. Shorten to one
   line or move the long copy into the row `desc`.
2. **Five-row Traditional stack lacks rhythm** — STT/Chat/TTS are three
   sub-concerns flat-listed. Sub-label or hairline dividers.
3. **Layout shift on engine toggle** — Realtime shows 2 rows
   (~140 px), Traditional shows 5 (~350 px). Output phase below jumps
   ~210 px. Family of m13b #4.
4. **8-pt grid** — clean. No new violations.
5. **Deferred items still deferred** — m04 #14 (SF Symbols), #16
   (Picker primitive), m13b #5 (radio a11y), #6 (rail span). New free-
   text inputs for ttsProvider / ttsVoice / sttModel re-raise m04 #16.
6. **`voice.discussEngine ?? "realtime"` repeats 3×** — segmented value
   falls back to `"realtime"` while save sends derived state; minor
   desync risk.

**Net**: hold / fix 3 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M15** — collapse hint into `desc` on the Pacing row |
| 2 | **Partial fix in M15** — Wren's parallel call to hide ttsProvider + ttsVoice cuts the stack from 5 → 3, no sub-label needed |
| 3 | **Defer** — needs RN-Web LayoutAnimation work; behind Advanced so lower-stakes |
| 4 | (already clean) |
| 5 | (deferred per prior triages) |
| 6 | **Defer** — refactor into a derived value; low priority |
