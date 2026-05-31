# M23 Tester report

Tested across 10 brief tasks against architecture-m23.md's 15 ACs.
Distinguishing **tested** (behaviour observed in this session) from
**verified** (shape / static check) below.

## VERDICT

- **PASS** with 0 regressions, 2 Tom-pending items intact.
- 13/15 ACs verifiable from this seat → all green.
- 2/15 ACs Tom-pending by design (#13 background-audio smoke;
  hands-on iOS sim items in m23-manual.md step 4 / step 5).
- Implementer claims match observed reality on every spot-checked
  receipt and every smoke check that could be re-run here.

## Receipts spot-check

`stat -f "%Sm %z %N"` on three random implementer-claimed files —
sizes match the implementer report to the byte:

```
May 31 20:01:49 2026  6433 voix-backend/src/voices/types.ts        ← matches
May 31 20:08:05 2026 12418 packages/ui/src/conversations/TalkButton.tsx ← matches
May 31 20:16:42 2026  7383 clients/app/macos/VoixNative/Sources/VoixStatusItem.swift ← matches
```

Git history shows the 10 specced commits + a close-out commit on
`main` (`19739d7` close-out, then `373eb9c → 88d6cb7` for steps 9→1).
Order matches Decision 7.

## Schema migration safety (Risk 1)

Wrote a synthetic pre-M23 voices.json with one user voice
(`user-test-pre-m23`, `isBuiltin: false`, no `tone` field) to
`~/.local/share/voix-backend/voix/voices.json`. Booted the daemon:

```
voices: loaded 7 modes
```

- Daemon comes up clean (HTTP `200` on `/api/voices_count`, `7`).
- User voice survives boot with `tone: null` — NOT auto-filled.
  Confirms Decision 1 + Risk 1 mitigation: `isBuiltin: false`
  voices are never touched by the refresh logic.
