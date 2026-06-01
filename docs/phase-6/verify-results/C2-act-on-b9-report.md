# C2 — Act on B9 unused-code audit

**Date:** 2026-06-01
**Input:** [`B9-unused-audit-report.md`](./B9-unused-audit-report.md) §5 "Top-10 just delete this"
**Mandate:** execute the confirmed-dead deletes; hand-verify each before
removal; revert anything that breaks; defer/skip the false-positives and
the items the audit explicitly flagged as decisions.

---

## TL;DR

- **7 of 10 candidates deleted** — all re-verified by fresh repo-wide
  grep (only the declaration line present, zero callers/re-exports).
- **3 candidates NOT deleted** — flagged for coordinator decision and
  not yet answered: `#4 shutdownAll`, `#7 deleteVoice`, `#10 Browser*/Hello*
  group`. Rationale below. None are blind-safe; the audit itself flagged
  each as "decision, not blind delete."
- **Net LOC removed: −49** (50 deletions, 1 insertion) across 7 files.
- **All smoke gates green**: `bun run check`, backend tests (159 pass /
  0 fail), backend + `clients/app` `tsc --noEmit`, web `dist/` build,
  iOS Debug `** BUILD SUCCEEDED **`.
- **No reverts needed** — nothing broke.

---

## Deletions executed (7)

| # | Symbol | File | Verify (fresh grep) | LOC |
|---|---|---|---|---|
| 1 | `_LEGACY_PUCK_DEFAULT_CAPS` | `voix-backend/src/audio_io/connection.ts` | only decl @:375; no test refs | −4 |
| 2 | `_resetProvidersCache` | `packages/ui/src/lib/useProviders.ts` | only decl @:91; 0 refs | −6 |
| 3 | `getDevice` | `voix-backend/src/devices/store.ts` | only decl @:136; 0 callers | −4 |
| 5 | `listSources` | `voix-backend/src/context/registry.ts` | only decl @:37; 0 callers | −4 |
| 6 | `ensureDir` | `voix-backend/src/storage/paths.ts` | only decl @:49; 0 callers | −6* |
| 8 | `OpenAiRealtimeToolSpec` | `voix-backend/src/context/types.ts` | only decl @:70; 0 refs | −12 |
| 9 | `DaemonToPuck` | `voix-backend/src/puck/protocol.ts` | only decl @:70; 0 refs | −15 |

\* `ensureDir` removal also orphaned the `mkdirSync` import in
`paths.ts`; the import was narrowed to `{ existsSync }` (the +1
insertion) — `existsSync` is still used (2 refs).

Notes on each verification:
- For #6, confirmed `mkdirSync` had no other use in the file before
  dropping it from the import (would otherwise trip `noUnusedLocals`).
- For #9, `DaemonToPuck` references `LegacyMode`, which stays live
  (still used at `puck/protocol.ts:52`).
- For #2, `cache` (closed over by the helper) stays live (9 in-file refs).

---

## NOT deleted (3) — deferred for coordinator decision

A non-blocking `decision_gate` was sent to the coordinator covering
these three; no answer received before completion. The audit flagged
each as a judgement call (not a blind delete), so they were left in
place rather than removed unilaterally.

### #4 `shutdownAll` — `voix-backend/src/context/registry.ts:119`
Genuinely zero-reference, **but** it is a graceful-shutdown helper that
closes all context sources (`src.close?.()`) — a daemon *should* call
this on teardown. The audit's own note recommends **wiring it in**
rather than deleting. Left intact pending a "delete vs. wire-up"
decision. *Not a false positive — a design decision.*

### #7 `deleteVoice` — `voix-backend/src/voices/store.ts:279`
Zero callers (no delete-voice endpoint in `api/voices.ts`), **but** the
audit explicitly says "Confirm with Tom there's no planned delete-voice
UI first — could be intentional-future." It contains real guard logic
(refuses to delete built-in voices), suggesting deliberate forward
provisioning. Left intact pending Tom's confirmation.

### #10 group `BrowserClientEvent` / `BrowserClientOpts` / `HelloCapabilities` / `HelloClientInfo`
This is the audit's lowest-confidence item and a **`@voix/ui` public-API
barrel** concern. Fresh grep shows:
- `BrowserClientEvent` — **used internally** at `client.ts:86`
  (`onEvent: (ev: BrowserClientEvent) => void`). The type is **live**;
  only the `index.ts:44` barrel re-export is unconsumed. Deleting the
  type would break `client.ts`. → **false-positive for deletion**
  (de-export only).
- `BrowserClientOpts` — **used internally** at `client.ts:120`
  (constructor param). Same as above. → **false-positive for deletion**.
- `HelloCapabilities` / `HelloClientInfo` — thin aliases
  (`= Capabilities` / `= ClientInfo`) re-exported via `platform/index.ts`;
  no internal use. Truly barrel-dead, but they are part of the published
  `@voix/ui` surface; removing them is an API-surface change, not a
  safe internal cleanup.

Verdict: **skipped the whole #10 group.** Two of the four are live
(internal use), and the remaining two are public-API aliases whose
removal needs an explicit "this surface has no external consumer"
sign-off. Recommended follow-up is *de-export* (drop from the barrels),
not delete — out of scope for a "delete dead code" pass.

---

## False-positive corrections to B9

The B9 §5 Top-10 listed `BrowserClientEvent` and `BrowserClientOpts` as
deletion candidates. Hand-verification shows both are **used internally**
within `packages/ui/src/audio_io/client.ts` (`:86`, `:120`), so the
*types* are live — only their barrel re-export is unconsumed. B9 already
caveated #10 as lowest-confidence "de-export or delete"; this report
pins it down: **de-export-eligible, not delete-eligible.**

All other Top-10 findings verified accurate.

---

## Smoke results

| Gate | Command | Result |
|---|---|---|
| Repo check | `bun run check` | ✅ native-siblings OK, pin-bounds OK |
| Backend tests | `bun --cwd voix-backend test` | ✅ **159 pass / 0 fail** (332 expect) |
| Backend types | `bunx tsc --noEmit` (voix-backend) | ✅ exit 0 |
| App types | `bunx tsc -p clients/app/tsconfig.json --noEmit` | ✅ exit 0, no output |
| Web build | `cd voix-backend/ui && bun run build` | ✅ `dist/` produced (350 modules; pre-existing dynamic-import warnings only) |
| iOS build | `xcodebuild -workspace clients/app/ios/voix.xcworkspace -scheme voix -configuration Debug -sdk iphonesimulator -destination id=C6ED4127-… build CODE_SIGNING_ALLOWED=NO` | ✅ `** BUILD SUCCEEDED **` |

No reverts required — every gate that passed before the deletions still
passes.

---

## Commits (pushed to `origin/main`)

| SHA | Group | Files |
|---|---|---|
| `44d51d9` | dead backend exports | connection.ts, devices/store.ts, context/registry.ts, storage/paths.ts, context/types.ts, puck/protocol.ts |
| `d78b9e2` | dead ui test helper | packages/ui/src/lib/useProviders.ts |

**Net LOC: −49** (50 deletions, 1 insertion).

> Note: `packages/ui/src/App.tsx` showed uncommitted modifications in the
> working tree at the time of this task that were **not** made by C2
> (likely a concurrent agent). It was deliberately excluded from both
> commits — only the seven files above were staged.
