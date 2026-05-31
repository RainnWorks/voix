# A1 — iOS behavioural nativeness — implementation report

**Backlog item:** A1 (`/tmp/voix-overnight-backlog.md`) — per Wren v4's
Tom-pending list. Code ships now; Tom verifies on-device tomorrow.

**Status:** 3 of 5 sub-items shipped as code. 2 sub-items (native sheet
presentation, native back gesture) are **architecturally N/A** in the current
app — see "Tasks 4 & 5" below for the finding and recommendation.

**Branch:** `main` (standing signing bypass; one commit per feature, pushed).

## Commit SHAs

| # | Feature | SHA | Pushed |
|---|---------|-----|--------|
| 1 | Haptics on TalkButton | `cd50349` | ✅ `origin/main` |
| 2 | Pull-to-refresh (Conversations + Voices) | `ddf5bc0` | ✅ `origin/main` |
| 3 | Swipe-to-delete on Conversation rows | `0959a23` | ✅ `origin/main` |

(Full hashes: `cd503495ebe38b7400e9fe9ec291b3e4d97a45e3`,
`ddf5bc0…`, `0959a23…`.)

## What shipped

### 1 — Haptics (`cd50349`)

`react-native-haptic-feedback@3.0.0` added to `clients/app` (pod installed,
`RNReactNativeHapticFeedback` linked). Wired into `TalkButton.tsx`:

- **press-in → `impactMedium`** — fired the instant the button depresses,
  *before* the async auth/mic/WS work, so the tap feels acknowledged while the
  session is still opening.
- **session-open → `notificationSuccess`** — fired once the mic actually
  reaches the floor (`ready`/`listening`), guarded on the false→true
  transition so a `ready`→`listening` status change doesn't double-buzz.
- **press-out → clean** — no haptic on release, per spec.

Delivered via a platform shim so the native dep never touches web/macOS:
- `packages/ui/src/platform/haptics.ts` — web/macOS **no-op**.
- `packages/ui/src/platform/haptics.native.ts` — drives the Taptic bridge,
  **hard-gated on `Platform.OS === "ios"`** so macOS (which resolves the
  `.native` sibling, no `.macos` variant exists) never reaches into the
  unlinked module.
- Exported as `haptics` from the `platform` barrel.

The pod is iOS-only (`s.platform = :ios`), so macOS autolinking skips it and
the web bundle never sees it (Vite resolves `./haptics` → the no-op sibling).

### 2 — Pull-to-refresh (`ddf5bc0`)

`RefreshControl` wired into both lists; an iOS pull-down re-runs the underlying
fetch behind the native `UIRefreshControl` spinner (tinted system-accent —
it's chrome, not a voix moment).

- **`ConversationList.tsx`** — `refresh` now returns its promise; `onRefresh`
  parks the spinner until it settles. Re-calls `historyApi.list` +
  `voicesApi.list` + `devicesApi.list`. **Both** the empty-state and populated
  branches are now `ScrollView`s, so the gesture works even before the first
  conversation lands (exactly when a user reaches to refresh).
- **`VoiceList.tsx`** — load path hoisted into a reusable `load` callback
  (also clears a stale error on success); body wrapped in a `ScrollView`.
  Re-calls `voicesApi.list` + `devicesApi.list`.

### 3 — Swipe-to-delete on Conversation rows (`0959a23`)

Left-swipe a conversation row → red iOS-destructive **"Delete"** action
(systemRed `#FF3B30`, 80pt action column), mirroring UITableView
swipe-to-delete. Delete is immediate on tap (the swipe is the deliberate
gesture; no secondary confirm, matching iOS).

- **`SwipeableRow.native.tsx`** — wraps the row in
  `react-native-swipe-list-view`'s standalone `SwipeRow` (pure-JS lib:
  Animated + PanResponder, **no pod**). Right-swipe disabled; opaque front
  matched to `colors.bg` so the destructive layer is invisible at rest.
- **`SwipeableRow.tsx`** — web/macOS **passthrough** (swipe-to-delete is a
  touch idiom; no natural gesture on mouse/keyboard), so the swipe dep never
  enters the web bundle.
- **`ConversationList.tsx`** — wraps each `Row`; `onDeleteEntry` deletes
  **optimistically** (drops the row immediately so the list closes the gap),
  re-fetches to restore truth on failure.
