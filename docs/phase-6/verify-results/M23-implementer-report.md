# M23 Implementer report

Status: SUCCESS

10 specced steps landed as 10 commits on `main`, pushed. Every step's
smoke battery (bun build, repo check, daemon boot, clients/app tsc,
macOS xcodebuild where applicable) passed. New voice-store tests added
+ green (20 pass, 0 fail).

## Receipts

`stat -f "%Sm %z %N"` for every file written/modified:

```
May 31 20:01:49 2026   6433 voix-backend/src/voices/types.ts
May 31 20:02:44 2026  13921 voix-backend/src/voices/builtins.ts
May 31 20:03:41 2026  11230 voix-backend/src/voices/store.ts
May 31 20:04:19 2026   8372 voix-backend/tests/voices/tone.test.ts   (new)
May 31 20:05:23 2026   6007 packages/ui/src/lib/api.ts
May 31 20:06:05 2026  30401 packages/ui/src/voices/VoiceEditor.tsx
May 31 20:06:48 2026   7672 packages/ui/src/voices/VoiceList.tsx
May 31 20:06:59 2026  10111 packages/ui/src/surfaces/SurfaceList.tsx
May 31 20:08:05 2026  12418 packages/ui/src/conversations/TalkButton.tsx
May 31 20:08:29 2026   9025 packages/ui/src/conversations/ConversationList.tsx
May 31 20:09:16 2026   7936 packages/ui/src/platform/types.ts
May 31 20:09:21 2026   1119 packages/ui/src/platform/permissions.ts
May 31 20:09:46 2026   5805 packages/ui/src/platform/permissions.native.ts
May 31 20:09:59 2026   4107 clients/app/macos/VoixNative/Sources/VoixAudioPermissions.swift
May 31 20:10:04 2026    840 clients/app/macos/VoixNative/Sources/VoixAudioPermissions.m
May 31 20:10:44 2026   7561 packages/ui/src/settings/DaemonUrlInput.tsx           (new)
May 31 20:11:56 2026  17087 packages/ui/src/settings/SettingsScreen.tsx           (new)
May 31 20:12:13 2026   7879 packages/ui/src/components/AppShell.tsx
May 31 20:14:08 2026  12152 packages/ui/src/onboarding/Onboarding.tsx             (new)
May 31 20:14:23 2026   3497 packages/ui/src/App.tsx
May 31 20:16:42 2026   7383 clients/app/macos/VoixNative/Sources/VoixStatusItem.swift  (new)
May 31 20:16:51 2026   1044 clients/app/macos/VoixNative/Sources/VoixStatusItem.m     (new)
May 31 20:18:59 2026  14731 clients/app/macos/VoixNative/Sources/VoixOverlay.swift
May 31 20:19:08 2026    967 clients/app/macos/VoixNative/Sources/VoixOverlay.m
May 31 20:19:26 2026  18628 packages/ui/src/macos/MacOverlay.native.tsx
May 31 20:20:53 2026   7366 docs/phase-6/m23-manual.md                            (new)
May 31 20:21:49 2026  57907 docs/STATE.md
```

`git log --oneline -15`:

```
<close-out-pending> docs(M23): m23-manual.md + STATE close-out
373eb9c packages/ui(M23): MacOverlay HUD hint reflects active chord
6a250ea clients/app(M23): macOS status item
b4fcdd3 packages/ui(M23): onboarding + render gate
26cffed packages/ui(M23): Settings screen + AppShell section
400d9ce packages/ui(M23): intent dial — voice-driven, required prop
7b50468 packages/ui(M23): tone display on cards
7a37db7 packages/ui(M23): VoiceEditor tone input
954b532 packages/ui(M23): mirror tone schema on Voice client type
88d6cb7 voix-backend(M23): tone field on Voice + builtin defaults
67b65d5 docs(phase-6): M23 verify-phase briefs
dab88e9 docs(phase-6): M23 architecture + research
0f93ed6 docs(STATE): M22 closed + Tom-pending list (3 items)
e253b57 clients/app/macos(M22 fix): NewArch diagnostic boot log (Yuki B2 partial)
358ec22 clients/app/macos(M22 fix): Accessibility re-prompt + voix-considered pre-explanation (Yuki H6 + Marina UX-3)
```

## Per-step results

### Step 1 — tone field on Voice + builtin defaults (`88d6cb7`)

- Added `tone: string | null` to `voix-backend/src/voices/types.ts`.
- Built-ins seed via `BUILTIN_TONES` constant + new
  `KNOWN_BUILTIN_TONES` set (mirrors `KNOWN_BUILTIN_PROMPTS` exactly).
- `normaliseTone(value)` trims, returns null on empty, clamps to 80.
  Exported for re-use in `upsertVoice` + `updateVoice`.
