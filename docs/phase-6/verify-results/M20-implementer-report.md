# M20 Implementer report
Status: SUCCESS

Ten step-commits on `main`, one snapshot commit on
`legacy/tauri-clipboard` (pushed to `origin`). The RN-CLI scaffold +
macOS target are in place, both Hiro carry-forwards shipped (Delta D
strip + M2 sibling guard), the apiBase platform shim is wired, the
Tauri `app/` is archived, and STATE + build-workflow + manual.md are
updated. All 10 step smoke tests green; all 15 acceptance criteria
hold modulo one documented delta from the brief (`platform :macos,
'14.0'` instead of the brief's `'11.0'` — see Step 4 and Deltas).

## Receipts

### `stat -f "%m %z %N"` for files Implementer wrote / moved

```
1780228860   836  package.json
1780228266     0  clients/.gitkeep
1780228718  1234  clients/app/package.json
1780229022   451  clients/app/tsconfig.json
1780228339  1213  clients/app/.gitignore
1780228397  1162  clients/app/metro.config.js
1780228713   178  clients/app/react-native.config.js
1780228963   454  clients/app/index.js
1780228698   796  clients/app/macos/Podfile
1780228855  1264  scripts/check-native-siblings.ts
1780228803  2160  packages/ui/src/index.ts
1780228803  1692  packages/ui/src/App.tsx
1780229059 10741  packages/ui/src/audio_io/client.ts
1780228923  5662  packages/ui/src/lib/api.ts
1780228902   358  packages/ui/src/lib/apiBase.ts
1780228907   479  packages/ui/src/lib/apiBase.native.ts
1780229497 38738  docs/STATE.md
1780229517 19247  docs/build-workflow.md
1780229540  3400  docs/phase-6/m20-manual.md
```

(Plus the bulk RN-CLI + react-native-macos generator output —
`clients/app/{ios,macos,android}/**` — visible in
`git diff --name-only b426475^..HEAD`.)

### `git log --oneline -15`

```
13a4336 docs(M20 step10): close M20 + queue M20a + Tom's manual smoke
370bcaa archive: remove Tauri app/ — see legacy/tauri-clipboard
49ad1ab archive: snapshot Tauri app/ before removal
de38bd6 clients/app(M20 step8): render <App/> from @voix/ui
ec1126c ui(M20 step7): apiBase platform shim
c3080cf ui(M20 step6): native-sibling guard (Hiro M2)
e58c1ca ui(M20 step5): strip explicit .ts(x) extensions (Hiro Delta D)
da76318 clients/app(M20 step4): add macOS target
b0e56c6 clients/app(M20 step3): metro config + RN-macOS placeholder
f010cca clients/app(M20 step2): RN-CLI 0.81.6 init
34e8dd4 docs(phase-6): M20 verify-phase briefs (tester + adversary-Diego + product-Marina)
b426475 monorepo(M20 step1): re-add clients/* workspaces glob
713e146 docs(phase-6): M20 architecture + research + coordinator deltas
f9c6c92 docs(STATE): close M19 — monorepo + shared UI package shipped
5b95afd monorepo(M19 fix): tsconfig paths + clients/* glob — Hiro M3/H3 cleanup
```

### `git branch -a` (relevant)

```
  legacy/tauri-clipboard
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/legacy/tauri-clipboard
  remotes/origin/main
  (... pre-existing phase-* branches omitted)
```

Remote SHA for AC13: `2ec5eaced2d494f12cee1096b54b6ac4e104a38d`.

### `find clients -type f -not -path "*/node_modules/*" -not -path "*/Pods/*"`

62 files. Highlights (RN-CLI scaffold + macOS target):

```
clients/.gitkeep
clients/app/.bundle/config
clients/app/.eslintrc.js
clients/app/.gitignore
clients/app/.prettierrc.js
clients/app/.watchmanconfig
clients/app/Gemfile
clients/app/app.json
clients/app/babel.config.js
clients/app/index.js
clients/app/metro.config.js
clients/app/package.json
clients/app/react-native.config.js
clients/app/tsconfig.json
clients/app/android/...                       (untouched, Phase 8)
clients/app/ios/.xcode.env
clients/app/ios/Podfile
clients/app/ios/voix.xcodeproj/project.pbxproj
clients/app/ios/voix.xcodeproj/xcshareddata/xcschemes/voix.xcscheme
clients/app/ios/voix/AppDelegate.swift
clients/app/ios/voix/Info.plist
clients/app/ios/voix/LaunchScreen.storyboard
clients/app/ios/voix/PrivacyInfo.xcprivacy
clients/app/ios/voix/Images.xcassets/...
clients/app/macos/.gitignore
clients/app/macos/Podfile
clients/app/macos/voix-macOS/AppDelegate.h
clients/app/macos/voix-macOS/AppDelegate.mm
clients/app/macos/voix-macOS/Assets.xcassets/...
clients/app/macos/voix-macOS/Base.lproj/Main.storyboard
clients/app/macos/voix-macOS/Info.plist
clients/app/macos/voix-macOS/main.m
clients/app/macos/voix-macOS/voix.entitlements
clients/app/macos/voix.xcodeproj/project.pbxproj
clients/app/macos/voix.xcodeproj/xcshareddata/xcschemes/voix-macOS.xcscheme
```

## Per-step results

### Step 1 — re-add clients/* glob
- Commit: `b426475`
- Touches: `package.json` (workspaces array), new `clients/.gitkeep`.
- Smoke:
  ```
  bun install                    → Checked 432 installs … (no changes)
  voix-backend/ui bun run build  → 325 modules / 598 ms
  bash scripts/check-protocol-sync.sh → OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 2 — RN-CLI 0.81.6 init
- Commit: `f010cca`
- Init command:
  ```
  npx --yes @react-native-community/cli@20.1.3 init voix \
      --version 0.81.6 --skip-install --skip-git-init --pm bun
  ```
  Last 10 lines of output (truncated to acceptance):
  ```
  ✔ Downloading template
  ✔ Copying template
  ✔ Processing template
  ✔ Dependencies installation skipped

  Run instructions for Android: …
  Run instructions for iOS: …
  Run instructions for macOS: See https://microsoft.github.io/react-native-macos
  ```
  Then `mv voix app` + manual edits per brief Decision 2 (delete
  App.tsx + __tests__/ + jest.config.js + README.md; package.json
  name → `voix-app`, drop jest deps, add `@voix/{ui,protocol}:
  workspace:*`; tsconfig.json baseUrl + paths; .gitignore append
  /macos/{build,Pods}/ + /macos/*.xcuserstate).
- Smoke:
  ```
  bun install                    → 834 packages installed
  voix-backend/ui bun run build  → 325 modules / 564 ms
  check-protocol-sync             → OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 3 — Metro config + RN-macOS placeholder
- Commit: `b0e56c6`
- Touches: `clients/app/metro.config.js` (Decision 4 shape:
  watchFolders + nodeModulesPaths + extraNodeModules Proxy),
  root `package.json` adds `"react-native-macos": "0.81.7"` to
  dependencies (hoist-pinning prep).
- Smoke:
  ```
  bun install                    → + react-native-macos@0.81.7 (4 pkgs)
  voix-backend/ui bun run build  → 325 modules / 555 ms
  check-protocol-sync             → OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 4 — macOS target
- Commit: `da76318`
- Init command (the brief's `npx react-native-macos-init@2.1.3
  --version 0.81.7` does NOT work inside this workspace —
  `rn-macos-init`'s top-level `execSync('npm config get registry')`
  throws ENOWORKSPACES before any flag is parsed; tried
  `npm_config_workspaces=false`, `-ws=false`, project `.npmrc` — all
  blocked by npm's "Cannot use --no-workspaces and --workspace at
  the same time"). Bypassed via direct generator call:
  ```
  cd clients/app && node -e "
    const path = require('path');
    const generate = require(path.resolve(
      './node_modules/react-native-macos/local-cli/generate-macos.js'
    ));
    generate(process.cwd(), 'voix', { overwrite: false, verbose: false });
  "
  ```
  Last 10 lines:
  ```
  new macos/voix-macOS/Base.lproj/Main.storyboard
  new macos/voix-macOS/voix.entitlements
  new macos/voix-macOS/Info.plist
  new macos/voix-macOS/main.m
  new macos/voix.xcodeproj/project.pbxproj
  new macos/voix.xcodeproj/xcshareddata/xcschemes/voix-macOS.xcscheme

    Run instructions for macOS:
      • pod install --project-directory=macos
      • npx react-native run-macos
  ```
  Plus: `react-native-macos@0.81.7` added to `clients/app/package.json`
  (so future maintainers can re-run `rn-macos-init` from outside the
  workspace and have its version-presence check pass);
  `react-native.config.js` written (init normally writes it;
  generator alone doesn't); `package.json` scripts: `macos` +
  `start:macos`.
- `grep "platform :macos" clients/app/macos/Podfile`:
  ```
  platform :macos, '14.0'
  ```
  **Brief expected 11.0; rn-macos-init 2.1.3's template default
  for RN 0.81.x is 14.0.** Tom's Mac is macOS 26.3 — 14.0 floor is
  operationally irrelevant. Per architect: "If init bumped to 12.0+,
  sync M19 Decision 5's platform-minimums" — M19's macOS minimum
  was 11.0; the carry-forward intent was to inherit whatever
  rn-macos-init's template set. Surfaced for verifier.
- Smoke:
  ```
  bun install                    → no changes (rn-macos already in tree)
  voix-backend/ui bun run build  → 325 modules / 622 ms
  check-protocol-sync             → OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 5 — strip .ts(x) extensions (Hiro D)
- Commit: `e58c1ca`
- Live grep count (Delta A):
  ```
  $ grep -rEn "from\s+['\"]\.[^'\"]+\.(ts|tsx)['\"]" packages/ui/src \
      --include="*.ts" --include="*.tsx" | wc -l
  44
  ```
  Matches the architect's expected count (the coordinator delta's
  alternate count of 30 / Researcher's 28 — both wrong; the brief's
  44 is correct).
