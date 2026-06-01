# B6 — CI setup report

**Date:** 2026-06-01
**Task:** B6 from `/tmp/voix-overnight-backlog.md` — add GitHub Actions CI.
**Status:** ✅ Shipped. All five CI steps pass locally (exit 0).

## Goal

voix had zero CI. Add a GitHub Actions workflow that runs on every push
to `main` + PRs: repo checks, daemon tests, daemon typecheck, web-UI
build, and RN-client typecheck — so regressions are caught before they
reach Tom. No `xcodebuild` in CI (too slow + needs Apple Dev signing);
JS/TS side only.

## Delivered

1. **`.github/workflows/ci.yml`** — triggers on `push: [main]`,
   `pull_request`, and `workflow_dispatch`. Runs on `macos-latest`.
   `concurrency` cancels superseded runs on the same ref.
   Steps: checkout → `oven-sh/setup-bun@v1` (pinned `1.3.11`) →
   `actions/cache@v4` (`~/.bun/install/cache` + all `node_modules`
   trees, keyed on `bun.lock`) → `bun install --frozen-lockfile` →
   five check steps (table below).
2. **`docs/build-workflow.md`** — new `## CI` section with the status
   badge, a step/command/guard table, and a note on the `bun-types`
   dependency (see Findings).
3. **`README.md`** — CI status badge under the title, linking to the
   Actions page.
4. **Local sanity test** — ran each CI command as a shell sequence;
   all exit 0 (evidence below).

## Local smoke — all exit 0

| Step | Command | Result |
|---|---|---|
| Repo checks | `bun run check` | EXIT=0 |
| Backend tests | `cd voix-backend && bun test` | EXIT=0 — 140 pass / 0 fail |
| Backend typecheck | `cd voix-backend && bun run typecheck` | EXIT=0 |
| UI build | `cd voix-backend/ui && bun run build` | EXIT=0 — vite built 348 modules |
| App typecheck | `bunx tsc -p clients/app/tsconfig.json --noEmit` | EXIT=0 |
| Frozen install | `bun install --frozen-lockfile` | EXIT=0 |

## Findings & decisions

### 1. `bun --cwd <dir> run <script>` silently no-ops — DO NOT USE
The task's literal smoke commands used `bun --cwd voix-backend run
typecheck` / `bun --cwd voix-backend/ui run build`. These **print
`bun run` help and exit 0 without running anything** — a false-green
trap. (The `bun --cwd <dir> test` form works only because `test` is a
bun builtin subcommand, not a package script.)
**Fix:** the workflow uses GitHub Actions `working-directory:` + a bare
`bun run <script>` instead, which actually executes the script.

### 2. Daemon typecheck was latently broken on a clean install — FIXED
`voix-backend/tsconfig.json` declares `"types": ["bun-types"]`, but
`bun-types` was only a *transitive* dep (via `@types/bun`, which itself
just does `/// <reference types="bun-types" />`). Bun's isolated linker
hoists only *direct* deps to a resolvable `node_modules/<pkg>`, so
`tsc` could not find `bun-types` and failed with
`TS2688: Cannot find type definition file for 'bun-types'`. This is
deterministic — it would fail on a fresh CI `bun install` too.
**Fix:** added `"bun-types": "^1.3.14"` to `voix-backend`
devDependencies (matching the version `@types/bun@1.3.14` pins). After
`bun install`, `voix-backend/node_modules/bun-types` resolves and
typecheck passes. Lockfile updated. This is exactly the kind of latent
regression CI is meant to catch — caught here before CI even shipped.

### 3. Caching
Cache keyed on `bun.lock` (`${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}`)
with a `restore-keys` fallback. Paths cover the bun global install
cache plus every workspace `node_modules` tree (root, voix-backend,
voix-backend/ui, clients/app, packages/*).

## Files modified

- `.github/workflows/ci.yml` (new)
- `voix-backend/package.json` (+`bun-types` devDep)
- `bun.lock` (lockfile update for the above)
- `README.md` (+CI badge)
- `docs/build-workflow.md` (+`## CI` section)

## Caveats / not done

- CI cannot be fired without pushing to GitHub; validation here is the
  local shell-sequence equivalent (each step exit 0). The first real
  Actions run will confirm the badge + macOS runner behaviour.
- `xcodebuild` / native iOS+macOS builds intentionally excluded.
- Pre-existing untracked files in the tree (`.claude/`,
  `docs/architecture/dedup-audit.md`, `docs/tooling/`,
  `voix-backend/test-debug.ts`) are **not** mine and were left
  untouched / uncommitted.
