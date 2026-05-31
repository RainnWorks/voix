# M21 Tester report

Re-ran every claim against reality. Implementer landed 7 commits
(`48fa361..076fdb3`); structural + build-side evidence is clean,
audio round-trip stays Tom-pending because Claude's sandbox can't
drive the iOS sim tap chain.

## 1 — Receipts spot-check

`stat -f "%m %z %N"` on a sampling of receipts — every one matches
the Implementer's report (mtime + size identical):

```
1780233897 7080 packages/ui/src/platform/types.ts
1780235033 5169 packages/ui/src/platform/audioCapture.native.ts
1780235680 2659 scripts/check-pin-bounds.sh
1780235659 4303 docs/phase-6/m21-manual.md
1780235568 2682 packages/ui/src/index.ts
1780234563 1728 clients/app/ios/voix/Info.plist
1780234550 1462 clients/app/macos/voix-macOS/Info.plist
```

`git log --oneline -10` confirms commit hashes match
(`076fdb3..48fa361` per the report).

Receipts integrity: **PASS**.

## 2 — Acceptance criteria run-through

| # | Criterion | Status |
|---|---|---|
| 1 | `bun install` succeeds, no unmet peer warnings | ✓ (working tree shows no install drift; pin-bounds asserter green) |
| 2 | `cd voix-backend/ui && bun run build` produces `dist/index.html` | ✓ — `334 modules transformed`, `dist/index.html  0.70 kB`, built in 579 ms |
| 3 | `bun src/index.ts` reaches `listening on :8765` | ✓ — `14:03:15.035 INFO  voix-backend: listening on :8765 (log_level=info)` |
| 4 | `bun run check` passes (3 asserters) | ✓ — `check-native-siblings: OK`, `check-protocol-sync: OK`, `check-pin-bounds: OK (react-native-worklets pinned at 0.8.3)` |
| 5 | iOS + macOS `bundle exec pod install` succeeded | ✓ — `clients/app/ios/Pods/Target Support Files/{RNAudioAPI,RNWorklets,RNDeviceInfo,AsyncStorage}` all present; macOS has `{RNWorklets,AsyncStorage}` (no RNAudioAPI/RNDeviceInfo as expected per Decision 2 / step 3 note). Did NOT re-run pod install — caveat says not to. |
| 6 | `bunx tsc -p clients/app/tsconfig.json --noEmit` passes | ✓ — exit 0 from both root and from `clients/app/` leaf. Also `bunx tsc -p packages/ui/tsconfig.json --noEmit` exit 0. |
| 7 | 7 .ts + 7 .native + types + index in `packages/ui/src/platform/` | ✓ — `find` returns 16 files (6 web .ts + 1 web .tsx (`inlineAudio.tsx`) + 7 .native + `types.ts` + `index.ts`). The brief said "7 .ts" but `inlineAudio` is a .tsx pair on both targets, so the precise count is 6 .ts + 1 .tsx + 7 native + 2 leaf = 16. Spirit honoured. |
| 8 | Every `.native.ts` has a non-`.native` sibling | ✓ — `check-native-siblings: OK` |
| 9 | `packages/ui/src/lib/apiBase.{ts,native.ts}` DELETED | ✓ — `ls` returns `No such file or directory` for both. No consumer imports survive (`grep -rn "from.*lib/apiBase"` returns 0 hits in src trees). |
| 10 | `packages/ui/src/audio_io/client.native.ts` DELETED | ✓ — `ls` confirms gone. `grep -rn "from.*audio_io/client\.native"` returns 0 hits. |
| 11 | Web PTT works end-to-end | TESTED ONLY (build green + module count consistent). Not opened in a browser — same gap the Implementer flagged. |
| 12 | iOS PTT works end-to-end | UNVERIFIED — Tom-pending. See section 5 below. |
| 13 | macOS Voices/Surfaces render + TalkButton friendly error | TESTED ONLY (code path inspected: `audioCapture.native.ts` + `audioPlayback.native.ts` + `inlineAudio.native.tsx` all branch on `Platform.OS === "macos"` and throw with a message naming M22). Not run in macOS shell. |
| 14 | STATE.md M21 closed + m21-manual.md exists | ✓ — `docs/phase-6/m21-manual.md` present (4303 B); STATE.md modification at receipt time 1780235764. |

Pass count: **11/14 verified, 3 tested-only (web PTT smoke, iOS PTT
round-trip, macOS friendly-error visual) — all 3 expected per the
Implementer's PARTIAL flag**.

## 3 — Platform shim integrity

### File shape
- 16 files in `packages/ui/src/platform/` as expected.
- `check-native-siblings: OK`.
- All consumers route through the barrel: `grep` of `from "../platform"` finds 5 consumer imports (`audio_io/client.ts`, `index.ts`, `conversations/ConversationDetail.tsx`, `conversations/TalkButton.tsx`, `lib/api.ts`).

