# Phase 6 / M20 — RN-CLI scaffold + Tauri archive

Owner: Architect. Status: ready for Implementer.

Scope: RN-CLI app at `clients/app/` with iOS + macOS targets, hello-
world smoke of `@voix/ui`, archive of pre-pivot Tauri `app/`, and the
Hiro M19 carry-forwards (Delta D, M2) that block native rendering.
M21 platform shims and M22-M24 native shells are out of scope.

## Receipts

Files read (`stat -f "%m %z %N"`):

```
1780222652 24493  docs/phase-6/architecture-m19.md
1780225813 22295  docs/phase-6/verify-results/M19-adversary-hiro.md
1780222139 14772  docs/agent-team-workflow.md
1780226787 35856  docs/STATE.md
1780226367 18694  docs/build-workflow.md
1780222767   626  package.json
1780222770   679  tsconfig.base.json
1780223423  3686  voix-backend/ui/vite.config.ts
1780223606   768  packages/ui/package.json
1780223993  2213  packages/ui/src/index.ts
1780129027  1692  packages/ui/src/App.tsx
            5387  packages/ui/src/lib/api.ts
```

Also grep-walked `app/src-tauri/src/{commands,tray,settings}.rs`,
`app/src/settings.js` (Decision 1 secret sweep + M02e diff check).
Researcher's `docs/phase-6/research-m20.md` not present at write time;
cross-check the 44 explicit `.ts(x)` count (Decision 5A) against their
final inventory.

WebFetched (all 2026-05-31, UTC ~14:00):

- <https://reactnative.dev/docs/0.81/set-up-your-environment>
- <https://reactnative.dev/docs/0.81/getting-started-without-a-framework>
- <https://reactnative.dev/docs/0.81/metro>
- <https://microsoft.github.io/react-native-macos/docs/getting-started>
- <https://metrobundler.dev/docs/configuration>
- <https://github.com/react-native-community/cli>
- <https://github.com/microsoft/react-native-macos/tree/main/packages/react-native-macos-init>
- <https://raw.githubusercontent.com/react-native-community/template/0.81-stable/template/{_gitignore,Gemfile,ios/Podfile,package.json,metro.config.js}>
- npm registry: `react-native-macos@0.81.7` (peer: `react ^19.1.4`,
  `react-native 0.81.6`), `react-native-macos-init@2.1.3`,
  `@react-native-community/cli@20.1.3` (M19 brief said `^21.x` —
  **wrong**; latest is 20.1.3 in the 20.x line that ships with RN 0.81),
  `react-native@0.81.6` (engines: node ≥ 20.19.4).
- Apple Xcode release notes: latest 26.3 stable (May 2026).