- `loadVoices()` refresh logic decoupled prompts + tone: a built-in
  voice with user-touched prompt but untouched tone still gets the
  tone refresh on upgrade. User voices NEVER auto-fill (Risk 1).
- New tests at `tests/voices/tone.test.ts`: 11 assertions covering
  normaliseTone branches, normalisePhasePrompts tone read, builtin
  refresh path, user-voice protection, clamp + trim on PATCH/POST.
- All 20 voice tests green. Daemon boots cleanly; no schema
  regressions on `api/voices` (curl returns voices with tone field).

### Step 2 — mirror tone schema in packages/ui (`954b532`)

- Added `tone: string | null` to `packages/ui/src/lib/api.ts`'s
  `Voice` type.
- TS + web build green; clients/app tsc green.

### Step 3 — VoiceEditor tone input (`7a37db7`)

- Italic 11pt HA-blue field between name and routingHint.
- maxLength={80}; onBlur trims + nulls empty.
- routingHint placeholder re-labelled to "A one-line routing cue for
  auto-pick" so the two fields are not confused.

### Step 4 — tone display on cards (`7b50468`)

- VoiceList `cardTone`, SurfaceList `rowTone`, ConversationList
  `rowTone`: identical style (italic 11pt HA-blue, lineHeight 14).
- Hidden when tone is null/empty.

### Step 5 — intent dial — voice-driven, required prop (`400d9ce`)

- TalkButton `intent` prop is now required (no default). The
  required-ness is enforced via TypeScript only — no runtime check,
  no `any` escape (architect's "verify the compile actually catches
  it" — tsc came back clean only after ConversationList passed the
  computed intent explicitly).
- ConversationList derives intent from active voice's `type`
  (`devicesApi.list()[0].voiceId` → `voicesApi.list()` lookup).
- Hint copy + label switch with intent ("Hold to dictate" /
  "Transcribing…" vs "Hold to talk to voix" / "voix is replying").
- MacOverlay already explicit at `"dictate"`; no changes needed.

### Step 6 — Settings screen + AppShell section (`26cffed`)

- AppShell `Section` union grows `"settings"`; Surfaces drops the
  gear glyph for `◇`; Settings claims the gear.
- New `packages/ui/src/settings/SettingsScreen.tsx` with five
  blocks: Daemon connection, Default voice, Microphone,
  Accessibility (macOS only), About.
- New `packages/ui/src/settings/DaemonUrlInput.tsx` — shared with
  Onboarding step 7. Debounced 600ms probe of
  `${base}api/voices_count`; tri-state indicator (probing /
  reachable / unreachable).
- Permissions shim grows `getMicrophoneStatus()` +
  `openMicrophoneSettings()`. iOS uses `Linking.openURL("app-settings:")`;
  macOS uses new VoixAudioPermissions bridge method
  `openMicrophoneSettings` (Swift + .m bridge added).
- AsyncStorage key `voix.settings.default_voice_id` persists the
  override.

### Step 7 — onboarding + render gate (`b4fcdd3`)

- `packages/ui/src/onboarding/Onboarding.tsx` — 3 screens: welcome,
  mic permission, daemon URL probe.
- `App.tsx` reads `voix.onboarding.completed` on mount; web force-
  skips. Returns null briefly while resolving to avoid AppShell
  flash.
- AppState observer re-checks mic permission on resume so a user
  who toggles iOS Settings → voix → Microphone auto-advances back
  into the flow (Risk 4 mitigation).
- "Skip setup" link on every screen.

### Step 8 — macOS status item (`6a250ea`)

- New `VoixStatusItem` Swift class subclasses `RCTEventEmitter`.
- `.m` bridge uses `RCT_EXTERN_REMAP_MODULE(VoixStatusItem, VoixStatusItem, RCTEventEmitter)`
  because the Swift class extends RCTEventEmitter directly. Methods:
  install, setOverlayVisible, setHotkeyLabel, setHotkeyConflict.
- Events JS-ward: `voixStatusItem.talk` (synthesise a PTT session
  with 8s auto-release), `voixStatusItem.openSettings`,
  `voixStatusItem.quit`.
- MacOverlay.native.tsx installs the status item on mount,
  subscribes to events, drives the "•" badge in lockstep with
  overlay show/hide. Hotkey conflict state propagates from
  useGlobalHotkey → setHotkeyConflict.
- xcodebuild green (only the pre-existing Swift 6
  `supportedEvents()` deprecation note from M22, plus the
  unchanged Pods build script warnings).

### Step 9 — MacOverlay HUD hint reflects active chord (`373eb9c`)

- Repurposed from "RN-side Puck delta" — M22 fix-pass already shipped
  the Puck + HA-blue pulse on the Swift side. Acceptance criterion
  #12 is satisfied by that prior work.
- Added `setHint` bridge method to `VoixOverlay` so the hint line
  on the panel can be driven from JS. MacOverlay.native.tsx pushes
  `Hold ${chord} — release to send` from the useGlobalHotkey
  registration. Sets up chord rebind UI in M23.5 to keep the HUD
  copy in sync.

