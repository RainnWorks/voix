# B3 — Behavioural-nativeness regression tests — report

**Backlog item:** B3 (`/tmp/voix-overnight-backlog.md`) — write regression tests
so A1's iOS-native behaviours (haptics, pull-to-refresh, swipe-to-delete) can't
silently break. These are touch/Taptic affordances that **never fire in the
simulator** and don't break the build when regressed — exactly the class of
change that only surfaces on-device, days later.

**Status:** ✅ shipped. **16 tests, 16 pass / 0 fail** (28 assertions).

**Branch:** `main` (standing signing bypass; one commit, pushed).

## What was written

`packages/ui/src/__tests__/nativeness.test.ts` — a `bun:test` suite (the repo's
runner; there is no vitest here — the root `test` script is
`bun run --filter '*' test` and every existing suite under `voix-backend/tests`
imports from `bun:test`).

### Approach: static source-grep, not react-test-renderer

The native modules A1 leans on (`react-native-haptic-feedback`,
`react-native-swipe-list-view`) are dependencies of **`clients/app`**, not of
`@voix/ui`, so they aren't in this package's `node_modules` — rendering the
components would mean mocking the entire native bridge. The wiring we actually
care about (which handler fires which haptic, which prop carries the
`RefreshControl`, whether the daemon endpoint exists) is statically present in
source. Reading the files is both cleaner and more robust than a render harness
that has to fake the Taptic Engine. Each assertion is pinned to a concrete file
from the A1 report; if a feature moves, the failing assertion points at the
real regression.

## Test list (5 behaviours → 16 tests)

| # | Behaviour | File(s) asserted | Tests |
|---|-----------|------------------|-------|
| 1 | **TalkButton fires Haptics on press** | `conversations/TalkButton.tsx`, `platform/haptics.native.ts`, `clients/app/package.json` | 5 |
| 2 | **Conversation list wires `refreshControl`** (pull-to-refresh) | `conversations/ConversationList.tsx` | 2 |
| 3 | **Voice list wires `refreshControl`** (pull-to-refresh) | `voices/VoiceList.tsx` | 2 |
| 4 | **Conversation rows support swipe-to-delete** | `components/SwipeableRow.native.tsx`, `conversations/ConversationList.tsx`, `clients/app/package.json` | 4 |
| 5 | **`historyApi.delete` exists (UI + daemon)** | `lib/api.ts`, `voix-backend/src/api/history.ts` | 3 |

### What each group locks down

1. **Haptics** — `react-native-haptic-feedback` is an app-shell dependency;
   `TalkButton` imports the `haptics` shim from the `platform` barrel; the
   `onPressIn={handlePressIn}` handler fires `haptics.talkPressIn()`; the
   session-open path fires `haptics.talkSessionOpen()`; and the `.native` shim
   actually drives `react-native-haptic-feedback`'s `trigger("impactMedium")` /
   `trigger("notificationSuccess")`. (A1 routes haptics through a platform shim
   rather than importing the native module straight into `TalkButton`, so the
   test asserts **both** ends of the shim — that's where a regression would
   actually hide.)
2. **Conversation pull-to-refresh** — `RefreshControl` imported **and** a
   `refreshControl={…}` prop wired to a scroll surface (asserting the prop, not
   just the import, so dropping the prop fails even if the import lingers).
3. **Voice pull-to-refresh** — same shape on `VoiceList`.
4. **Swipe-to-delete** — `react-native-swipe-list-view` is an app-shell
   dependency; `SwipeableRow.native` imports `SwipeRow` from it and renders a
   destructive Delete wired to `onDelete`; `ConversationList` wraps each row in
   `SwipeableRow` with `onDelete={… onDeleteEntry …}`.
5. **Delete API** — `historyApi` is exported and exposes a `delete()` issuing
   `DELETE /api/history/:id`; the daemon backs it with a `.delete("/api/history/:id")`
   route calling `deleteHistoryEntry` (A1 added this server-side — without it the
   UI call would 404 at runtime).

## Config changes (minimal, convention-matching)

- **`packages/ui/package.json`** — added `"test": "bun test"` so the regression
  suite runs under the repo's standard `bun run --filter '*' test`. A regression
  test that nothing runs is dead weight; this wires it in. (This also positions
  B6/CI to pick it up for free.)
- **`packages/ui/tsconfig.json`** — added `"exclude": ["src/**/__tests__/**"]`.
  The package's tsconfig sets `"types": []` and targets the RN bundler, so a
  test file using `node:fs` / `bun:test` / `import.meta.dir` would add 4 spurious
  `tsc` errors. Tests run under the **bun runtime** (which provides those
  builtins), not the bundler — excluding them mirrors how `voix-backend` already
  keeps its tests **outside** `src` so they never enter the app typecheck graph.

## Smoke results

| Smoke | Result |
|-------|--------|
| `cd packages/ui && bun test src/__tests__/nativeness.test.ts` | ✅ **16 pass / 0 fail** (28 expect calls) |
| `bun run --filter '@voix/ui' test` (wired into root `bun run test`) | ✅ 16 pass / 0 fail, exit 0 |
| `bun run check` (root: native-siblings · protocol-sync · pin-bounds) | ✅ all OK |
| `bun run typecheck` (`@voix/ui`) | ✅ **8 errors — unchanged baseline**, none from the test file |

**On the typecheck "8 errors":** these are **pre-existing** and unrelated to B3 —
they come from `.native.*` files (`Icon.native`, `SwipeableRow.native`,
`haptics.native`, `safeArea.native`, `MacOverlay.native`, `useGlobalHotkey.native`,
`audioCapture.native`) referencing app-shell-only native modules that aren't
installed in `@voix/ui`'s `node_modules`, plus a `NativeEventEmitter` generic
constraint. Verified: the count is **8 with and without** this change. The
`__tests__` exclude ensures the new test contributes **zero** new errors.

## Files modified

- `packages/ui/src/__tests__/nativeness.test.ts` (new — the suite)
- `packages/ui/package.json` (added `test` script)
- `packages/ui/tsconfig.json` (excluded `__tests__` from the typecheck graph)
- `docs/phase-6/verify-results/B3-nativeness-tests-report.md` (this report)