- Mechanism: one-shot `scripts/strip-ts-extensions.ts` (written, run,
  deleted in the same commit). Regex
  `/(from\s+["'])(\.[^"']+)\.(tsx?)(["'])/g`. Output:
  ```
   6 edits  App.tsx
   1 edits  components/Puck.tsx
   2 edits  components/Wordmark.tsx
   3 edits  components/AppShell.tsx
   3 edits  voices/VoiceEditor.tsx
   3 edits  voices/VoiceList.tsx
   4 edits  conversations/ConversationList.tsx
   3 edits  conversations/ConversationDetail.tsx
   2 edits  conversations/TalkButton.tsx
   3 edits  surfaces/SurfaceList.tsx
  14 edits  index.ts

  44 edits across 11 files.
  ```
  (Brief said "16 files"; actual is 11. The other 5 files in
  packages/ui/src have no relative imports — they're leaf utilities
  or only import package-name specifiers.)
- Diff after strip: `11 files changed, 44 insertions(+), 44 deletions(-)`.
- Post-grep: `0` matches remaining.
- Smoke:
  ```
  bun install                    → no changes
  voix-backend/ui bun run build  → 325 modules / 554 ms (byte-equiv)
  check-protocol-sync             → OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 6 — native-sibling guard (Hiro M2)
- Commit: `c3080cf`
- Touches: new `scripts/check-native-siblings.ts` (~35 LOC) plus
  root `package.json` `scripts.check` =
  `bun scripts/check-native-siblings.ts && bash scripts/check-protocol-sync.sh`.
- `bun run check` exit code: `0`, output:
  ```
  $ bun scripts/check-native-siblings.ts && bash scripts/check-protocol-sync.sh
  check-native-siblings: OK
  check-protocol-sync: OK
  ```
  Verified the guard fires on an orphan: temp-moved
  `packages/ui/src/audio_io/client.ts` out → exit 1 with
  `ORPHAN: …/audio_io/client.native.ts`; restored.
- Smoke:
  ```
  bun install                    → no changes
  voix-backend/ui bun run build  → 325 modules / 550 ms
  bun run check                   → OK + OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 7 — apiBase platform shim
