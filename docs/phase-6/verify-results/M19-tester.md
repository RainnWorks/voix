# M19 Tester report

**Window**: 2026-05-31 13:01:35 +0200 → 13:11:04 +0200 (~10 min)
**Branch**: main @ `fa638d7`
**Posture**: re-ran every smoke; did not trust the Implementer.

## Receipts — files read

```
stat -f "%m %z %N"
1780222767  626   /Users/tom/Projects/voix/package.json
1780224967 3408   /Users/tom/Projects/voix/voix-backend/Dockerfile
1780223977 9817   /Users/tom/Projects/voix/packages/ui/src/conversations/ConversationDetail.tsx
```

Also read (no separate stat): `voix-backend/package.json`,
`voix-backend/ui/package.json`, `voix-backend/ui/src/main.tsx`,
`voix-backend/src/audio_io/protocol.ts`, `voix-backend/tsconfig.json`,
`/tmp/voix-pre-m19/voix-backend/tsconfig.json` (pre-M19 clone),
the three M19 docs (architecture-m19.md, M19-tester.md brief,
M19-implementer-report.md).

## Receipts — commands run (chronological)

| t | command | outcome |
|---|---|---|
| 13:01:35 | `git log --oneline -10` | 6 M19 commits confirmed `e1d71e0..fa638d7` |
| 13:01:35 | `stat -f "%m %z %N"` on 3 receipts | 3/3 match |
| 13:01:55 | `bun install` (root) | exit 0, "Checked 432 installs across 486 packages" |
| 13:02:00 | `ls packages/ui/src/App.tsx; ls voix-backend/ui/src/App.tsx` | new exists, old gone |
| 13:02:10 | `cd voix-backend && bun run typecheck` | exit 2, 5× TS4111 |
| 13:02:25 | `cd voix-backend/ui && bun run build` | exit 0, 325 modules, 642ms |
| 13:02:38 | `cd voix-backend/ui && bun run typecheck` | exit 0 |
| 13:02:50 | `cat dist/index.html \| grep assets/` | `./assets/index-CYY0s67N.js` ✓ |
| 13:03:00 | `grep M19 docs/STATE.md` | M19 row closed, brief linked |
| 13:03:05 | `git diff --stat e1d71e0^..fa638d7 -- app/` | empty (Tauri untouched) |
| 13:03:10 | `timeout 5 docker info` | exit 124 (daemon down — Server: section never printed) |
| 13:03:30 | `bun run dev` from `voix-backend/ui` + `curl http://localhost:5173/` | 200, no React error overlay markup |
| 13:03:50 | `cd voix-backend/ui && bun run build 2>&1 \| grep -iE "warning\|deprecated\|removed"` | empty |
| 13:04:00 | `git log --diff-filter=R --name-status e1d71e0^..fa638d7` | 14 renames (R85-R100, all preserved as git rename) |
| 13:04:10 | `bun pm ls --hoisted` | shows 4 workspace pkgs hoisted under root node_modules |
| 13:04:20 | `bun run --filter voix-ui build` | exit 0, 325 modules, 582ms |
| 13:04:30 | `bun run --filter voix-backend typecheck` | exit 2, same 5× TS4111 |
| 13:04:45 | clone @ `e1d71e0^` → typecheck | exit 0 (0 errors, blob hashes for devices.ts + history.ts identical to HEAD) |
| 13:09:00 | inspected Dockerfile + voix-backend/package.json | confirmed `"@voix/protocol": "workspace:*"` daemon dep + no packages/ COPY in Dockerfile |

## Task 1 — Receipts integrity

| File | Implementer mtime | Implementer size | My stat mtime | My stat size | Match |
|---|---|---|---|---|---|
| `package.json` | 1780222767 | 626 | 1780222767 | 626 | ✓ |
| `voix-backend/Dockerfile` | 1780224967 | 3408 | 1780224967 | 3408 | ✓ |
| `packages/ui/src/conversations/ConversationDetail.tsx` | 1780223977 | 9817 | 1780223977 | 9817 | ✓ |

**Receipts integrity: PASS** (3/3).

## Task 2 — Acceptance criteria run-through