Local env probe (Tom's Mac, 2026-05-31): `node v25.9.0`, `ruby 3.3.6`,
`xcode 26.3`, `pod 1.16.2`, `bundle 2.5.23`, `bun 1.3.11`, `macOS 26.3`
— **all OK**. `watchman` **MISSING** → pre-warn (`brew install watchman`).

---

## Decision 1 — `app/` archive procedure

**State on disk**: `git ls-files app/` returns empty; entire tree is
untracked. M02e voice rename diffs are on disk only. **No git history
exists for the current `app/` content** — archive is a fresh snapshot.

**Secrets sweep**: grepped `app/` for `token|secret|api_key|\.env`.
No baked tokens. `ha_token` is a runtime field persisted by
`tauri-plugin-store` to `~/Library/Application Support/co.rowm.voix/`,
**not** in the repo. Nothing to strip.

**Incantation** (clean `main`, branch-first then push then remove):

```bash
# 0. Pre-flight: must print only the app/ + secrets.yaml.bak lines.
git status --porcelain
# 1. Branch + snapshot the on-disk tree, push immediately for safety.
git switch -c legacy/tauri-clipboard
git add app/
git commit -m "legacy: snapshot pre-pivot Tauri clipboard app at M02e rename"
git push -u origin legacy/tauri-clipboard
# 2. Back to main. app/ is untracked, so `git rm` won't work —
#    add-then-remove makes the deletion visible in main's log.
git switch main
git add -f app/ && git commit -m "archive: snapshot Tauri app/ before removal"
git rm -r app/ && git commit -m "archive: remove Tauri app/ — see legacy/tauri-clipboard"
```

**Verify on legacy branch** the M02e diff is preserved:

```bash
git log legacy/tauri-clipboard -p -- app/src-tauri/src/commands.rs \
  | grep -E "voix\.list_voices|voice_id" | head -5   # ← must match.
```

Implementer reports this grep output in the step-9a closure.

---

## Decision 2 — RN-CLI scaffold

### Command

From `<repo-root>/clients/`:

```bash
mkdir -p clients && cd clients
npx --yes @react-native-community/cli@20.1.3 init voix \
    --version 0.81.6 \
    --skip-install \
    --skip-git-init \
    --pm bun
mv voix app
```

Pins:
- `cli@20.1.3` — current latest in the 20.x line, the version that
  ships with RN 0.81.
- `--version 0.81.6` — exact pin (rn-macos 0.81.7 peer pin is exact).
- `--skip-install` — bun install runs from the workspace root.
- `--skip-git-init` — existing `.git/` upstairs.
- `--pm bun` — sets `package.json` scripts to bun-style invocations.

App name **`voix`** is what the iOS xcodeproj bakes into Info.plist,
schemes, etc. Renaming the iOS target is multi-hour archeology — leave
it. Only rename the directory to `clients/app/` (matches the build-
workflow spec).

### Manual adjustments before first commit

Template generates the standard RN 0.81 tree (`App.tsx`, `Gemfile`,
`_gitignore`, `_eslintrc.js`, `_prettierrc.js`, `_watchmanconfig`,
`app.json`, `babel.config.js`, `index.js`, `jest.config.js`,
`metro.config.js`, `package.json`, `tsconfig.json`, `__tests__/`,
`android/`, `ios/`).

- Rename `_gitignore` → `.gitignore`, `_eslintrc.js` → `.eslintrc.js`,
  `_prettierrc.js` → `.prettierrc.js`, `_watchmanconfig` → `.watchmanconfig`.
- Delete `App.tsx` (replaced by `index.js` rewrite in Decision 7),
  `__tests__/`, `jest.config.js`, `README.md`.
- Keep `android/` untouched — Phase 8 picks it up.
- `clients/app/package.json` — set `name: "voix-app"`, `private: true`,
  add `"@voix/ui": "workspace:*"`, `"@voix/protocol": "workspace:*"` to
  `dependencies`. Template's `react@19.1.4` + `react-native@0.81.6` match
  M19 pins; leave alone.
- `clients/app/tsconfig.json` — extends `@react-native/typescript-config`,
  add `baseUrl: "."` + `paths: { "@voix/ui": ["../../packages/ui/src/index.ts"],
  "@voix/protocol": ["../../packages/protocol/src/index.ts"] }` (Hiro M3:
  leaves declare their own paths; base map removed in M19 fix-pass-3).
- Append to `.gitignore`: `/macos/build/`, `/macos/Pods/`,
  `/macos/*.xcuserstate` (belt-and-braces; template's `**/Pods/` +
  `xcuserdata` globs already cover most).

---

## Decision 3 — macOS target

From `clients/app/` after step 4's `bun install`:

```bash
npx react-native-macos-init@2.1.3 --version 0.81.7
```

Pins: `init@2.1.3` (current latest), `--version 0.81.7` (M19 lock).

Generates: `clients/app/macos/{voix-macOS/, voix-macOSTests/,
voix.xcodeproj/, Podfile}` — AppDelegate.{h,mm}, Info.plist,
MainMenu.xib, Images.xcassets, ViewController.{h,mm},
voix-macOS.entitlements under voix-macOS/. Updates `package.json`
(`react-native-macos: 0.81.7`), creates `react-native.config.js`,
adds `start:macos` script. `voix.xcworkspace/` is created by first
`pod install`, not init.

**Verify**: `grep "platform :macos" clients/app/macos/Podfile` must
print `platform :macos, '11.0'`. If init bumped to 12.0+, sync M19
Decision 5's platform-minimums.

---

## Decision 4 — Workspace dependency wiring

### Root workspaces glob

M19 fix-pass-3 dropped `clients/*` (Hiro H3 — dangling glob). **M20
step 1 re-adds it.** Result:

```json
"workspaces": ["voix-backend", "voix-backend/ui", "packages/*", "clients/*"]
```

### Metro config

`clients/app/metro.config.js`:

```js
const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const defaultConfig = getDefaultConfig(projectRoot);

const config = {
  projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    extraNodeModules: new Proxy(
      {},
      { get: (_t, name) => path.join(projectRoot, "node_modules", name) }
    ),
  },
};

module.exports = mergeConfig(defaultConfig, config);
```

The `extraNodeModules` Proxy is the canonical 2026 monorepo Metro
trick: forces leaf-first resolution, falls back to `nodeModulesPaths`.
Without it, Bun's hoist can produce "two copies of React" at runtime.

### CocoaPods / autolinking

RN autolinking + workspace symlinks: works fine. **Wart**: the macOS
Podfile reads `../node_modules/react-native-macos/...` literally — if
Bun hoists `react-native-macos` above the leaf, `pod install` fails.
**Fix**: declare `react-native-macos` *also* in root `package.json`
`dependencies` (Decision 9 step 3 adds the placeholder). If
`react-native` itself hoists wrong, repeat the trick.

---

## Decision 5 — Carry-forward fixes that ship in M20

| Item | Source | M20? | Why |
|---|---|---|---|
| A. Strip explicit `.ts(x)` extensions | Hiro Delta D | **Ship** | Step 8's native render REQUIRES it; otherwise iOS opens InlineAudioPlayer.tsx (web `<audio>`) and crashes. |
| B. `.native` sibling-exists guard | Hiro M2 | **Ship** | Cheap (15 LOC); prevents quiet regressions when M21+ adds shims. |
| C. HA Add-on UI Docker vendoring | M19 Delta C UI half | **Defer to M20a** | Half-day's work; orthogonal to RN scaffold; HA Add-on dev_mode keeps working. |

### A. Strip explicit `.ts(x)` extensions

Local count: 44 explicit-extension imports across 16 files in
`packages/ui/src/`. Researcher's M20 inventory should confirm; if
count differs by > 2, Implementer pauses + re-checks.

Mechanism: a one-shot Bun script `scripts/strip-ts-extensions.ts`
(written, run, deleted in the same commit). Regex:
`s|(from ["\47]\.[^"\47]+)\.(tsx?)["\47]|\1\2|g`.

Acceptance: `cd voix-backend/ui && bun run build` still produces a
working dist (functionally identical; the JS output should be byte-
identical modulo source-map paths).

### B. `.native` sibling-exists guard

`scripts/check-native-siblings.ts` (~15 LOC). Walks
`packages/ui/src/**/*.native.{ts,tsx}`, asserts a non-`.native`
sibling exists. Wired into a new root `bun run check` aggregator
alongside `check-protocol-sync.sh`. **Not** wired into a pre-commit
hook (husky/lefthook on a bun monorepo is a follow-up); the
Dockerfile's UI build stage runs `bun run check` first.

Acceptance: `bun run check` passes today; `mv packages/ui/src/audio_io/client.ts /tmp/`
then re-run → fails clearly; restore.

### C. HA Add-on UI vendoring — deferred

Right shape is **change the Docker build context to repo root** (M19
Delta C option ii): `voix-backend/config.yaml` `dockerfile:`+`image:`
paths, Dockerfile path rewrites, HAOS rebuild verify. Half-day's work,
orthogonal to RN scaffold; landing inside M20 risks HA Add-on +
RN-foundation at once (workflow rule 6: don't merge across phases).

**File as M20a — HA Add-on Docker context shift.** Add row to
build-workflow Phase 6 table. Until M20a lands, the HA Add-on
**stable-channel** production build is broken; dev_mode (clones repo
inside container) keeps working with graceful fallback. STATE flags it.

---

## Decision 6 — iOS + macOS minimums + dev environment

Platform minimums (unchanged from M19): iOS 15.1 (RN 0.81's
`min_ios_version_supported`), macOS 11.0 (rn-macos-init 2.1.3 Podfile
literal). Tom's env (probed above) meets all RN 0.81 floors except
**watchman** — pre-warn in manual steps. Soft warning: if Tom updates
Xcode beyond 26.3 (26.4 needs macOS 26.2+), bump macOS first.

---

## Decision 7 — Hello-world acceptance

### Native `index.js`

```js
import { AppRegistry } from "react-native";
import { App } from "@voix/ui";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
```

Three lines; same `<App/>` the web target renders.

### The base-URL question

`packages/ui/src/lib/api.ts` calls `fetch("api/voices")` with relative
URLs. On native, relative URLs resolve to nothing useful — the first
Voices-tab render crashes.

**Decision: ship a 30-LOC base-URL platform shim in M20** (not M21).
Hello-world acceptance requires a working base URL; the shim is the
seed for M21's larger surface; forcing it to work now surfaces any
latent Metro-resolution failures while M20 is small.

```ts
// packages/ui/src/lib/apiBase.ts        (web)
export function getApiBase(): string { return ""; }
```

```ts
// packages/ui/src/lib/apiBase.native.ts (native)
// TODO(M21): user-configurable daemon URL in a settings screen.
const DEV_DAEMON_URL = "http://192.168.99.86:8765/";
export function getApiBase(): string { return DEV_DAEMON_URL; }
```

`api.ts` imports `getApiBase` (extensionless — Hiro Delta D's strip is
in effect by the time this lands), prefixes each `fetch(getApiBase() + path, …)`.

### Acceptance signal

iOS sim + macOS app both render sidebar + populated Voices list.
Conversations + Surfaces may warn — M21's job.

---

## Decision 8 — Agent vs Tom

**Implementer ships** (commits, headless): all 10 steps in Decision 9
(scaffold + macOS init + Hiro carry-forwards + apiBase shim + index.js
rewrite + Tauri archive + docs/STATE).

**Tom does manually**: pod install (iOS + macOS), set LAN IP, start
Metro, run-ios + run-macos. Walk-through below.

---

## Tom's manual steps

After M20 commits land. Step 10 copies this verbatim into
`docs/phase-6/m20-manual.md` for in-hand reference.

**0. Pre-flight** — clean status, HEAD = M20 close-out:
```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
which watchman || brew install watchman
```

**1. Refresh workspace install** — pre-empts Hiro H1 stale dirs:
```bash
cd /Users/tom/Projects/voix
rm -rf node_modules clients/app/node_modules \
       voix-backend/node_modules voix-backend/ui/node_modules
bun install
```

**2. Install iOS pods** — expect `NN ≈ 80-95 pods`:
```bash
cd /Users/tom/Projects/voix/clients/app/ios
bundle install && bundle exec pod install
```
Recovery: `hermes-engine` missing → `--repo-update`;
`react-native not found` → add `"react-native": "0.81.6"` to root
`package.json` deps, `bun install`, retry; license → `sudo xcodebuild
-license accept`; `SDK "iphoneos" cannot be located` →
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

**3. Install macOS pods** — `NN ≈ 50-60 pods`; same recovery as iOS:
```bash
cd /Users/tom/Projects/voix/clients/app/macos && bundle exec pod install
```

**4. Set dev daemon URL** — `ifconfig en0 | grep "inet "`, put IP in
`packages/ui/src/lib/apiBase.native.ts`'s `DEV_DAEMON_URL`.

**5. Start Metro + run iOS** — Terminal A:
`cd clients/app && bun run start` (wait for `info Dev server ready`).
Terminal B: `bunx react-native run-ios --simulator="iPhone 16 Pro"`.
Expected (first build ≈ 2-5 min): simulator opens; Metro logs
`Running "voix"`; sidebar with six built-in voices renders.
Recovery: missing sim → `xcrun simctl list devices available`;
bundle fail → restart Metro; voices empty + red overlay → check
daemon (`cd voix-backend && bun src/index.ts` → `listening on :8765`)
+ apiBase IP.

**6. Run macOS** — Terminal A still running, then:
`cd clients/app && bunx react-native run-macos`. Recovery:
no provisioning profile → Xcode → voix-macOS target → Signing &
Capabilities → "Sign to Run Locally"; `react-native-macos not found`
→ Decision 4 hoist fix.

**7. Acceptance** — Both iOS sim and macOS app show sidebar +
populated Voices list. Conversations + Surfaces may warn; M21's job.

---

## Decision 9 — M20 migration order

Each step is a commit. Every step's smoke test must include
(Hiro B2's upgrade):

```bash
bun install                                                  # workspace OK
cd voix-backend/ui && bun run build                          # web UI OK
scripts/check-protocol-sync.sh                               # types sync
cd voix-backend && bun src/index.ts &
sleep 2 && curl -sf http://localhost:8765/health && kill %1  # daemon boots
```

| # | Commit subject | What |
|---|---|---|
| 1 | `monorepo: re-add clients/* glob` | Root `package.json` `workspaces += "clients/*"`. Create `clients/.gitkeep`. |
| 2 | `clients/app: RN-CLI 0.81.6 init` | Run Decision 2 init, mv to app/, rename hidden files, edit package.json + tsconfig + .gitignore, delete unused. |
| 3 | `clients/app: metro config + RN-macos placeholder` | Write `metro.config.js` per Decision 4. Add `"react-native-macos": "0.81.7"` to root `package.json` dependencies (leaf-pinning prep). |
| 4 | `clients/app: add macOS target` | Run rn-macos-init 2.1.3 with `--version 0.81.7`. Update `.gitignore` per Decision 3. Verify Podfile macOS 11.0 line. |
| 5 | `ui: strip explicit .ts(x) extensions (Hiro D)` | Write codemod, run across `packages/ui/src/`, verify diff ≈ 44 lines / 16 files, delete script. |
| 6 | `ui: native-sibling guard (Hiro M2)` | Add `scripts/check-native-siblings.ts`. Wire into new root `bun run check`. |
| 7 | `ui: apiBase platform shim` | Add `lib/apiBase.{ts,native.ts}`; prefix all `fetch` in `api.ts`. |
| 8 | `clients/app: render <App/> from @voix/ui` | Rewrite `index.js`. Verify `bunx tsc -p clients/app/tsconfig.json --noEmit`. |
| 9a | `legacy: snapshot pre-pivot Tauri tree` | On `legacy/tauri-clipboard` only: add+commit+push (Decision 1). |
| 9b | `main: archive Tauri app/` | On main: two commits — add-then-rm (Decision 1). |
| 10 | `docs: M20 close-out + M20a queued` | STATE.md row close, build-workflow.md adds M20a row (Docker context shift), copy Tom's manual steps to `docs/phase-6/m20-manual.md`. |

Steps 1-4 stand up the scaffold without touching the working web
build. Steps 5-7 are Hiro carry-forwards — required for step 8 to
render on native. Step 8 is the hello-world wire. Step 9 archives
Tauri. Step 10 closes the milestone.

---

## Decision 10 — Risk register

| # | Risk | Detect | Mitigate |
|---|---|---|---|
| 1 | **Metro can't resolve `@voix/ui`** from `clients/app/` because Bun's symlink hoist confuses Metro's resolver. | Tom step 5 fails with `Unable to resolve module @voix/ui`. | Decision 4's `extraNodeModules` Proxy is the canonical fix. Escalate: add `resolver.disableHierarchicalLookup: true`. Last resort: move `clients/app/` off bun-workspaces — npm install in the leaf with its own lockfile, nohoisted. ~½ day rework; file as M20.5. |
| 2 | **`pod install` fails** because `react-native-macos` hoisted above `clients/app/node_modules/`. | Tom step 3: `react-native-macos not found`. | Decision 4 pre-empts via root-package.json placeholder. If `react-native` itself also hoists wrong, add it too. |
| 3 | **Xcode SDK toolchain mismatch**. Tom's CLI tools accidentally override Xcode.app's path. | `xcrun: error: SDK "iphoneos" cannot be located`. | Tom step 2 documents `xcode-select -s` recovery. |
| 4 | **`.ts(x)` extension strip breaks Vite web build**. Vite's default resolver may not auto-add `.tsx` in our config. | Step 5 smoke: `cd voix-backend/ui && bun run build` fails with "Cannot find module". | Vite + `@vitejs/plugin-react` defaults `extensions` to `[".mjs",".js",".mts",".ts",".jsx",".tsx",".json"]`. Should work. If not: explicit `resolve.extensions` in `vite.config.ts` with `.tsx` before `.ts`. Audit confirmed no co-located `Foo.ts` + `Foo.tsx` pairs in `packages/ui/src/`. |
| 5 | **Tauri archive loses M02e diffs**. Step 9a skipped or run on wrong branch → on-disk changes go to /dev/null on step 9b's `git rm`. | Verify after step 9a: `git log legacy/tauri-clipboard -- app/src-tauri/src/commands.rs -p | grep voix\.list_voices` must match. | Decision 1's incantation is branch-first / push-second / remove-from-main last. Implementer reports the grep output in step 9a's closure. |

---

## Acceptance criteria

A commit on `main` is M20-complete when **all** hold:

1. `bun install` at repo root succeeds.
2. `cd voix-backend && bun src/index.ts &` reaches `listening on :8765`.
3. `cd voix-backend/ui && bun run build` produces `dist/index.html`.
4. `bun run check` from root (protocol-sync + native-sibling guard).
5. `clients/app/` has the RN-CLI 0.81.6 scaffold + macOS init.
6. `bunx tsc -p clients/app/tsconfig.json --noEmit` passes.
7. `clients/app/index.js` imports `App` from `@voix/ui`.
8. `clients/app/metro.config.js` has the Decision 4 `watchFolders` +
   `extraNodeModules` shape.
9. `clients/app/macos/Podfile` declares `platform :macos, '11.0'`.
10. `packages/ui/src/lib/apiBase{.ts,.native.ts}` exist; `api.ts`
    prefixes every fetch with `getApiBase()`.
11. Zero `from ".*\.ts(x)?"` explicit-extension imports in
    `packages/ui/src/`.
12. `app/` Tauri tree removed from main; `git log --all -- app/` shows
    snapshot + removal pair.
13. `git ls-remote origin legacy/tauri-clipboard` returns a SHA.
14. `docs/STATE.md` marks M20 closed; M20a queued.
15. `docs/phase-6/m20-manual.md` exists with Tom's manual steps.

**Out of scope**: native module installs (audio, clipboard, hotkey,
keyboard) — M21+. Daemon behaviour, ESPHome, HA integration —
untouched. HA Add-on production Docker fix — explicit M20a.
Running iOS/macOS targets — Tom's manual smoke.

---

## Coordinator deltas (added after review)

### Delta A — extension-count discrepancy; verify before stripping

Decision 5A says 44 explicit-extension imports across 16 files in
`packages/ui/src/`. The Researcher's separate inventory (`research-m20.md`
§2) counted 28 across 10 files. Coordinator's direct `grep` confirms
**30 matches**.

That's > 2 difference between Architect and Researcher. Per the
Architect's own rule ("if count differs by > 2, Implementer pauses
+ re-checks"), step 5's first action is:

```bash
grep -rEn "from\s+['\"]\.[^'\"]+\.(ts|tsx)['\"]" packages/ui/src --include="*.ts" --include="*.tsx" | wc -l
```

Use whatever count the actual grep returns as the patch-set size.
Don't trust 44 if the grep returns 30. The codemod runs against the
real set, not the count.

### Delta B — `app/.gitignore` must hold during step 9b

`app/` contains `target/` (Rust build artifacts, can be 100s of MB)
and `node_modules/`. Both are listed in `app/.gitignore`. Before step
9b's `git add -f app/` runs on main, verify the ignores work:

```bash
git -C /Users/tom/Projects/voix check-ignore -v app/target/CACHEDIR.TAG app/node_modules/.package-lock.json
# both must print a matching .gitignore rule
du -sh app/                # for context
git -C /Users/tom/Projects/voix add --dry-run -f app/ | wc -l
# should be ~10-50 files, NOT thousands
```

If the dry-run count is over 200 files, **stop**. `git add -f`
overrides `.gitignore`. Switch to `git add app/` (without -f) on
main; same on the legacy branch. Snapshot then includes only the
intended source files; the build artifacts stay where they belong.

Report the dry-run output verbatim in the step 9b closure.

### Delta C — none

`react-native-macos` placeholder in root `package.json` (step 3)
references a macOS-only package from the root install. That's
intentional and harmless on Linux machines without macOS — npm/bun
install just resolves the package; it doesn't run any native code.
Architect's call stands.