### `check-pin-bounds.sh` injection test
Backed up `clients/app/package.json`, changed `react-native-worklets`
from `"0.8.3"` to `"0.9.0"`, re-ran the asserter:

```
$ bash scripts/check-pin-bounds.sh
check-pin-bounds: /Users/tom/Projects/voix/clients/app/package.json
  pins react-native-worklets at 0.9.0; expected 0.8.x
  M21 Decision 13 risk 6: 0.9.x requires RN 0.83+, we're on RN 0.81.6.
exit=1
```

Reverted and re-ran: `check-pin-bounds: OK (react-native-worklets
pinned at 0.8.3)`. Working tree clean (git status shows no
package.json changes). Asserter functions correctly on both the
"drifted past 0.8.x" case and the recovered state.

## 4 — DELETED files confirmed gone

All five enumerated paths return "No such file or directory":
- `packages/ui/src/lib/apiBase.ts` ✓
- `packages/ui/src/lib/apiBase.native.ts` ✓
- `packages/ui/src/audio_io/client.native.ts` ✓
- `packages/ui/src/conversations/InlineAudioPlayer.tsx` ✓
- `packages/ui/src/conversations/InlineAudioPlayer.native.tsx` ✓

`grep -rn "InlineAudioPlayer\.tsx\|InlineAudioPlayer\.native\|lib/apiBase\|audio_io/client\.native" packages/ clients/ voix-backend/`
returns only **two doc-comment references** in the moved files
(`platform/inlineAudio.tsx` line 11 + `platform/appInfo.ts` line 6),
both purely historical. Zero live imports.

## 5 — iOS PTT smoke

Tom-pending, per Implementer's PARTIAL status. What I can verify
without driving the sim:

- Info.plist (iOS) has both `NSMicrophoneUsageDescription` ("voix
  listens when you talk to it.") AND `UIBackgroundModes` containing
  `<string>audio</string>`. Decision 4 satisfied.
- Info.plist (macOS) has `NSMicrophoneUsageDescription` (same string).
- `audioCapture.native.ts` declares 16 kHz/24 kHz/48 kHz appropriately:
  - Sample rate is passed through from `opts.sampleRateHz` (the
    orchestrator calls with `48000`) and `this.negotiatedSampleRate
    = this.audioContext.sampleRate` reads the actually-honoured rate
    back for hello declaration.
  - Audio session: `iosCategory: "playAndRecord"`, `iosMode:
    "voiceChat"`, `iosOptions: ["defaultToSpeaker",
    "allowBluetoothHFP"]`. Slight departure from Decision 4's
    `iosMode: "default"` + `allowBluetooth` — `voiceChat` + HFP is
    actually a better fit for PTT (lower latency, AEC engaged), but
    note it as a deliberate-deviation finding for the adversary
    review.
- `floatToPcm16` exists at `audioCapture.native.ts:50-57` and is
  **byte-identical** to the web impl at `audioCapture.ts:30-37` —
  same clamp, same `< 0 ? s * 0x8000 : s * 0x7fff` scaling.
- `pcm16ToFloat` at `audioPlayback.native.ts:23-29` does the inverse
  (`/ 0x8000`) — correct linear PCM round-trip.
- Speaker is locked at 24 kHz in `client.ts:71` and `audioPlayback`
  honours `opts.sampleRateHz` (passed as 24000 from the orchestrator).
- Hello packet (`client.ts:177-209`):
  - `client_info.kind = appInfo.clientKind` where
    `appInfo.native.ts:70` declares `clientKind: "phone-sat"`. This
    member exists in the protocol's `ClientKind` union at
    `packages/protocol/src/audio-io.ts:46` (`"puck" | "phone-sat" |
    "laptop-mic" | "browser-tab" | "external"`). Delta B in the
    Implementer's report (correcting the coordinator's brief) is
    factually right — there is no "phone" variant.
  - `mic.sample_rate_hz` reads from `this.capture.sampleRate ?? 48000`
    — so the daemon sees the actual negotiated iOS rate, not a hardcoded value.
  - `speaker.sample_rate_hz` = 24000.
- iOS sim screenshot at `/tmp/voix-smoke-screenshots/m21-step5.png`
  exists (263 KB, last-modified after step 5). The Implementer's
  description (M20-baseline Voices list rendered, no red-box) is
  consistent with apiBase + DeviceInfo + AsyncStorage + audio-api JS
  surface all loading cleanly.

**iOS PTT round-trip: UNVERIFIED (Tom-pending, audio-bench-only — no
tap-automation in sandbox)**. Mechanical correctness verified end to
end; only the actual hold-button gesture remains.

## 6 — Web build sanity

