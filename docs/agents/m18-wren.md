# M18 audit — Wren (voice-first product designer)

**File audited**: `voix-backend/ui/src/conversations/TalkButton.tsx`

## Punch list (5 items, 3 fixed)

1. **"Speak" is bossy.** The `ready` label tells the user what to do.
   The puck doesn't say "Speak" — it lights up and listens. Drop the
   ready label OR skip the ready state and jump to "Listening".
2. **"voix is speaking" breaks the voice register** we established
   in M17 ("What voix said"). Try "voix is replying" — closer to the
   conversation we're staging.
3. **Hint copy doubles up.** "Talk to voix" + "Hold to talk to voix"
   — the idle label already carries the verb. Drop the hint, or drop
   the label.
4. **No mic glyph.** Neutral dot reads as a status LED; ambiguous in
   a browser button. A mic glyph (filled when active) gives the row
   orientability without copy.
5. **Hold-to-talk is correct for v1.** Matches walkie-talkie mental
   model, no accidental hot-mic. Pill is small for finger taps
   though; not blocking.

**Net**: ship / hold / fix 3 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M18** — fold "ready" into "listening", drop the imperative |
| 2 | **Fix in M18** — "voix is replying" |
| 3 | **Defer** — small redundancy, hint stays for first-timers |
| 4 | **Fix in M18** — mic emoji as a stand-in until we have a real icon set |
| 5 | **Defer** — non-blocking; tap target debate |
