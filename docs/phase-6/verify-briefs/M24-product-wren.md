# M24 Product brief — Wren

Final Phase 6 surface. The keyboard is voix's most public surface
once it ships — every other text field in iOS is now a potential
voix entry point. Get this right or the brand promise breaks.

## Read

- Your brief.
- `docs/phase-6/architecture-m24.md` Decisions 4 (UI), 5 (Full Access UX), 10 (Tom's manual).
- `docs/phase-6/verify-results/M24-implementer-report.md`.
- `voix-brand-guide.html` — keyboard is closer to brand surface than chrome surface.
- Swift sources for `KeyboardViewController` UI.

## Tasks

1. **Keyboard pill copy + presentation**. Architect specced "Talk to
   voix" pill in HA blue at top of keyboard. Read the Swift UI:
   - Is the pill thumb-sized for one-handed press?
   - Is the wordmark "voix /vva/" rendered next to/above?
   - Does the puck glyph appear? (Brand-correct voix-moment.)
   - Color: HA blue for the pill, system fonts for the "Talk to voix"
     label.

2. **Full Access onboarding inside the keyboard**. When the user
   enables the keyboard but hasn't toggled Full Access:
   - Does the keyboard show a kindly explanation, or just dies?
   - Is "Open Settings" a tappable button, or just text?
   - Copy quality: voix-considered or boilerplate?

3. **Brand discipline through the bounce**. When the user taps "Talk
   to voix", the host app opens. The capture screen — what's the
   first thing they see? Same as M21 PTT? Or a new "Keyboard capture"
   screen?

4. **Return-to-keyboard experience**. After the bounce → capture →
   transcription → return:
   - Is there a "voix is working…" state in the keyboard while it
     waits?
   - When text inserts, is it instant or animated?
   - If transcription fails, what does the keyboard show?

5. **Intent semantics — keyboard always = dictate**. The keyboard
   pastes back to the focused field, so intent is always "dictate"
   (not discuss). Per M23 the intent prop is required; the keyboard
   bounce should set it explicitly. Verify it's not silently
   defaulting.

6. **Globe-key UX**. iOS users switch between keyboards via globe
   key. Is voix one-tap to engage (just tap "Talk to voix") or two-
   tap (tap globe, then voix)? Both are fine; flag if the
   implementation feels confused.

7. **Adoption story**. Architect Decision 10 has Tom's manual but no
   user-onboarding for keyboard adoption ("how do I add voix to my
   keyboards"). Is there an in-app hint or first-launch note in the
   iOS host app pointing to System Settings → Keyboard?

8. **Watching briefs**:
   - Tone gap CLOSED (M23). Re-verify: does the keyboard's host-app
     bounce preserve the active voice's tone in the capture screen?
   - macOS hotkey rebind UI still M23.5 deferred.
   - Apple Developer Program seat — Tom dependency for physical
     device, flagged in M24 brief.

## Output

`docs/phase-6/verify-results/M24-product-wren.md` standard structure.

The keyboard surface is voix's most public touchpoint. Empty findings
is acceptable only if every surface is brand-considered.
