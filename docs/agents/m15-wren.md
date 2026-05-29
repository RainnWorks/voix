# M15 audit — Wren (voice-first product designer)

**File audited**: `voix-backend/ui/src/voices/VoiceEditor.tsx`
**References**: `m04-wren.md`, `m13b-wren.md`

## Net read
Right call to default to Realtime and tuck this behind Advanced. The
decision belongs there — a user who never opens Advanced gets the
snappy thing. But the framing + abstraction need work.

## Punch list (5 items, 4 fixed in M15)

1. **"Realtime" vs "Traditional" framing is wrong even at Advanced.**
   "Realtime" collides with the voice *type* on the same screen.
   "Traditional" reads as legacy/worse when the actual trade is cost
   and pacing. Try **"Live" vs "Turn-based"** — describes the *feel*
   the user will perceive.
2. **Hint copy is engineering shorthand.** "Streaming STT +
   chat-completions LLM + TTS" is the inside of the box. Rewrite
   around feel + cost: *"Live keeps the conversation flowing —
   barge-in, overlap, ~300 ms replies. Turn-based waits for you to
   finish, then answers — closer to a walkie-talkie, but roughly a
   quarter of the cost."*
3. **Abstraction leaks too far on Traditional.** Five rows is
   settings-panel territory. With one TTS provider today, hide TTS
   provider + TTS voice. Three rows is enough.
4. **Switching engines silently changes the voice's timbre + pacing.**
   The Speaker field disappears entirely on Traditional. Add a one-
   liner under the engine toggle warning the user.
5. **Engine row should be the FIRST thing inside Advanced for
   Realtime voices** — it reframes everything below.

**Net**: hold / fix 4 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M15** — segmented labels become "Live" / "Turn-based"; daemon field values stay `realtime` / `traditional` |
| 2 | **Fix in M15** — rewrite desc on the Pacing row |
| 3 | **Fix in M15** — hide ttsProvider + ttsVoice rows |
| 4 | **Fix in M15** — fold the warning into the row desc (same place as the hint) |
| 5 | **Fix in M15** — Engine section moved to be the first thing inside Advanced (`Conversation feel` SectionLabel + Pacing row land before the engine-specific plumbing) |