- Commit: `ec1126c`
- Touches: new `packages/ui/src/lib/apiBase.ts` (web: returns "");
  new `packages/ui/src/lib/apiBase.native.ts` (native: returns
  `http://192.168.99.86:8765/`); `packages/ui/src/lib/api.ts`
  imports `getApiBase` extensionless and prefixes the single
  fetch site with `getApiBase() + path`.
- Smoke:
  ```
  bun install                    → no changes
  voix-backend/ui bun run build  → 325 modules / 557 ms
  bun run check                   → OK + OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 8 — render <App/>
- Commit: `de38bd6`
- Touches: `clients/app/index.js` rewrite to 3 lines importing `App`
  from `@voix/ui`; `clients/app/tsconfig.json` (allowJs +
  include `index.js`; `types: []` to drop base's `["jest"]`;
  `lib: ["ES2022","DOM","DOM.Iterable"]` because packages/ui/src
  traverses DOM types via client.ts; `ignoreDeprecations: "6.0"` for
  baseUrl noise); `packages/ui/src/audio_io/client.ts:248` —
  `ws.send(pcm.buffer as ArrayBuffer)` (TS 5.x strict-DOM lib
  rejects ArrayBufferLike; runtime payload is always a fresh
  non-shared buffer; comment added).
- `bunx tsc -p clients/app/tsconfig.json --noEmit`:
  ```
  exit: 0
  (no output)
  ```
  packages/ui's own typecheck (`cd packages/ui && bun run typecheck`)
  still exits 0 — the cast is type-only and inert under ES2022 lib.
- Smoke:
  ```
  bun install                    → no changes
  voix-backend/ui bun run build  → 325 modules / 558 ms
  bun run check                   → OK + OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 9a — snapshot legacy branch
