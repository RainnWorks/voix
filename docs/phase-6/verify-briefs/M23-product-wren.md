# M23 Product brief — Wren

You flagged the intent-hardcoded gap in M21. M23 ships the fix.
Validate the closure. Plus the 8-milestone tone gap finally shipping
needs your eye — tone is character; character is product.

## Read

- `docs/phase-6/architecture-m23.md` Decisions 1 (tone), 3 (intent), 4
  (onboarding).
- `docs/phase-6/verify-results/M23-implementer-report.md`.
- `docs/phase-6/verify-results/M21-product-wren.md` — your prior
  finding being closed here.
- `voix-brand-guide.html` + `voix-desktop-guide.html`.
- Current state of `packages/ui/src/conversations/TalkButton.tsx`,
  `packages/ui/src/voices/VoiceList.tsx`, the new settings + onboarding
  components.

## Tasks

1. **Intent gap closure** — your M21 finding was iOS hardcoded
   `intent: "discuss"`. M23 should:
   - Make intent required at the type level (Architect Decision 3).
   - Derive from voice.type at the consumer.
   - Render different hint copy.
   Walk through TalkButton's render tree and confirm. If a default
   sneaks back in (silent regression), flag.

2. **Tone snippet copy quality**. The architect seeded built-in tones
   ("Implementer pulls final from brand guide or ships null"). Read
   the actual values shipped:
   - Are they voice-character, or generic ("formal", "casual")?
   - Do they read like a designer wrote them, or a developer?
   - Length: are they snappy (≤80 chars) or filler?
   - Does each built-in voice's tone feel distinct?

3. **Voice character in the editor**. The tone field is editable
   per voice. Read the editor UI:
   - Does the input have placeholder copy that suggests a voice
     character ("How does this voice sound?")?
   - Is the maxLength visible to the user (e.g. "47/80")?
   - When a user clears tone, does the voice card fall back
     gracefully?

4. **Onboarding flow as a product story**. Three screens:
   welcome / mic / daemon URL. Does the welcome screen explain
   what voix is in one sentence? Does the mic screen explain
   why voix needs the mic? Does the daemon URL screen feel like
   a tech-y exception or part of the story?

5. **Settings screen information architecture**. Five sections
   per the brief. What's the visual hierarchy? Is "Daemon URL"
   buried under "Advanced" or in user-facing space? Same for
   "Sample rate override".

6. **macOS first-launch onboarding**. Same component as iOS. Does
   it feel right on a larger window?

7. **The hidden voice-defaults question**. The architect mentioned
   "Implementer pulls final from brand guide or ships null." Did
   they ship copy or null? Either is defensible:
   - Copy → has to be good copy
   - Null → tone snippet doesn't render → 8-milestone gap technically
     still open

8. **Watching briefs carried to M24**:
   - Tone field on Voice now exists → editor UI in the next pass?
   - Keyboard extension is M24 territory.
   - macOS hotkey rebind UI (KeyboardShortcuts SPM swap) is M23.5
     per architect.

## Output

`docs/phase-6/verify-results/M23-product-wren.md` per the brief's
structure (Receipts / Brand continuity / Findings by severity / The
one thing brief should have anticipated).

What matters: did M23 close the intent + tone gaps with PRODUCT
quality, or with code that compiles?
