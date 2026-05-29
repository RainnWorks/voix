# M13b audit — Wren (voice-first product designer)

**File audited**: `voix-backend/ui/src/voices/VoiceEditor.tsx` (rewrite)
**Reference**: `m04-wren.md` (prior audit), design-brief §2 + §3
**Trigger**: user told the maintainer that M04 wasn't making the
"Realtime is conversational + can output via tool; Dictation is
straight-to-LLM" model clear.

## Net read
Real step up. Type-as-primary-axis is correct, the asymmetric two-pip
vs single-block layout physically embodies the model. But the rewrite
stumbles on the *exact* clarity the user flagged.

## Punch list (6 items)

1. **"Conversation" vs "No conversation" not load-bearing enough.**
   Subtitles are parallel-shaped but not contrastively-shaped. Lead
   with what each type IS:
   - Realtime: "Back-and-forth voice chat. The model speaks back."
   - Dictation: "One-shot. You talk, the model writes it down."
2. **"produce_output tool" leaks architecture.** Mechanism in
   user-facing copy. Rephrase: "If the conversation reaches a point
   where you want a written result, the model writes it using this
   prompt. Otherwise it's just a chat." Keep the literal tool name in
   code comments.
3. **"Straight to the LLM" is engineering shorthand.** Try: "You
   speak. We transcribe. The model shapes it into the result below."
4. **Required/Optional tags are decorative.** Empty talkingPrompt
   still saves silently. Either enforce (block save / show inline
   warning) or downgrade to "Needed" / "If you want one".
5. **Type chooser reads as a settings row.** Two equal-weight cards.
   The primary decision should feel heavier — bigger title, an icon
   (waveform vs transcript), more separation from the puck-colour row.
6. **Tone snippet still missing.** M04 #8 was deferred but the
   "voice-as-character" complaint keeps resurfacing.

**Net**: hold / fix 4 items first.

## Triage

| # | Disposition |
|---|---|
| 1 | **Fix in M13b** — rewrite subtitles |
| 2 | **Fix in M13b** — rephrase donePrompt hint |
| 3 | **Fix in M13b** — rephrase Dictation phase hint |
| 4 | **Fix in M13b** — soften tag wording (also Marina #3) |
| 5 | **Partial M13b** — bigger title; icon deferred until we have an icon set |
| 6 | **Defer** — needs design exploration, M16+ |