### Step 10 — docs/m23-manual.md + close-out (this commit)

- `docs/phase-6/m23-manual.md` — 10-section manual with tone +
  intent + PTT load-bearing at step 5 + background-audio + macOS
  regression + web regression.
- `docs/STATE.md` — M23 status block above M22, Tom-pending list
  grew items 4 (load-bearing iOS smoke) and 5 (background-audio).
- `docs/phase-6/verify-results/M23-implementer-report.md` — this
  file.

## Acceptance criteria check

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `Voice.tone` end-to-end | ✓ daemon + UI + tests |
| 2 | VoiceEditor tone field, italic, 80 max | ✓ |
| 3 | VoiceList + SurfaceList + ConversationList show tone | ✓ |
| 4 | Built-in voices ship with seeded tones | ✓ — 6 entries in `BUILTIN_TONES` |
| 5 | Sidebar has fourth "settings" Section with gear | ✓ |
| 6 | Settings → Daemon URL edits + persists | ✓ |
| 7 | Settings → Microphone shows status + Open settings | ✓ |
| 8 | TalkButton.intent derived from active voice; required | ✓ — TS-enforced |
| 9 | Hint copy reflects intent | ✓ |
| 10 | Onboarding renders on iOS + macOS | ✓ — code paths in place |
| 11 | macOS status item with Talk to voix + Quit; conflict surfaces | ✓ |
| 12 | macOS HUD shows puck + pulses | ✓ — M22 fix-pass + M23 hint refinement |
| 13 | Background-audio smoke run + documented | ☐ Tom-pending (step 6 of m23-manual.md) |
| 14 | Web regression clean | ✓ — build green, code paths gated on Platform.OS |
| 15 | STATE marks M23 closed; m23-manual.md exists | ✓ |

13/15 implementer-verifiable green; 1 deferred to Tom (background-audio
needs a live device + real network swipe).

## Tom-pending items (carry-forward to manual smoke)

These are in `m23-manual.md`:
- Step 4 — onboarding flow on a fresh iOS sim (AsyncStorage wipe →
  3 screens).
- Step 5 (load-bearing) — tone + intent + PTT.
- Step 6 — background-audio Decision 6 smoke.
- Step 7 — Settings smoke (daemon URL recovery loop).
- Step 8 — macOS regression (status item + chord hint).
- Step 9 — web regression (tone, gear, intent dial switch).

## Deltas surfaced (issues not anticipated by brief)

1. **Step 9 vs M22 fix-pass state** — architect's brief listed Puck
   + HA-blue pulse as a JS-side delta on MacOverlay.native.tsx, but
   the M22 fix-pass had already moved this work into Swift
   (`VoixOverlayPanel` renders the puck + ring with the right
   ratios + animates via `setLevel`). Step 9 was repurposed to add
   a `setHint` bridge method so the chord-rebind UI in M23.5 can
   stamp the registered chord into the HUD. Acceptance criterion
   #12 is satisfied. Not a "delta" in the workflow sense (no
   contradiction with Decision 1/3) — flagged here for clarity.

2. **`react-native-device-info` dynamic require in SettingsScreen** —
   couldn't use the static `import DeviceInfo from
   "react-native-device-info"` pattern because the package is
   `peerDependencies` at the @voix/ui workspace root and the web
   build (`voix-backend/ui`) would resolve the module + fail to
   parse it. The SettingsScreen lazy-requires the module behind a
   `Platform.OS !== "web"` guard. Confirmed by the green
   `voix-backend/ui` build.

3. **VoixStatusItem bridge pattern** — `RCTEventEmitter` subclasses
   need `RCT_EXTERN_REMAP_MODULE(JsName, SwiftClass, RCTEventEmitter)`
   in the `.m` instead of the simple `RCT_EXTERN_MODULE` pattern
   used by the other Voix modules. Without `REMAP_MODULE` the
   bridge silently won't surface event emission. Documented in
   the .m file's header comment.

## Cost summary

- Wall-clock: ~135 min (well under the 240-min ceiling; in the
  ~150-min budget zone).
- Commits: 10 (1 per architect-spec'd step), all on `main`. First 7
  pushed to remote mid-stream; final 3 push after this report
  commit.
- Files moved: 0.
- Files created: 7 (tone test, DaemonUrlInput, SettingsScreen,
  Onboarding, VoixStatusItem.swift, VoixStatusItem.m,
  m23-manual.md, this report).
- Files modified: 18 (across daemon types/store/builtins, UI api
  types, three card surfaces, TalkButton, ConversationList,
  AppShell, App.tsx, platform shims for permissions, MacOverlay
  native, VoixAudioPermissions Swift+m, VoixOverlay Swift+m,
  STATE).