| # | AC | Command | Result |
|---|---|---|---|
| 1 | `bun install` from root, no unresolved peer warnings | `bun install` | ✓ exit 0, "no changes", grep `-iE "peer\|warn"` → empty in `bun install` output. Note: Implementer's "3 transitive peer warnings" not observed on re-run — install was a no-op (already resolved). Treating as PASS (no warnings produced now). |
| 2 | `cd voix-backend && bun run typecheck` passes | `bun run typecheck` | **✗ FAIL** exit 2. 5× TS4111 in `api/devices.ts` + `api/history.ts`. Implementer claims pre-existing; my repro at `e1d71e0^` (clone, fresh install, same tsconfig, same blob hashes) typechecks clean (exit 0). The errors are **new on HEAD** despite identical source. Likely culprit: tsconfig path/baseUrl change (M19 added `baseUrl: "."` + `paths`) altering elysia type resolution. Brief criterion says "passes" — it doesn't. FAIL. |
| 3 | `dist/index.html` references `./assets/…` | `bun run build && cat dist/index.html` | ✓ `<script ... src="./assets/index-CYY0s67N.js">` |
| 4 | `cd voix-backend/ui && bun run typecheck` passes | `bun run typecheck` | ✓ exit 0 |
| 5 | packages/ui/src/App.tsx exists; voix-backend/ui/src/App.tsx does not | `ls` both | ✓ |
| 6 | voix-backend/ui/src/main.tsx imports App from @voix/ui | `cat main.tsx` | ✓ `import { App } from "@voix/ui";` line 3, 12 lines total |
| 7 | packages/protocol/src/audio-io.ts exists; daemon re-export single line | `ls + cat` | ✓ daemon file is `export * from "@voix/protocol";` (one substantive line + doc comment) |
| 8 | HA Add-on `docker build` end-to-end | `docker build .` | **✗ FAIL (verified by code reading; not run)** — see below. |
| 9 | STATE.md M19 row closed, brief linked | `grep M19 docs/STATE.md` | ✓ "M19 merged"; ASCII tree updated with `package.json ← bun workspace root (M19)` |
| 10 | Tauri `app/` and `app/src-tauri/` untouched | `git diff --stat e1d71e0^..fa638d7 -- app/` | ✓ empty diff |

**AC pass count: 8/10.** Failing: #2 (typecheck), #8 (Docker).

## Task 3 — Sub-move integrity

`git log --diff-filter=R e1d71e0^..fa638d7` shows 14 renames preserved
by git (similarity 85-100%), including:

- `voix-backend/ui/src/App.tsx → packages/ui/src/App.tsx` (R085)
- `voix-backend/ui/src/components/{AppShell,Puck,Wordmark}.tsx → packages/ui/src/components/…` (R093-R098)
- `voix-backend/ui/src/{voices,conversations,surfaces}/*` → `packages/ui/src/…` (R098-R099)
- `voix-backend/ui/src/lib/{api,theme}.ts → packages/ui/src/lib/…` (R100)
- `voix-backend/ui/src/audio_io/browserClient.ts → packages/ui/src/audio_io/browserClient.ts → packages/ui/src/audio_io/client.ts` (two-step rename across step3 + step4)

Originals confirmed gone: `ls voix-backend/ui/src/` → only `main.tsx`.

Orphan import scan: `grep -rln "from \"\./components/\|from \"\./voices/\|from \"\./conversations/\|from \"\./surfaces/\|from \"\./lib/\|from \"\./audio_io/" voix-backend/ui/src/` → empty. No stale relative imports.

**Task 3: PASS.**

## Task 4 — Docker build

`timeout 5 docker info` → exit 124. Client connects but Server section
never prints. `docker ps` hangs the same way. Docker daemon
(OrbStack) is not running on this Mac. **Skipped actual `docker
build` — verdict by code reading.**

Code-reading analysis:

- `voix-backend/Dockerfile` line 56: `COPY package.json ./` then
  `RUN bun install --production`. Only copies daemon's own
  package.json; never copies `packages/` into the image.
- `voix-backend/package.json` line 18: `"@voix/protocol": "workspace:*"`.
- `voix-backend/ui/package.json` lines 12-13:
  `"@voix/protocol": "workspace:*"` + `"@voix/ui": "workspace:*"`.
- Docker build context is fixed at `voix-backend/`. `COPY ../packages/`
  is not legal — Docker won't escape context.
- `bun install` inside the image will see `workspace:*` and have no
  workspace root to resolve it from → install fails.

The Implementer's Dockerfile comment (lines 14-38) already
acknowledges this and lists three solution paths (a/b/c). The
build *would* fail. AC #8 is genuinely FAIL.

**Task 4: FAIL (verified by code reading; actual build SKIPPED — docker daemon unavailable).**

## Task 5 — React 19 dev-tools sanity (Delta B)

- `bun run dev` started Vite on :5173. `curl http://localhost:5173/`
  returned 200. Response contains the standard Vite + react-refresh
  injection (`/@react-refresh`, `/@vite/client`), no
  `__REACT_ERROR_OVERLAY__` markup or React error overlay HTML in
  the initial document. (Static HTML cannot reveal runtime overlay,
  which only mounts on client errors — but the dev server boots
  cleanly.)
- `bun run build 2>&1 | grep -iE "warning|deprecated|removed"` →
  empty. Build is warning-free.

**Task 5: PASS for static checks. Real browser dev-tools click-through
not attempted (out of agent scope) — Implementer flagged this same
gap.**

