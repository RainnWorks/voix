# M04 audit — Wren (voice-first product designer)

**Persona**: 8 years at Krisp / Otter / Superwhisper. Axe to grind:
voice tools fail because their UIs are designed by people who think
users want to *configure* things rather than *speak through them*.
Good voice presets feel like characters, not settings rows.

**File audited**: `voix-backend/ui/src/voices/VoiceEditor.tsx`
**Reference docs supplied**: `docs/design-brief-multi-surface.md` §2, §3

## Punch list (13 items)

1. **Phase headers read as labels, not as a flow.** "When we're
   talking" sits above "When I'm done" with a hairline rule between
   them — no visual through-line saying these are *sequential phases
   of one session*. The killer-flow concept (§3) is buried.
2. **Empty-state language buried inside a hint paragraph.** Skippable-
   ness is the most important affordance — it's how a user understands
   the three mode shapes. Empty textarea looks identical to
   not-yet-filled-in.
3. **No visible flow-shape indicator.** Brief asks for "a small visual
   cue showing whether this mode is talk-only, output-only, or
   talk-then-output." Editor knows enough to draw it.
4. **Jargon throughout**: "artifact", "realtime phase", "output
   phase", "post-process", "Chat-completions model". SRE vocabulary
   in a character editor.
5. **Provider/model dropdowns at the wrong layer.** Tells the user
   this is a settings panel. Belong behind Advanced or in Defaults.
6. **Provider field silently coerces.** Free-text input; anything but
   "openrouter" snaps to "openai" on blur with no feedback.
7. **Voice field placeholder leaks OpenAI catalogue verbatim.** A
   voice-first user reads `alloy / ash / ballad / coral / echo / marin
   / cedar` as "pick one of these proper nouns I've never heard of."
8. **Identity row is name + one-liner.** No tone snippet, no quoted
   example. §2 asks for "a quote-styled snippet of the mode's tone."
9. **Placeholder prompts are generic, not voice-first.** `"You are
   voix…"` is model-instruction-style. Brief §2 wants "Write this as
   me emailing a vendor I'm annoyed with but still want to work with."
10. **"Voice" label collides with the noun "voice".** Editor is for a
    *voice* (the character), and one row is also called "Voice" (the
    TTS timbre).
11. **`routingHint` field leaks "routing hint" framing.** Code-name
    colours the prompt toward dispatching language. The brief frames
    it as the voice's *introduction*.
12. **No "Context" section.** Out of scope for M04; flagging because
    the editor will need it adjacent.
13. **Autosave failure replaces editor with full-screen error.** Mid-
    edit network blip nukes the screen.

**Net**: hold / fix 8 items first.

## Triage (decided by parent agent)

| # | Disposition |
|---|---|
| 1 | **Fix in M04** — sequential visual treatment for the two phases |
| 2 | **Fix in M04** — explicit "skipped" badge when prompt is empty |
| 3 | **Defer** — flow-shape pip belongs on the VoiceList card (M16+) |
| 4 | **Fix in M04** — de-jargon all copy |
| 5 | **Fix in M04** — move provider/model behind Advanced disclosure |
| 6 | **Fix in M04** — replace with a 2-button segmented control |
| 7 | **Fix in M04** — shorter placeholder + footnote of options |
| 8 | **Defer** — tone-snippet feature needs more thought; M16+ |
| 9 | **Fix in M04** — voice-first placeholder prompts |
| 10 | **Fix in M04** — rename "Voice" row → "Speaker" |
| 11 | **Fix in M04** — rephrase description copy |
| 12 | **Defer** — explicit Context section is its own milestone |
| 13 | **Fix in M04** — inline error toast, don't replace editor |