- `cd voix-backend/ui && bun run build`: vite produced `dist/index.html`
  (0.70 kB) + `dist/assets/index-DsZKN109.js` (337.42 kB, 104.62 kB
  gzip) in 579 ms across 334 modules. **Web build: PASS**.
- Did not open in browser to run web PTT manually (same gap
  Implementer flagged); flagged as TESTED-only above.

## 7 — macOS sanity

Did not launch macOS shell. Code review:
- `audioCapture.native.ts:131-143` (`MacosAudioCaptureStub.start`)
  throws `"audio capture: macOS audio lands in M22 (alongside global
  hotkey + paste)"` — user-readable, not a crash.
- `audioPlayback.native.ts:70-84` similar friendly throw.
- `inlineAudio.native.tsx` includes a macOS placeholder per the
  Implementer report (file present at 3662 B).
- Pod set on macOS does NOT include RNAudioAPI or RNDeviceInfo — the
  `appInfo.native.ts` `getFriendlyName()` swallow-and-fallback to
  `Platform.OS` is the documented path; the audio shims branch
  before touching RNAudioAPI types.

**macOS sanity: PASS (mechanical review only — Tom-launches still
needed for the visual)**.

## 8 — Tested vs verified table

| Area | Tested (build/typecheck) | Verified (real dep) |
|---|---|---|
| Platform shim types | ✓ both `tsc -p packages/ui` + `tsc -p clients/app` exit 0 | ✓ — `check-native-siblings`, `check-protocol-sync`, `check-pin-bounds` all green |
| iOS pod install | ✓ — RNAudioAPI, RNWorklets, RNDeviceInfo, AsyncStorage support files present | (not re-run per caveat) |
| macOS pod install | ✓ — RNWorklets + AsyncStorage support files present; RNAudioAPI/RNDeviceInfo absent as expected | (not re-run per caveat) |
| iOS audio capture frames | ✓ — `floatToPcm16` matches web byte-for-byte; sample rate negotiation reads `audioContext.sampleRate` truthfully | ✗ Tom-pending |
| iOS audio playback frames | ✓ — `pcm16ToFloat` + `createBuffer(1, len, 24000)` mirrors web; gapless `playbackTime` watermark preserved | ✗ Tom-pending |
| AsyncStorage persistence | ✓ — `storage.native.ts` exists; `appInfo.native.ts` reads `voix.api_base` via storage with sane cache | ✗ Tom-pending (would surface as apiBase persisting across launches) |
| Web build (HA add-on) | ✓ — 334 modules, built in 579 ms, dist/index.html valid | ✗ — did not open in browser to PTT (same gap Implementer flagged) |

"Verified" requires real-device daemon-log evidence; the four ✗ rows
are all on the iOS PTT round-trip that needs Tom's hands.

## Findings

1. **Tom-pending — iOS PTT round-trip** (not blocking the milestone close;
   Implementer flagged this as PARTIAL up front, matches the M19/M20
   pattern of leaving the human-gesture step for Tom).
2. **Tom-pending — web PTT manual spot-check** (Acceptance 11; same
   pattern; web build mechanically green).
3. **Tom-pending — macOS shell launch + visual confirmation of the
   "M22" friendly-error string** (Acceptance 13; code path verified
   to throw, not crash).
4. **Note (not a finding) — `iosMode: "voiceChat"` + `allowBluetoothHFP`
   in `audioCapture.native.ts`** deviates from Decision 4's exact
   text (`iosMode: "default"` + `allowBluetooth`). The chosen values
   are a strict improvement for PTT latency + AEC behaviour. Worth
   the adversary's eye but I'd ship as-is.
5. **Note (not a finding) — Delta C in the Implementer's report (pin
   `react-native-worklets` at `0.8.3` instead of `0.9.0`) is
   correct**: I verified the pod-spec rejection by inspecting the
   asserter's logic AND the compatibility matrix path in node_modules.
   The Implementer's discovery there was good work.

No blocking issues.

## VERDICT
- Receipts integrity: PASS
- Acceptance criteria pass count: 11/14 verified + 3 tested-only (web PTT, iOS PTT round-trip, macOS visual) — all 3 expected Tom-pending per Implementer's PARTIAL
- iOS PTT round-trip: UNVERIFIED (Tom-pending; sandbox can't drive sim taps; mechanical-correctness verified end-to-end — sample-rate negotiation, floatToPcm16 parity, hello packet kind="phone-sat", AVAudioSession config order, plist entries)
- macOS sanity: PASS (code review confirms friendly-throw branches; Tom-launch still needed for the visual)
- Web sanity: PASS (build green, 334 modules in 579 ms; manual PTT spot-check Tom-pending)
- Blocking issues: 0
- Recommendation: ship-as-is (Tom runs `docs/phase-6/m21-manual.md` steps 4 + 5 + 6 to close)
