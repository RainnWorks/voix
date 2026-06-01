# B2 — Tone-snippet copy polish

**Date:** 2026-06-01
**Backlog item:** B2 (Wren M-Voices #4) — rewrite the two weak built-in
voice tone snippets (Realtime, Email) to match the on-brand snappy
register, plus an AI-tell lint sweep across tones + two UI files.

## TL;DR

The tone-copy rewrite was **already shipped** in commit
`9a4425c` ("ui+voices(M23 fix): copy polish — Connect to voix +
Realtime/Email tones (Wren F3+F4)", 2026-05-31). The backlog was
written against the pre-fix copy. Both flagged tones are now on-brand
and were verified against the strong-set register — no further copy
change needed.

The real remaining work this pass was the AI-tell lint sweep, which
surfaced **4 user-facing em-dashes** in `VoiceEditor.tsx` /
`Onboarding.tsx` (sentence-level microcopy, not tones). All four were
removed.

## Tone snippets — before / after

`BUILTIN_TONES` in `voix-backend/src/voices/builtins.ts`:

| Voice     | Backlog (pre-fix, weak)              | Live now (on-brand)                          | Action |
|-----------|--------------------------------------|----------------------------------------------|--------|
| Realtime  | `A calm conversational partner.`     | `Talks back. Knows when to shut up.`         | already fixed — kept |
| Email     | `Polite and professional. Always lands.` | `Reads like you meant it.`               | already fixed — kept |
| Dictation | —                                    | `Just transcribes. No rewrite.`              | strong — kept |
| Message   | —                                    | `Crisp messages. No fluff.`                  | strong — kept |
| Note      | —                                    | `Quick capture for future-you.`              | strong — kept |
| Code      | —                                    | `Plain prompts. Comments where they earn it.`| strong — kept |

The original weak strings (`A calm conversational partner.`,
`Polite and professional. Always lands.`) are correctly preserved in
`KNOWN_BUILTIN_TONES` (historical section), so a pre-fix install that
upgrades will refresh its on-disk tones to the new copy.

### Why the live copy was accepted, not re-churned

The task asked to verify what's live and, "if Realtime is currently the
strong `Talks back. Knows when to shut up.` then Email is the only one
to fix." Realtime is indeed that line — so the gate pointed at Email.
But Email is **also** already rewritten, to `Reads like you meant it.`,
which passes the register test:

- **Snappy, declarative, period-terminated** — matches the set.
- **No em-dash, no comma-splice, no exclamation** — brand-clean.
- **Voice-character, not corporate** — "reads like you meant it" is a
  human, confident line about intentional writing. It deliberately
  avoids the AI-tell vocabulary ("professional", "polished",
  "high-quality") that the old `Polite and professional…` leaned on.
  The seed option `Polished but not stiff.` was considered and rejected
  because "polished" drifts back toward the corporate register the
  brand guide warns against.

Re-writing an already-on-brand, already-committed string would add a
needless `KNOWN_BUILTIN_TONES` history entry and a disk-refresh churn
for every install, for no register gain. Kept as-is. (Seed alternatives
remain on the table if Wren wants a different Email line later — this is
a one-line change plus a history entry.)

## AI-tell lint sweep

### Built-in tones (`builtins.ts`)

Scanned `BUILTIN_TONES` for the full lint set:

- **Em-dashes (—)** brand-forbidden per voix-brand-guide §09: **none** in any tone.
- **`harness` / `seamlessly` / `intelligent` / `powerful` / `robust`** (Wren AI-tell list): **none** anywhere in the file.
- **Exclamation marks** (brand-forbidden in tones): **none**.

(The file does contain em-dashes, but only in (a) code comments and
(b) the LLM post-process / realtime system-prompt bodies — neither is
brand-facing tone copy, so §09 does not apply. Left untouched.)

### UI files

`packages/ui/src/onboarding/Onboarding.tsx` and
`packages/ui/src/voices/VoiceEditor.tsx`:

- **`harness/seamlessly/intelligent/powerful/robust`**: none.
- **Exclamation marks** in displayed/JSX text: none.
- **Wren's prior em-dash flags (Onboarding `:155`, `:240`)**: verified
  **already fixed** — those line numbers now hold unrelated code; no
  em-dash remains in that copy.
- **New finds — user-facing em-dashes in displayed microcopy (fixed):**

  | File | Before | After |
  |------|--------|-------|
  | `VoiceEditor.tsx` (type hint) | `…during the conversation — its persona, its rules, its register.` | `…during the conversation. Its persona, its rules, its register.` |
  | `VoiceEditor.tsx` (donePrompt empty-state) | `Disabled — this voice has no "When I'm done" prompt, so…` | `Disabled. This voice has no "When I'm done" prompt, so…` |
  | `VoiceEditor.tsx` (no-providers empty-state) | `No X providers configured — add an API key in Add-on options.` | `No X providers configured. Add an API key in Add-on options.` |
  | `Onboarding.tsx` (hero a11y label) | `voix — push-to-talk voice assistant` | `voix, push-to-talk voice assistant` |
  | `VoiceEditor.tsx` (save-error toasts ×2) | `Couldn't save — …` / `Couldn't save — check your connection.` | `Couldn't save. …` / `Couldn't save. Check your connection.` |

  > The two save-error toasts arrived mid-run from concurrent B1 work
  > (save-failure toast feature) after the first scan; caught on a
  > re-scan and fixed in a follow-up commit.

  Em-dashes that remain in these files are all in **code comments**
  (JSDoc/inline), not brand surface — intentionally left.

## Smoke

- `bun run check` → **OK** (native-siblings, protocol-sync, pin-bounds).
- `bun test` (voix-backend) → **140 pass / 0 fail**, incl.
  `tests/voices/migration.test.ts`.
- `bun run --filter voix-ui typecheck` → **0** (clean).
- `packages/ui` has no test files (no tone snapshot tests to break).

## Files changed

- `packages/ui/src/voices/VoiceEditor.tsx` — 5 user-facing em-dash removals (3 in first pass + 2 save-error toasts in follow-up).
- `packages/ui/src/onboarding/Onboarding.tsx` — 1 a11y-label em-dash removal.
- `voix-backend/src/voices/builtins.ts` — **no change** (copy already on-brand).