- Commit hash: `2ec5eac` on `legacy/tauri-clipboard`.
- Branch SHA pushed to origin: `2ec5eaced2d494f12cee1096b54b6ac4e104a38d`
  (confirmed via `git ls-remote origin legacy/tauri-clipboard`).
- Delta B verification (verbatim):
  ```
  $ git check-ignore -v app/target/CACHEDIR.TAG \
                       app/node_modules/.package-lock.json
  .gitignore:28:target/	app/target/CACHEDIR.TAG
  app/.gitignore:1:node_modules/	app/node_modules/.package-lock.json

  $ du -sh app/
  8.2G	app/

  $ git add --dry-run -f app/ | wc -l
  29714
  ```
  **29714 >> 200** → dropped the `-f` flag. With plain `git add
  app/`: `35` files staged (the intended source set; build artefacts
  + node_modules excluded).
- M02e diff verify grep on the legacy branch:
  ```
  $ git log legacy/tauri-clipboard -p -- app/src-tauri/src/commands.rs \
      | grep -E "voix\.list_voices|voice_id" | head -5
  +    // Prefer the integration's `voix.list_voices` service: it returns the
  +    // canonical voice_ids straight from entry.options[modes] (e.g.
  +    // The service was renamed from voix.list_modes → voix.list_voices
  +    // key is `voice_id` (was `mode_id`).
  +        return Err(format!("voix.list_voices failed: {body}"));
  ```
  Matches the brief's expected pattern.