- **Daemon delete (the API did NOT exist — added):**
  - `voix-backend/src/history/store.ts` → `deleteHistoryEntry(id)`. The store
    was append-only; this splices the in-memory mirror synchronously (so the
    next `listHistory` reflects it) and rewrites the JSONL through the **same
    serialised `writeQueue`** the appends use — no partial-line interleave with
    a concurrent session-end append.
  - `voix-backend/src/api/history.ts` → `DELETE /api/history/:id`
    (200 `{deleted}` on success, 404 if unknown).
  - `packages/ui/src/lib/api.ts` → `historyApi.delete(id)`.

## Tasks 4 & 5 — architectural finding (NOT implemented; recommend a separate task)

The backlog described 4 & 5 in terms of **react-navigation** primitives
(`createNativeStackNavigator`, `presentation: 'modal'`/`'formSheet'`,
native-stack swipe-back). **There is no react-navigation in this codebase.**

Verified — zero matches across `packages/ui/src`, `clients/app`, and both
`package.json`s for: `react-navigation`, `createNativeStackNavigator`,
`react-native-screens`, `NavigationContainer`.

**How navigation actually works:** `packages/ui/src/App.tsx` is a custom
state-machine shell — `useState<Section>` for the tab, plus `editingVoiceId` /
`openEntryId` nullable state to swap the detail view in-place inside
`AppShell`. `VoiceEditor` and `ConversationDetail` are rendered as plain
content (`onClose` flips the state back), **not** pushed onto a nav stack.
This shared shell is consumed by web (react-native-web), iOS, and macOS alike.

**Why not implemented now:** introducing react-navigation +
react-native-screens to get native sheet presentation / native back-swipe is a
**ground-up navigation rewrite** that would touch the shared shell on all three
platforms (web + iOS + macOS), add native pods (`react-native-screens`), and
re-home every screen transition. That is a multi-day refactor with real
regression surface — not a "code ships tonight, verify tomorrow" change, and it
exceeds the A1 budget. Forcing it in would have been reckless.

**Recommendation:** file a dedicated backlog item — *"Adopt
`@react-navigation/native-stack` for the iOS/macOS shell"* — that can (a) push
`VoiceEditor` + `ConversationDetail` as modal/formSheet sheets and (b) get
native edge-swipe-back for free (it's the native-stack default). It should be
scoped as a navigation-architecture task, kept behind the `platform` split so
web keeps its current in-place shell, and reviewed on its own.

## Smoke results

Run after the final tree (HEAD = `0959a23`):

| Smoke | Result |
|-------|--------|
| `bun run check` | ✅ check-native-siblings OK · protocol-sync OK · pin-bounds OK |
| `cd voix-backend/ui && bun run build` (tsc + vite) | ✅ exit 0 (372 kB bundle) |
| `bunx tsc -p clients/app/tsconfig.json --noEmit` | ✅ exit 0 |
| `bunx biome check` (daemon + new UI files) | ✅ exit 0 |
| `bun test tests/pipeline/realtime.test.ts` (touches history store) | ✅ 6 pass / 0 fail |
| `xcodebuild -scheme voix -configuration Debug` (iOS sim) | ✅ **BUILD SUCCEEDED** (haptics pod compiled; re-confirmed on final tree `0959a23`) |

Notes:
- The `check-native-siblings` guard passed — both new shims
  (`haptics`, `SwipeableRow`) have web + native siblings.
- xcodebuild was run on the haptics tree (the only sub-item with native
  impact — swipe-list-view is pure-JS, no pod). The final run on `0959a23`
  re-confirms the full tree.
- Daemon `tsc --noEmit` is blocked by a **pre-existing** env issue
  (`Cannot find type definition file for 'bun-types'`), unrelated to these
  changes — validated daemon code via biome + the bun test suite instead.

## Tom's on-device verification checklist (tomorrow)

These are the behaviours Wren flagged as Tom-pending — confirm on a physical
iPhone (haptics don't fire in the simulator):

1. **Haptics** — hold the TalkButton: feel a medium thunk on press; a success
   double-tap when "I'm listening" appears; nothing jarring on release.
2. **Pull-to-refresh** — on Conversations and on Voices, tug the list down →
   native grey spinner, list re-loads. Works on an empty Conversations list too.
3. **Swipe-to-delete** — left-swipe a conversation row → red "Delete" reveals;
   tap it → row removes immediately; the entry is gone after a manual refresh
   (confirms the daemon DELETE landed).
