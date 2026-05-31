# M20 Tester brief

**Role**: Tester. Same posture as M19's: run every smoke test the
Implementer claimed, capture output, distinguish "shape" (build /
typecheck exit 0) from "verified" (real dependency exercised).

## Canonical inputs

- `docs/phase-6/architecture-m20.md` — brief. Acceptance criteria
  list (15 items) at the very bottom.
- `docs/phase-6/verify-results/M20-implementer-report.md` — the
  Implementer's claims. Cross-check; don't trust.
- `git log --oneline -15` on main + `git branch -a` — see what
  shipped.

## Tasks (in order)

1. **Receipts spot-check** — pick 3 file paths from the Implementer's
   stat list; re-run `stat -f "%m %z %N" <path>` for each; report
   match/mismatch. Stop if any mismatch.

2. **Acceptance criteria run-through** — execute the actual command
   for each of the 15 criteria in the brief's final section. Don't
   trust the Implementer's ✓/✗ — re-run.

3. **Tauri archive integrity** — most fragile part of M20.
   - `git ls-remote origin legacy/tauri-clipboard` must return a SHA.
   - `git log legacy/tauri-clipboard -p -- app/src-tauri/src/commands.rs | grep -E "voix\.list_voices|voice_id"` must print at least one match (M02e diff preserved).
   - `git log --all --oneline -- app/ | head -5` should show: (a) snapshot commit on main, (b) remove commit on main, (c) snapshot commit on legacy branch.
   - `git ls-files app/` must return empty on main.

4. **RN-CLI scaffold integrity**:
   - `clients/app/package.json` exists; declares `@voix/ui` + `@voix/protocol` as `workspace:*`; uses `react-native@0.81.6`.
   - `clients/app/ios/` exists with `voix.xcodeproj` + `Podfile`.
   - `clients/app/macos/` exists with `voix.xcodeproj` + `Podfile`; `grep "platform :macos" macos/Podfile` prints `'11.0'`.
   - `clients/app/metro.config.js` contains `watchFolders` AND `nodeModulesPaths` AND `extraNodeModules`.
   - `clients/app/index.js` imports `App` from `@voix/ui` (NOT relative path).
   - `clients/app/android/` exists (untouched; Phase 8 picks it up).

5. **Extension strip verification (Hiro Delta D)**:
   - `grep -rEn "from\s+['\"]\.[^'\"]+\.(ts|tsx)['\"]" packages/ui/src --include="*.ts" --include="*.tsx"` returns 0 matches.
   - All-day's-work check: `cd voix-backend/ui && bun run build` still produces a working dist (the strip mustn't break the web target).

6. **Native-sibling guard (Hiro M2)**:
   - `bun run check` exits 0.
   - Inject a fake orphan: `touch packages/ui/src/components/Orphan.native.tsx`. Re-run `bun run check`. Must exit non-zero with a clear ORPHAN message. Then `rm` the orphan. Don't commit.

7. **apiBase shim**:
   - `packages/ui/src/lib/apiBase.ts` + `apiBase.native.ts` both exist.
   - Every `fetch(` in `packages/ui/src/lib/api.ts` is wrapped: `fetch(getApiBase() + …, ...)`. Grep: `grep -nE "fetch\(" packages/ui/src/lib/api.ts | grep -v "getApiBase()"` must return empty.

8. **Daemon boot smoke** — every Implementer step claimed this. Re-run once at HEAD:
   ```
   cd voix-backend && timeout 5 bun src/index.ts 2>&1 | head -10
   ```
   Must print `listening on :8765`. The daemon's correctness is gated on M19 still working.

9. **clients/app TS compile**:
   - `bunx tsc -p clients/app/tsconfig.json --noEmit` must exit 0.

10. **Vendoring sanity for M20a planning** — note (don't fix): is the
   Dockerfile aware that `voix-backend/ui/package.json` still has
   workspace deps? `grep -c "M20a" voix-backend/Dockerfile` should
   return non-zero (M20a is referenced as future work).

## Output

Saved to `docs/phase-6/verify-results/M20-tester.md`. Receipts at
top; per-task ✓/✗ with last-10-lines evidence; final VERDICT block:

```
## VERDICT
- Receipts integrity: PASS | FAIL
- Acceptance criteria pass count: N/15
- Tauri archive integrity: PASS | FAIL
- Blocking issues: <count + one-line each>
- Recommendation: ship-as-is | fix-and-reship | rework
```

**Caveat**: pod install + simulator launch are Tom's manual steps —
do NOT attempt them. Report "manual smoke pending Tom" for AC #6
and #7's runtime side.
