# M17 audit — Wren (voice-first product designer)

**Files audited**: `ConversationList.tsx` + `ConversationDetail.tsx`

## Punch list (5 items, 4 fixed)

1. **Row preview reads as log entry.** ProcessedText is shaped
   artifact — sounds like the model, not the user. Use rawText
   for the snippet; "shaped" tag already flags polish.
2. **Detail order is auditor-first.** Transcript should lead
   (that's the utterance). Entry under it as "what voix made of it".
   Context + Audio tail.
3. **Context source labels are raw IDs.** `HA`, `voix` in mono
   uppercase. Non-engineer reads namespaces, not meaning.
   Humanise: "Your home" / "What voix knew about you".
4. **"mic" / "speaker" mono lowercase** is too quiet for the
   primary playback controls. "What I said" / "What voix said".
5. **Empty state isn't voice-first.** "Talk to a surface" — M16's
   word problem redux. "Next time you talk to voix…".

**Net**: hold / fix 4 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M17** — rawText for preview |
| 2 | **Fix in M17** — Transcript → Entry → Context → Audio |
| 3 | **Fix in M17** — humanised source labels (HA → "Your home", voix → "What voix knew") |
| 4 | **Fix in M17** — "What I said" / "What voix said" |
| 5 | **Fix in M17** — "Next time you talk to voix" empty state |
