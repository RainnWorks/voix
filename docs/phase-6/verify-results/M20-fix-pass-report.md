# M20 fix-pass report
Status: SUCCESS

All 5 fixes landed as discrete commits (4 on `main`, 1 on
`legacy/tauri-clipboard`). Tester non-blocker rolled into Fix 5's
main-side commit per brief. Leaf-path AC6 smoke green; legacy branch
LEGACY.md pushed to origin. One root-path tsc regression surfaced
below (out of brief scope).

## Receipts

### `stat -f "%m %z %N"` for files touched

```
1780230902   451  clients/app/tsconfig.json
1780230902  3531  docs/phase-6/m20-manual.md
1780230902 23104  docs/phase-6/verify-results/M20-implementer-report.md
1780230902 23315  docs/phase-6/architecture-m20.md
1780230902  1087  packages/ui/src/lib/apiBase.native.ts
1780230902  2859  voix-backend/Dockerfile
```

Plus `LEGACY.md` (newly created at root of `legacy/tauri-clipboard`),
not visible from `main`.

### `git log --oneline -8` (main)

```
3b7737c archive(M20 fix): LEGACY.md on snapshot branch + apiBase placeholder warning
7a894a2 docs(M20 fix): CLI version note per Diego H3
913cd3c docs(M20 fix): correct Delta 1 misattribution per Diego H1
2a0d09a archive(M20 fix): rm -rf app/ on-disk leftover; manual.md note for future Tom
882ca84 clients/app(M20 fix): tsconfig ignoreDeprecations 6.0 → 5.0 for TS 5.9 leaf
13a4336 docs(M20 step10): close M20 + queue M20a + Tom's manual smoke
370bcaa archive: remove Tauri app/ — see legacy/tauri-clipboard
49ad1ab archive: snapshot Tauri app/ before removal
```

### `git ls-remote origin legacy/tauri-clipboard`

```
5bcfd20c85a96609f3d0bd878870858193a37aae	refs/heads/legacy/tauri-clipboard
```

(was `2ec5eaced2d494f12cee1096b54b6ac4e104a38d` before this fix-pass.)

### `git log --oneline origin/legacy/tauri-clipboard -3`

```
5bcfd20 legacy: LEGACY.md — pre-pivot context note
2ec5eac legacy: snapshot pre-pivot Tauri clipboard app at M02e rename
de38bd6 clients/app(M20 step8): render <App/> from @voix/ui
```

## Fix 1 — tsconfig 6.0 → 5.0
- Commit: `882ca84`
- tsc smoke from `clients/app/`:
  ```
  $ cd /Users/tom/Projects/voix/clients/app && bunx tsc -p tsconfig.json --noEmit; echo "exit=$?"
  exit=0
  ```
  (No diagnostic output — clean exit.)
- tsc smoke from repo root:
  ```
  $ bunx tsc -p clients/app/tsconfig.json --noEmit; echo "exit=$?"
  clients/app/tsconfig.json(4,5): error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
    Visit https://aka.ms/ts6 for migration information.
  exit=2
  ```
  Root path is **not green** — `bunx` from root resolves to
  workspace `typescript@6.0.3`, which requires `"6.0"` (the value we
  just removed) to silence baseUrl's TS5101 warning. AC6's intent is
  the leaf path (the natural Tom-side invocation per Diego B1); root
  path regressed in the opposite direction. See "Issues surfaced"
  below — not in the fix-pass brief.

## Fix 2 — rm -rf app/ + manual.md note
- Commit: `2a0d09a`
- Legacy SHA verified before rm: `2ec5eaced2d494f12cee1096b54b6ac4e104a38d`
- `du -sh /Users/tom/Projects/voix` after: `2.2G` (was ~10G).
- `git status` after: shows only `?? docs/phase-6/verify-results/` (the
  untracked verify-results dir holding all M19+M20 reports — unrelated
  to this fix). `?? app/` is gone.
- manual.md step 0 edit: added one-line note pointing future Tom at
  `rm -rf app/` + the legacy snapshot branch.