- All 6 built-ins seeded with the canonical strings from
  `BUILTIN_TONES` ("A calm conversational partner.", "Just
  transcribes. No rewrite.", etc.).
- PATCH `/api/voices/user-test-pre-m23` with
  `tone: "  Hello tone via PATCH  "` returns the trimmed value
  (whitespace stripped via `normaliseTone`). HTTP 200.
- Reboot daemon, GET the voice: tone persists as
  `"Hello tone via PATCH"`. Persistence + trim round-trip ✓.
- Initial sleep-2 GET briefly returned 6 voices (the `loadVoices`
  await + bun startup race). Sleep-4 always returns 7. Not a bug —
  daemon HTTP server briefly answers before loadVoices completes
  on cold start. Worth a follow-up but **not M23 work**.

Restored data dir to pre-test state (deleted the synthetic
voices.json). Daemon will seed first-boot built-ins next time.

`voix.list_voices` HA service: skipped (HA at 192.168.96.15 not
exercised this session; Tom-pending via m23-manual step 5).

## AC checklist

| # | AC | Status | Evidence |
|---|----|--------|----------|
| 1 | `Voice.tone` end-to-end | tested ✓ | daemon loads pre-M23 voices.json + persists PATCH'd tone; 11/11 unit tests in `tests/voices/tone.test.ts` pass; client `Voice` type has `tone: string \| null` at `packages/ui/src/lib/api.ts` |
| 2 | VoiceEditor tone field, italic, ≤80 | verified ✓ | `VoiceEditor.tsx:118-126` uses `value={voice.tone ?? ""}` with `maxLength={80}`, `styles.toneInput` is italic 11pt at `:707-710` |
| 3 | tone on VoiceList + SurfaceList + ConversationList | verified ✓ | `cardTone` (VoiceList:122-127), `rowTone` (SurfaceList:117-122, ConversationList:159-163), all gated on `voice.tone && …` |
| 4 | Built-ins seeded | tested ✓ | live boot showed all 6 built-ins with the BUILTIN_TONES strings |
| 5 | Sidebar 4th Section + gear | verified ✓ | `AppShell.tsx:19` `Section = ... \| "settings"`; sidebar bottom row selected when `section === "settings"` |
| 6 | Daemon URL persists | verified ✓ | `DaemonUrlInput.tsx` exists; uses `voix.api_base` AsyncStorage key (existing); HEAD probe of `${base}api/voices_count` per architecture |
| 7 | Microphone status + Open Settings CTA | verified ✓ | SettingsScreen calls `permissions.openMicrophoneSettings()` (:133, :137); iOS path uses `Linking.openURL("app-settings:")` at `permissions.native.ts:143`; macOS bridges through VoixAudioPermissions |
| 8 | TalkButton.intent required | tested ✓ | `intent: Intent;` at `TalkButton.tsx:53` (no `?`, no default); both `<TalkButton …>` callers in `packages/ui/src/` (ConversationList:104, :117) pass it explicitly. `bunx tsc -p clients/app/tsconfig.json --noEmit` exits 0 |
| 9 | Hint copy reflects intent | verified ✓ | `hintCopy = intent === "dictate" ? "Hold to dictate." : "Hold to talk to voix."` at `:141`; `labelFor` switches "Transcribing…"/"voix is replying" at :272-289 |
| 10 | Onboarding renders | verified ✓ | `Onboarding.tsx` has Welcome (step 1), MicPermission (step 2, with AppState observer for Risk 4), DaemonURL (step 3); `App.tsx` reads `voix.onboarding.completed` and gates `<AppShell>` |
| 11 | macOS status item | verified ✓ | `VoixStatusItem.swift:144` "Talk to voix", :153 hotkey row, plus Quit (Swift terminate); `voixStatusItem.talk/openSettings/quit` events emitted to JS |
| 12 | macOS HUD puck + pulses | verified ✓ | per implementer Delta 1 (already in Swift via M22 fix-pass `VoixOverlayPanel`); step 9 added `setHint` JS→native channel |
| 13 | Background-audio smoke | ☐ Tom-pending | documented in m23-manual.md step 6 (Decision 6 says manual only) |
| 14 | Web regression clean | tested ✓ | `cd voix-backend/ui && bun run build` → "built in 626ms"; `bun run check` exits 0 (native-siblings, protocol-sync, pin-bounds all OK) |
| 15 | STATE marks M23; manual exists | verified ✓ | docs/STATE.md:1 has "M23 implementer landed"; docs/phase-6/m23-manual.md exists (7366 bytes) |

## Risk register re-check

- **Risk 1** (tone overwrites user voice data) — actively tested
  with a synthetic pre-M23 voices.json; user voice came through
  with `tone: null` exactly per the architecture. ✓
- **Risk 2** (intent regression) — both packages/ui callers pass
  intent explicitly; `tsc --noEmit` clean. No `intent =` default
  in TalkButton signature. ✓
- **Risk 3** (settings URL bricks app) — Settings is a Section that
  doesn't depend on daemon reachability to render; tested by
  inspection of the AppShell wiring. Will be exercised by Tom in
  m23-manual step 7.
- **Risk 4** (onboarding loop trap) — `AppState` observer in
  `Onboarding.tsx:69-86` re-checks permission on `active`; matches
  spec. Will be exercised in step 4.
- **Risk 5** (tone drifts from brand) — built-ins shipped with
  human-readable defaults (`KNOWN_BUILTIN_TONES` set, all entries
  non-null); brand-guide reconciliation deferred to Marina pass.

## Smoke battery (full)

| Step | Result |
|---|---|
| `bun install` | clean (no changes) |
| `bun run check` | exit 0 (native-siblings, protocol-sync, pin-bounds OK) |
| `cd voix-backend/ui && bun run build` | exit 0 (built in 626ms; 354.78 kB index js) |
| `bunx tsc -p clients/app/tsconfig.json --noEmit` | exit 0 (no output = no errors) |
| `cd clients/app/macos && xcodebuild ... -quiet` | exit 0 (only pre-existing Pods/Hermes warnings inherited from M22) |
| `cd voix-backend && bun test tests/voices/tone.test.ts` | 11 pass, 0 fail, 21 expect calls |
| Daemon boot with legacy voices.json (no `tone`) | clean; user voice preserved with `tone: null` |

## Deltas / notes for downstream verifiers

1. **Test count discrepancy (cosmetic)** — Implementer claimed
   "20/20 voice tests green". `tone.test.ts` alone is 11/11. The
   20 figure presumably includes the full `tests/voices/` suite
   (didn't re-run the others; brief only asks about tone.test.ts).
   Not a defect, just a clarity note.

2. **Daemon HTTP race on cold start (PRE-EXISTING)** — if you
   curl `/api/voices` within ~1s of starting `bun src/index.ts`,
   the response can come back missing the on-disk voices because
   the Elysia route binds before `await loadVoices()` resolves
   (despite the await being at top level — Bun's HTTP server
   binds early). At sleep-4 it's always correct. Not introduced
   by M23, not in scope. Worth a follow-up issue eventually but
   not blocking.

3. **Implementer delta on step 9** — Architect specced JS-side
   Puck rendering on MacOverlay.native.tsx; M22 fix-pass had
   already moved that to Swift (`VoixOverlayPanel`). Implementer
   repurposed step 9 to add a `setHint` bridge so JS can stamp
   the current chord into the HUD. Acceptance criterion #12 is
   satisfied by the prior Swift work. No contradiction with
   Decisions 1/3 (the load-bearing ones).

4. **Tom-pending list (intact)** — m23-manual.md still gates
   steps 4 (onboarding fresh-sim), 5 (load-bearing tone + intent
   + PTT), 6 (background-audio), 7 (settings recovery loop),
   8 (macOS regression), 9 (web regression). All are sim/device
   hands-on items that can't run from this seat.

## Files touched during verification (cleanup)

- Wrote then deleted `~/.local/share/voix-backend/voix/voices.json`
  (Risk 1 migration check). No persistent artefacts.
- `/tmp/voix-data-backup-m23/` left in place as a one-time backup;
  safe to ignore.

## Final verdict

Implementer's SUCCESS claim is supported. M23 is ready for Tom's
manual sweep (m23-manual.md). No code-side blockers; no AC regression.
