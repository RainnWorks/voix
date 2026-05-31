# M23 Tester brief

Run all 15 acceptance criteria from `docs/phase-6/architecture-m23.md`.
Distinguish tested (shape) from verified (behavior).

## Read

- `docs/phase-6/architecture-m23.md` — ACs at the bottom.
- `docs/phase-6/verify-results/M23-implementer-report.md`.
- `git log --oneline -15`.

## Tasks

1. **Receipts** — spot-check 3 files. Stop on mismatch.

2. **Schema migration safety** — load test:
   - Daemon boots clean with existing voices.json (no `tone` field): `cd voix-backend && timeout 5 bun src/index.ts`.
   - `tone` is read + persisted: PATCH a voice with tone via the API, re-boot, confirm persistence.
   - `voix.list_voices` HA service returns tone field (skip if HA not reachable; mark Tom-pending).

3. **Intent-required compile check** — grep `packages/ui/src` for any `<TalkButton` without explicit `intent` prop. Should be 0. If the prop has a default in the impl, that's a regression (Wren's gap reopens).

4. **Voice-driven intent** — find a voice with `type: "realtime"` and one with `type: "dictation"`. Confirm TalkButton's hint copy switches between "Hold to talk to voix" and "Hold to dictate" based on voice.

5. **Settings screen present** — `packages/ui/src/settings/` (or wherever architect placed it) exists. AsyncStorage `voix.settings.*` keys plumbed.

6. **Onboarding flow** — first-launch flag `voix.onboarding.completed` persists. Three screens.

7. **macOS carry-forwards** — NSStatusItem visible in menu bar (read Swift source); HUD puck pulse rendering; same onboarding component.

8. **All builds**:
   - `bun run check` exits 0
   - `bun run build` UI works
   - daemon boots
   - `bunx tsc -p clients/app/tsconfig.json --noEmit` from both root + leaf
   - `xcodebuild voix-macOS Debug` succeeds

9. **Inline audio + intent-aware Conversations** — Conversations entry detail still works on iOS (carry-forward from M21).

10. **Tom-pending acceptance**:
   - Tone field renders italic HA-blue under name in iOS sim — needs sim screenshot
   - Settings screen navigation — needs Tom interaction
   - Onboarding first-launch path — needs fresh-install sim state

## Output

`docs/phase-6/verify-results/M23-tester.md` with VERDICT block.
