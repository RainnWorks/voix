# M21 Tester brief

Re-run every smoke the Implementer claimed; distinguish "tested
(build/typecheck exit 0)" from "verified (audio actually round-tripped
through the real daemon)".

## Read

- `docs/phase-6/architecture-m21.md` — acceptance criteria list at the bottom.
- `docs/phase-6/verify-results/M21-implementer-report.md` — claims.
- `git log --oneline -10` on main + the iOS sim screenshot the Implementer captured at `/tmp/voix-smoke-screenshots/m21-step5.png`.

## Tasks

1. **Receipts spot-check** — 3 file paths, re-`stat`, compare. Stop if mismatch.

2. **Acceptance criteria run-through** — every criterion in the brief's final section. Re-run the actual command. Capture last 20 lines.

3. **Platform shim integrity**:
   - `packages/ui/src/platform/` has the expected `.ts` + `.native.ts` pairs (audioCapture, audioPlayback, storage, websocket, appInfo, permissions, fetch — verify against the brief's Decision 1).
   - `scripts/check-native-siblings.ts` exits 0 with the new shims in place.
   - `scripts/check-pin-bounds.sh` (new in M21 per brief) exits 0; inject a fake mismatch (edit a pin in clients/app/package.json), confirm it exits non-zero; revert.

4. **DELETED files confirmed gone**:
   - `packages/ui/src/lib/apiBase.ts` + `.native.ts` — superseded by `platform/appInfo.*`.
   - `packages/ui/src/audio_io/client.native.ts` (M19 stub) — superseded by `platform/audioCapture.native.ts`.
   - Any consumer that still imports from the old paths is a finding.

5. **iOS PTT smoke** — the load-bearing acceptance:
   - Confirm daemon is running on `192.168.99.86:8765`.
   - Boot iPhone 16 Pro sim if it's not already running.
   - Open the voix app, tap TalkButton. (If you can't drive the UI, at least confirm the app launches and the screenshot the Implementer took shows TalkButton + Voices.)
   - Watch the daemon log for the PTT session: hello with `client_info.kind = "phone"` (or whatever protocol.ts declares), inbound mic frames, outbound speaker frames, clean session close.
   - **Test for audio format correctness**: grep the daemon log for `transcript_delta` events during the session. If the model receives the mic but transcripts are gibberish, that's an audio format bug.

6. **Web build sanity** — `cd voix-backend/ui && bun run build` still produces a working dist. Open the bundled UI via `bun run --filter voix-backend dev`'s dev server; the M18 web PTT should still work.

7. **macOS sanity** (non-audio) — if the app builds + launches on macOS, navigate to Voices (should populate from the daemon) and tap TalkButton. Expected: friendly "macOS audio lands in M22" error, NOT a crash. If it crashes, finding.

8. **Tested vs verified table**:

| Area | Tested (build/typecheck) | Verified (real dep) |
|---|---|---|
| Platform shim types | | |
| iOS pod install | | |
| macOS pod install | | |
| iOS audio capture frames | | |
| iOS audio playback frames | | |
| AsyncStorage persistence | | |
| Web build (HA add-on) | | |

"Verified" requires actual daemon log evidence for the audio rows.

## Output

`docs/phase-6/verify-results/M21-tester.md` with VERDICT block:

```
## VERDICT
- Receipts integrity: PASS | FAIL
- Acceptance criteria pass count: N/M
- iOS PTT round-trip: VERIFIED | UNVERIFIED (reason)
- macOS sanity: PASS | FAIL
- Web sanity: PASS | FAIL
- Blocking issues: <count + one-line each>
- Recommendation: ship-as-is | fix-and-reship | rework
```