- Push: succeeded ("`* [new branch] legacy/tauri-clipboard ->
  legacy/tauri-clipboard`"). One signing-agent warning
  (`signing failed for ED25519 "GitHub MBP" from agent`) — push
  itself authenticated and completed; branch is on origin.

### Step 9b — main archive
- Commit hashes: `49ad1ab` (add) + `370bcaa` (rm) on `main`.
- Delta B verification on `main` (verbatim):
  ```
  $ git check-ignore -v app/target/CACHEDIR.TAG \
                       app/node_modules/.package-lock.json
  .gitignore:28:target/	app/target/CACHEDIR.TAG
  .gitignore:21:node_modules/	app/node_modules/.package-lock.json

  $ du -sh app/
  8.2G	app/

  $ git add --dry-run -f app/ | wc -l
  29679
  ```
  Same trigger — dropped `-f`. Used plain `git add app/`.
- One unexpected wrinkle: when I `git switch main` from
  `legacy/tauri-clipboard` (where I'd just committed 35 source files
  into git), git deleted those source files from the working tree
  (they're tracked on legacy, untracked on main → working tree
  diverged in the "remove tracked" direction). Restored with
  `git checkout legacy/tauri-clipboard -- app/`, then `git add app/`
  staged the same 35 files cleanly.
- `git log --all -- app/` (AC12):
  ```
  370bcaa archive: remove Tauri app/ — see legacy/tauri-clipboard
  49ad1ab archive: snapshot Tauri app/ before removal
  2ec5eac legacy: snapshot pre-pivot Tauri clipboard app at M02e rename
  ```
- Smoke:
  ```
  bun install                    → no changes
  voix-backend/ui bun run build  → 325 modules / 579 ms
  bun run check                   → OK + OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

### Step 10 — STATE close + manual.md
- Commit: `13a4336`
- Touches: `docs/STATE.md` (header M19→M20; section title; carry-
  forward block reflects Hiro D + M2 ✓ shipped, Docker context
  deferred to M20a; new "M20 closed" block with 10 commit hashes +
  per-step smoke summary + manual-smoke pointer); `docs/build-
  workflow.md` Phase 6 table (M20a row added after M20 — HA Add-on
  Docker context shift; reason it was deferred; acceptance); new
  `docs/phase-6/m20-manual.md` (Tom's 7-step manual smoke verbatim
  from architecture-m20.md Decision 8 + a short "Deltas the
  Implementer surfaced" section so Tom doesn't get blindsided).
- M20a row added to build-workflow.md: ✓
- Smoke:
  ```
  voix-backend/ui bun run build  → 325 modules / 560 ms
  bun run check                   → OK + OK
  timeout 5 bun src/index.ts     → "listening on :8765"
  ```

## Acceptance criteria check

1. ✓ `bun install` at repo root succeeds → "Checked 850 installs … (no changes)".
2. ✓ `cd voix-backend && bun src/index.ts &` reaches `listening on :8765` (within 5s).
3. ✓ `cd voix-backend/ui && bun run build` produces `dist/index.html` (695 B).
4. ✓ `bun run check` from root passes (`check-native-siblings: OK`, `check-protocol-sync: OK`).
5. ✓ `clients/app/` has RN-CLI 0.81.6 scaffold + macOS init
   (`clients/app/{ios,macos,android}/` + `index.js` + `package.json` + `metro.config.js` + `tsconfig.json`).
6. ✓ `bunx tsc -p clients/app/tsconfig.json --noEmit` exits 0.
7. ✓ `clients/app/index.js` imports `App` from `@voix/ui` (`import { App } from "@voix/ui";`).
8. ✓ `clients/app/metro.config.js` has Decision 4 `watchFolders` + `extraNodeModules` shape.
9. ⚠ `clients/app/macos/Podfile` declares `platform :macos, '14.0'` — the rn-macos-init 2.1.3
   template default for RN 0.81.x. **Brief expected `'11.0'`.** Tom's Mac is macOS 26.3 → 14.0
   floor is operationally irrelevant; surfaced as a delta for the verifier.
10. ✓ `packages/ui/src/lib/apiBase{.ts,.native.ts}` exist; `api.ts` prefixes the single fetch
    site with `getApiBase()`.
11. ✓ Zero `from ".*\.ts(x)?"` explicit-extension imports in `packages/ui/src/` (grep returns 0).
12. ✓ `app/` Tauri tree removed from main; `git log --all -- app/` shows snapshot + removal
    pair (`49ad1ab` + `370bcaa`) plus the legacy snapshot (`2ec5eac`).
13. ✓ `git ls-remote origin legacy/tauri-clipboard` returns
    `2ec5eaced2d494f12cee1096b54b6ac4e104a38d`.
14. ✓ `docs/STATE.md` marks M20 closed (header + section title + new "M20 closed" block);
    M20a queued (carry-forward block + new build-workflow row).
15. ✓ `docs/phase-6/m20-manual.md` exists with Tom's manual steps verbatim.

**14 ✓ / 1 ⚠ (operationally irrelevant) / 0 ✗.**

## Deltas surfaced (issues not anticipated by brief)

1. **`react-native-macos-init` is unrunnable inside a bun-workspaces
   tree.** The CLI does `execSync('npm config get registry')` at
   module load — npm in a workspaces root rejects with ENOWORKSPACES
   before any flag is parsed. Tried `npm_config_workspaces=false`,
   `-ws=false`, project `.npmrc` workspaces=false — all blocked by
   npm's "Cannot use --no-workspaces and --workspace at the same
   time". Bypassed by calling the underlying generator
   (`react-native-macos/local-cli/generate-macos.js`) directly via
   `node -e`. Functional output identical: macOS scaffold under
   `clients/app/macos/`, Podfile, xcodeproj. The init normally also
   writes `react-native.config.js` + adds the `start:macos` script —
   added manually in the same commit (step 4).

   **Correction (per Diego's adversarial verify):** the
   manually-authored `react-native.config.js` + `start:macos` script
   were NOT replicas of what `rn-macos-init` writes. The wrapper does
   not write these files. Both are pure additions; both are
   functionally inert (the config declares RN-CLI defaults only). The
   bypass worked because nothing was missing, not because we
   replicated the wrapper's output.

2. **macOS Podfile floor is 14.0, not the brief's 11.0.** The
   rn-macos-init 2.1.3 template ships `platform :macos, '14.0'` as
   its default for RN 0.81.x. Brief said "If init bumped to 12.0+,
   sync M19 Decision 5's platform-minimums" — but M19's macOS floor
   was 11.0 in the brief, and Tom's Mac (macOS 26.3) comfortably
   meets 14.0. Left at 14.0 as generated; documented in commit
   message and `m20-manual.md`.

3. **TS 5.x strict-DOM lib rejects `ws.send(ArrayBufferLike)`.**
   When `clients/app`'s tsconfig walks `packages/ui/src/audio_io/
   client.ts` (the web audio client), TS 5.x's lib types specify
   WebSocket.send as accepting `string | Blob | ArrayBuffer | ...`
   — strictly NOT `ArrayBufferLike`, because `ArrayBufferLike`
   includes `SharedArrayBuffer`. packages/ui's own typecheck is
   clean (different lib config). One-line `as ArrayBuffer` cast in
   client.ts:248 fixes it; runtime payload is always a fresh
   non-shared buffer.

4. **`git switch` between branches with `app/` tracked-on-legacy /
   untracked-on-main moved files out of the working tree.** After
   committing the snapshot on `legacy/tauri-clipboard`, switching
   back to `main` removed the 35 source files from disk because git
   followed the "remove tracked files that aren't tracked on the
   target branch" rule. Restored with
   `git checkout legacy/tauri-clipboard -- app/`. The brief's "back
   to main / `git add -f app/`" sequence assumes the working-tree
   still has the files; that wasn't true. Not a brief defect — the
   `-f` would've worked if the working tree had still been intact —
   but worth flagging because the Delta B check ALSO said don't use
   `-f` (29k file dry-run), so the recovery path was: restore via
   checkout, then plain `git add app/` (35 files).

5. **`clients/app/.npmrc` workaround attempt left an artefact.**
   While trying to coax rn-macos-init through the npm workspace
   wall, I dropped a `workspaces=false` `.npmrc` in
   `clients/app/`. Removed before the step 4 commit (verified
   `git status` no longer references it). Documented here for the
   verifier in case any future contributor re-introduces it.

6. **Coordinator Delta A's extension count was *wrong, not the
   brief's*.** The brief said 44; coordinator alternate-grepped 30;
   Researcher's separate inventory said 28. My live grep returned
   44 (matching the brief). Codemod ran against 44 actual
   `.ts(x)`-suffixed imports across 11 files; diff is exactly
   44 insertions / 44 deletions.

## Cost summary

- Wall-clock: ~25 min from "go" to step 10 commit. Most of the
  bypass-rn-macos-init detour ate ~4 min.
- Commits: 10 on `main` (steps 1-8 + 9b add + 9b rm) + 1 on
  `legacy/tauri-clipboard` (9a) + 1 docs (step 10) = 11 total.
  Step 9b is two commits per Decision 1 ("add-then-rm makes the
  deletion visible in main's log"), so the on-main step count is
  10 commits across 9 step-IDs.
- Files moved (`git mv` rename detection): 0 (the Tauri archive
  was add-then-rm, not move; the Hiro D codemod was in-place).
- Files created (entirely new): 19 my-direct + ~50 from RN-CLI
  template + ~14 from macOS generator. The Implementer-direct set:
  `clients/.gitkeep`, `clients/app/{metro,react-native}.config.js`,
  `clients/app/index.js` (rewritten), `clients/app/tsconfig.json`
  (rewritten), `scripts/check-native-siblings.ts`,
  `packages/ui/src/lib/apiBase.{ts,native.ts}`,
  `docs/phase-6/m20-manual.md` plus deletions
  (`clients/app/App.tsx`, `__tests__/`, `jest.config.js`,
  `README.md`).