## Task 6 — Web-only file split (Delta A)

- `packages/ui/src/conversations/InlineAudioPlayer.tsx` exists (709 B).
- `packages/ui/src/conversations/InlineAudioPlayer.native.tsx` exists (836 B).
- `ConversationDetail.tsx` line 26: `import { InlineAudioPlayer } from "./InlineAudioPlayer.tsx";`
- `grep -E "<audio" packages/ui/src/conversations/ConversationDetail.tsx`
  → only doc-comment references ("two inline `<audio>` players (via
  React Native Web's…"); no JSX `<audio>` element in source. Render
  delegates to `<InlineAudioPlayer src={src} />` (line 194).

**Task 6: PASS.**

## Task 7 — Bun workspace resolution

```
$ bun pm ls --hoisted | head -20
/Users/tom/Projects/voix node_modules (498)
├── @voix/protocol@workspace:packages/protocol
├── @voix/ui@workspace:packages/ui
├── voix-backend@workspace:voix-backend
└── voix-ui@workspace:voix-backend/ui
```

```
$ bun run --filter voix-ui build
voix-ui build: ✓ 325 modules transformed in 582ms.  exit 0
```

```
$ bun run --filter voix-backend typecheck
voix-backend typecheck: src/api/devices.ts(34,17): error TS4111: …
… (5 TS4111 errors total)
voix-backend typecheck: Exited with code 2
```

Workspace addressing works from root. The typecheck failure
reproduces both from inside `voix-backend/` and via `--filter` —
consistent.

**Task 7: PASS (resolver works; typecheck failure is a separate
issue scored under AC#2).**

## Task 8 — Tested vs Verified

| Area | Tested (unit/build) | Verified (real dependency) |
|---|---|---|
| bun workspace install | ✓ `bun install` exit 0 from root; `bun pm ls --hoisted` shows 4 workspaces | — |
| `@voix/protocol` re-export | ✓ daemon file is single-line `export * from "@voix/protocol"`; UI build resolves it | — (no daemon runtime smoke; Implementer claims `bun --eval parseHello` reachable but I did not repro) |
| `@voix/ui` consumers | ✓ `voix-ui build` 325 modules; main.tsx imports from `@voix/ui` resolves through Vite + tsconfig-paths | — (no browser click-through) |
| Vite resolver plugin (`ignoreNativeSuffixes`) | ✓ build produces 325 modules; no `.native.ts` ends up in the bundle (would have caused throw at runtime in stub) | — |
| HA add-on Docker build | ✗ neither tested nor verified — daemon down. Code-read says it would fail. | ✗ |
| React 19 runtime | ✓ build warning-free; dev server boots clean | — (no manual screen click-through) |

The brief's expectation ("for M19 only Docker should be Verified")
is **not met** — Docker is neither Tested nor Verified, and that's
the *only* end-to-end behaviour M19 has. Everything else is
shape-only.

## Blocking issues

1. **AC #2 FAIL**: `cd voix-backend && bun run typecheck` exits 2
   with 5× TS4111. Implementer claims pre-existing; my pre-M19
   clone typechecks clean despite identical source blobs, so the
   regression is induced by M19's tsconfig change (added `baseUrl`
   + `paths` → likely altered elysia `t.Object` / `t.Optional`
   resolution). Needs a one-line tsconfig fix (drop `paths` from
   daemon's tsconfig in favour of a node-modules resolution, or
   relax `noPropertyAccessFromIndexSignature` for these call sites)
   or bracket-access fixes in the affected files.
2. **AC #8 FAIL (structural)**: HA Add-on Docker build is broken by
   the `voix-backend/package.json` workspace dep on `@voix/protocol`.
   Implementer already flagged + documented three paths (a/b/c) in
   the Dockerfile. Production HA Add-on store install is broken
   until coordinator picks one.

## Deltas surfaced by Implementer — verified status

- **Delta C (Docker break)**: ✓ verified by code reading.
- **Delta D (Metro `.native` resolution from explicit `.ts(x)` suffixes)**:
  not reproducible in M19 (no RN app yet) — accepted as M20-deferred.
- **Delta E (`@types/react-native` removed)**: noted; not a blocker.

---

## VERDICT
- Receipts integrity: PASS
- Acceptance criteria pass count: 8/10
- Blocking issues: 2
  - AC#2 daemon typecheck regression (M19-induced via tsconfig paths)
  - AC#8 HA Add-on Docker build structurally broken (workspace dep escapes context)
- Recommendation: **fix-and-reship** — both blockers are scoped:
  AC#2 is a one-commit tsconfig/source fix; AC#8 needs the
  coordinator to pick path (a), (b), or (c) from the Dockerfile
  comment before HA Add-on production install will work. Dev paths
  (local + HA dev_mode) are unaffected, so the monorepo shape is
  usable for M20 immediately.