## Fix 3 — Delta 1 misattribution doc
- Commit: `913cd3c`
- Edited `docs/phase-6/verify-results/M20-implementer-report.md` —
  added a one-paragraph correction footnote under Delta 1 stating
  rn-macos-init does NOT write `react-native.config.js` or the
  `start:macos` script. Created the file in git (the verify-results
  dir was untracked; this is the first M20 file from it that's now
  tracked on `main`).

## Fix 4 — CLI 20.0.0 vs 20.1.3 doc
- Commit: `7a894a2`
- Edited `docs/phase-6/architecture-m20.md` Decision 2 — added a Note
  paragraph: `--version` pins RN, not CLI; the resolved CLI is
  template-bundled `20.0.0`, not `20.1.3`. Both 20.x, functionally
  equivalent.

## Fix 5 — apiBase warning + LEGACY.md + Dockerfile M20a ref
- main commit: `3b7737c`
  - `packages/ui/src/lib/apiBase.native.ts`: added the explicit FIX
    BEFORE FIRST USE banner above `DEV_DAEMON_URL` verbatim per brief.
  - `voix-backend/Dockerfile`: changed "M20 will land a pre-build
    vendoring step" → "M20a will land a pre-build vendoring step"
    (Tester non-blocker).
- legacy branch commit: `5bcfd20`
  - New file `LEGACY.md` at repo root of `legacy/tauri-clipboard`,
    body verbatim from brief.
- legacy branch push result:
  ```
  sign_and_send_pubkey: signing failed for ED25519 "GitHub MBP" from agent: communication with agent failed
  To github.com:RainnWorks/voix.git
     2ec5eac..5bcfd20  legacy/tauri-clipboard -> legacy/tauri-clipboard
  ```
  (The signing-agent warning is identical to what the M20 Implementer
  saw at original snapshot push — auth itself succeeded, branch is on
  origin.)

## Issues surfaced (beyond brief)

1. **Fix 1 trades leaf TS5103 (exit 2) for root TS5101 (exit 2).**
   `clients/app/tsconfig.json` now reads `"ignoreDeprecations": "5.0"`.
   That silences baseUrl's deprecation warning under leaf
   `typescript@5.9.3` (the AC6 path Diego flagged) but not under root
   `typescript@6.0.3` (which silences it only with `"6.0"`). Net:
   leaf green, root red. The brief's smoke spec said "re-run from
   repo root to confirm both paths green" — that confirmation
   failed. Possible follow-ups (NOT applied per "don't go beyond the
   brief"):
   - (a) Bump leaf `typescript` to `6.0.x` in
     `clients/app/package.json` devDeps and put the value back to
     `"6.0"`. Risks RN 0.81's TS 5.9 pin assumption.
   - (b) Drop `ignoreDeprecations` entirely and accept the baseUrl
     warning at both versions until TS 7.0 actually removes the
     option.
   - (c) Align root `typescript` down to `5.9.x` to match the leaf.
   This is Diego B1's "option (a) vs (b)" trade-off resurfacing;
   the brief picked (a) explicitly. Surfacing for the verify trio's
   re-pass.

2. **`docs/phase-6/verify-results/` is now half-tracked.** Fix 3
   committed only `M20-implementer-report.md` from that directory.
   The other 7 files (M19 trio + M19 fix-pass + Marina/Diego/Tester
   for M20 + this fix-pass report) remain untracked on `main`.
   `git status` will keep showing `?? docs/phase-6/verify-results/`
   until those are dealt with. Not in this fix-pass's scope; flag
   for a separate "track the verify trail" commit.

3. **The signing-agent ED25519 warning** still prints on every push
   to origin (saw the same on the original snapshot push). Cosmetic
   for now; not affecting auth.

## Re-verify recommendation

**needs-another-pass** — but only for Issue 1 (the root-path tsc
regression). Diego B1's letter-of-the-law was satisfied (leaf path
fixed) but the brief's stated smoke ("both paths green") was not.
Suggest the verify trio decide between:

- accept the regression (root tsc is not a Tom-day path and the
  workspace-root typecheck happens in CI which is M21+),
- or pick a different option from the (a/b/c) menu in Issue 1.

Everything else (B2 disk leftover + manual.md note, H1 doc fix,
H3 CLI doc, M3 apiBase warning, Marina LEGACY.md, Tester Dockerfile)
is **ready-to-close**.
