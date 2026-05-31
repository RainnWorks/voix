# Diego's adversarial review of M20

## Receipts

Files read first-hand:

```
1780228902   358 packages/ui/src/lib/apiBase.ts
1780228907   479 packages/ui/src/lib/apiBase.native.ts
1780228923  5662 packages/ui/src/lib/api.ts
1780229059 10741 packages/ui/src/audio_io/client.ts
1780228803  2160 packages/ui/src/index.ts
1780228718  1234 clients/app/package.json
1780229022   451 clients/app/tsconfig.json
1780228397  1162 clients/app/metro.config.js
1780228713   178 clients/app/react-native.config.js
1780228963   454 clients/app/index.js
1780228698   796 clients/app/macos/Podfile
       —      —  clients/app/ios/Podfile          (template, unmodified)
       —      —  clients/app/app.json
       —      —  clients/app/.gitignore
       —      —  clients/app/.bundle/config + .eslintrc.js + .prettierrc.js + .watchmanconfig + babel.config.js
       —      —  packages/ui/src/conversations/ (incl. InlineAudioPlayer + .native sibling)
       —      —  packages/ui/src/audio_io/ (client.ts + client.native.ts)
       —      —  scripts/check-native-siblings.ts
       —      —  package.json (root)
       —      —  node_modules/.bun/react-native@0.81.6.../react-native/scripts/cocoapods/helpers.rb
       —      —  node_modules/.bun/react-native-macos@0.81.7.../local-cli/{generate-macos.js, generator-macos/index.js, generator-macos/templates/macos/Podfile}
       —      —  node_modules/.bun/@react-native+typescript-config@0.81.6/.../tsconfig.json
WebFetch'd: raw.githubusercontent.com/microsoft/react-native-macos/main/packages/react-native-macos-init/src/cli.ts (canonical 2.1.3 source).
```

Commands run (smoke + adversarial probes):

```
git diff 713e146..HEAD --stat                                   86 files / +4805 -74
git ls-tree -r legacy/tauri-clipboard -- app/ | wc -l           35
git diff legacy/tauri-clipboard 49ad1ab -- app/ --stat          35 / +3813 (mirror) — recovery clean
git ls-remote origin legacy/tauri-clipboard                     2ec5eace... OK
bun install                                                     "Checked 850 installs … (no changes)"
cd voix-backend/ui && bun run build                             326 modules / 576 ms
bun run check                                                   check-native-siblings: OK / check-protocol-sync: OK
bunx tsc -p clients/app/tsconfig.json --noEmit  (from root)     exit 0
cd clients/app && bunx tsc --noEmit             (from leaf)     exit 2  ← see Blocker 1
bunx tsc --version  (root)                                      6.0.3
bunx tsc --version  (clients/app)                               5.9.3   ← root cause
du -sh app/                                                     8.2G    ← see Blocker 2
git status --porcelain                                          ?? app/  ?? docs/phase-6/verify-results/
ifconfig en0 | grep "inet "                                     192.168.99.86  (matches hardcoded URL — luck)
```

## Findings, by severity

### Blockers (must fix before Tom touches it)

**B1. AC6 (`bunx tsc -p clients/app/tsconfig.json --noEmit` exits 0) fails when run from `clients/app/`.**
`tsconfig.json` line 5 sets `"ignoreDeprecations": "6.0"`. TypeScript 5.9.x only accepts `"5.0"` and emits `error TS5103: Invalid value for '--ignoreDeprecations'` (exit code 2). The Implementer's report claims this command exits 0 with no output — that's true only when bunx resolves to the **root** workspace's `typescript@6.0.3`. From inside `clients/app/` (which is what Tom will do — `cd clients/app && bunx tsc --noEmit`), bunx finds the **leaf** `typescript@5.9.3` from `clients/app/node_modules/.bin`, and the build fails.

Reproduction:
```
$ cd /Users/tom/Projects/voix/clients/app && bunx tsc --noEmit
tsconfig.json(5,27): error TS5103: Invalid value for '--ignoreDeprecations'.
exit=2
```

Fix: either (a) change `"ignoreDeprecations": "6.0"` → `"5.0"` (TS 5.x's supported value; the option silences the same deprecation warnings), or (b) drop `ignoreDeprecations` entirely and let `baseUrl` print its warning. Option (a) is one character and keeps the diagnostic silenced under both 5.9 and 6.0.

This is AC6 directly. **It does not pass as the report claims** under the natural Tom-side invocation.

**B2. The Tauri `app/` tree is still on disk (8.2 GB).**
`git rm -r app/` only removes **tracked** files. Because `app/.gitignore` excludes `node_modules/` and `target/`, those subtrees were ignored on the way in (per Delta B's deliberate `-f` drop) and therefore stayed on disk on the way out. Current state:
```
$ du -sh app/                  8.2G    app/
$ du -sh app/{node_modules,src-tauri}
14M   app/node_modules
8.2G  app/src-tauri        ← the Rust target/ tree, ignored, never tracked, never removed
$ git status --porcelain
?? app/
```
The brief and `m20-manual.md` step 0 say "clean status, HEAD = M20 close-out" — but `app/` is untracked junk that `git status` will keep flagging. Tom will either spend 5 min trying to understand what `?? app/` means, or worse, treat it as "still my Tauri checkout" and try to rebuild from it. The legacy snapshot's whole point is that this code lives on `legacy/tauri-clipboard`; nothing on disk needs to survive on `main`.

Fix: add a step 9c (or extend step 9b) that runs `rm -rf app/` after the `git rm -r app/` commit. **Document in `m20-manual.md`** so Tom does it himself if he's running this on a worktree that didn't get cleaned.

### High (fix this milestone or document why not)

**H1. The Implementer's report misattributes who writes `react-native.config.js` and `start:macos`.**
The report (Delta 1, step 4) says: "`react-native.config.js` written (init normally writes it; generator alone doesn't); `package.json` scripts: `macos` + `start:macos`." I read the canonical `react-native-macos-init/src/cli.ts` (v main, which is what 2.1.3 ships as the publishable artifact). It does **NOT** write `react-native.config.js` and does **NOT** add any `start:macos` or `macos` script — its sum total of side effects beyond the generator is `npm/yarn add react-native-macos@<version>`. The added scripts are pure Implementer invention, not "what init would have produced". Functionally inert here (RN-CLI defaults to `ios/`+`macos/`+`android/` source dirs without a config) but the rationale in the report and `m20-manual.md` is wrong, which matters if a future contributor reads it and assumes parity with init.

Fix: rewrite Delta 1 in `m20-manual.md` and the step 4 commit msg to say "we authored these to match what RN-CLI's `init` (the iOS-side scaffolder) writes, since `rn-macos-init` does not write a config or scripts."

**H2. `start:macos` uses port 8082 but no run-macos command in the manual targets it.**
`clients/app/package.json`:
```
"start:macos": "react-native start --use-port 8082"
"macos": "react-native run-macos --scheme voix-macOS"
```
`react-native run-macos` (with no flag) connects Metro at the default port (8081). So `start:macos` is unreachable from `bun run macos`. The manual's step 5 says `cd clients/app && bun run start` (port 8081) and step 6 says `bunx react-native run-macos` — that pair works fine because both use the default. **The `start:macos` script is dead** and will mislead a future contributor into running it. Drop it, or change `macos` to `react-native run-macos --scheme voix-macOS --port 8082` and document the rationale.

**H3. `@react-native-community/cli` is pinned at `20.0.0`, not the brief's `20.1.3`.**
`clients/app/package.json` (template-generated) has:
```
"@react-native-community/cli": "20.0.0"
"@react-native-community/cli-platform-android": "20.0.0"
"@react-native-community/cli-platform-ios": "20.0.0"
```
The brief / Decision 2 specified `cli@20.1.3` as the **invocation** version, but the resulting template embedded `20.0.0` as the resolved devDeps. The npm-side init runs `cli@20.1.3` for the scaffold step, but the **template** the RN 0.81.6 release pins inside it is `20.0.0`. Not strictly a bug (20.0.0 ships with RN 0.81 stably), but the report's claim of "cli@20.1.3" is misleading about what got committed. Bump explicitly in `clients/app/package.json` if you want the .1 patch, or note in the m20-manual that the leaf cli pin lags the init wrapper.

### Medium (fix-or-defer)

**M1. `clients/app/tsconfig.json` overrides `lib` to include `DOM` + `DOM.Iterable`.**
Reasoning is documented (`packages/ui/src/audio_io/client.ts` walks WebSocket / AudioContext / MediaStream types). But the side effect: every web-only API in `packages/ui/src/` now typechecks against the RN app's tsconfig as if it existed on iOS, masking a real class of bug. The runtime fix is the `.native.ts` siblings (Metro's platform resolution swaps them at bundle time), and those exist for `client`, `InlineAudioPlayer`, and `apiBase`. But `client.ts:248`'s `pcm.buffer as ArrayBuffer` cast is the canary: the only reason it was needed is that `lib.dom.d.ts`'s WebSocket types are loaded under this tsconfig and reject the ArrayBufferLike. **Verified the cast itself is benign** — `floatToPcm16` always returns an `Int16Array` whose `buffer` is a fresh non-shared `ArrayBuffer`, never a `SharedArrayBuffer`. No runtime bug. But it's a code smell pointing at the tsconfig: a future contributor who adds a new web-only API in `packages/ui/src/` will get green typecheck and a runtime crash on iOS. M21 should split the typecheck (RN tsconfig excludes web-only sources OR uses references) and remove this cast.

**M2. macOS Podfile floor 14.0 is fine, but the brief's M19 floor of 11.0 needs explicit waiver in `docs/STATE.md`.**
The Implementer surfaced this delta. AC9 is **failing as written** (`platform :macos, '11.0'`). The report says "operationally irrelevant on Tom's Mac" which is true, but if a contributor on macOS 13 picks this up in a year, they'll be silently locked out of Apple's `pod install`. STATE.md and `m20-manual.md` should make this an explicit M20 deviation, not a footnote. (Currently `m20-manual.md` does call it out — verify the bullet stays through future doc edits.)

**M3. Hardcoded LAN URL `http://192.168.99.86:8765/` happens to match `en0` today.**
Pure luck — `ifconfig en0 | grep "inet "` prints exactly `192.168.99.86` on Tom's box right now. Manual step 4 says "put your IP in," which works because Tom's IP matches the pre-filled placeholder. But:
- If Tom's DHCP rolls the IP overnight, the iOS app crashes on first fetch with no useful error (Network request failed) — not the "voices empty + red overlay" recovery the manual documents.
- If anyone else clones this for testing, they will get a placeholder pre-filled with a stranger's LAN, and step 4's `ifconfig` ritual won't actually correct it if they skim.

Fix: either (a) make the URL fall back to localhost / read an env var on M20 (`process.env.VOIX_DAEMON_URL ?? "http://localhost:8765/"`) — cheap shim. Or (b) make the placeholder visibly broken so step 4 is mandatory (`const DEV_DAEMON_URL = "http://CHANGE_ME_TO_YOUR_LAN_IP:8765/"`). Today's value is a silent-fail trap for anyone but Tom-today.

**M4. The macOS Podfile uses `get_default_flags()` which RN 0.81's `react_native_pods.rb` flags as deprecated.**
```
def get_default_flags()
  warn 'get_default_flags is deprecated. Please remove the keys from the `use_react_native!` function'
```
`pod install` will print this warning every run. Cosmetic, not a blocker, but it adds noise to Tom's first pod install — easy to miss the **real** errors in the wall of yellow. Track for M21 cleanup; not worth touching the generated Podfile inside M20.

### Low (nits)

**L1.** `clients/app/.bundle/config` is committed (from RN template — Ruby bundler config). Trivially harmless.

**L2.** `react-native.config.js` declares the **default** values for `ios.sourceDir`, `macos.sourceDir`, `android.sourceDir`. RN-CLI infers these without the file. Either delete it (no behaviour change) or add a comment explaining it's a placeholder for M21 native module registration.

**L3.** The Implementer's report (step 5) claims `voix-backend/ui bun run build` returned `325 modules / 554 ms`. Today's run returned `326 modules / 576 ms`. The 326 vs 325 isn't suspicious (one extra import got resolved in the apiBase shim path), but the report should re-verify after step 7 — it currently shows 325 across all steps, which means either nothing changed or the count wasn't re-measured.

**L4.** The macOS target's `AppDelegate.{h,mm}` is Objective-C++ while iOS uses `AppDelegate.swift`. This is rn-macos-init 2.1.3's template, not the Implementer's call. Cross-platform Swift would be cleaner (M21+).

**L5.** `package.json` root has `"dependencies": { "react-native-macos": "0.81.7" }` — declared at root, not at `clients/app/`. The brief's Decision 4 calls this "hoist-pinning prep" but the **macOS Podfile** uses `Pathname.parent until ...` to walk up looking for `node_modules/react-native-macos`. In practice it stops at `clients/app/node_modules/react-native-macos` (the symlink to root). The root declaration is still serving a purpose: it ensures bun installs `react-native-macos` even though only the leaf consumes it (the dep would still work if it were only at the leaf, but bun could in theory ignore it). Leave alone; document as "belt-and-braces".

## The Tom-day prediction

**Tom's first `bunx tsc -p clients/app/tsconfig.json --noEmit` from inside `clients/app/` will print `error TS5103: Invalid value for '--ignoreDeprecations'.` and exit 2.**

This will happen because:
1. Tom's natural debugging flow when something else fails is `cd clients/app && bunx tsc` — that's where Metro/RN tooling lives.
2. `bunx` walks up from `cwd` to find `tsc`, and stops at `clients/app/node_modules/.bin/tsc`, which resolves to `typescript@5.9.3` (the RN 0.81 template pin).
3. TS 5.9.x rejects `ignoreDeprecations: "6.0"` with exit 2.

The Implementer's report shows this exiting 0 — that's because they ran it from the repo root, where `bunx` picks up `typescript@6.0.3` (the workspace root's higher pin). Both runs are "valid" but they answer different questions: the report's run answers "does the workspace-root TS accept this config?" and the natural run answers "does the leaf's TS accept this config?". Tom and CI will hit the leaf path, so AC6 is effectively failing.

Falsification: run `cd /Users/tom/Projects/voix/clients/app && bunx tsc --noEmit; echo "exit=$?"`. If exit is 0, this prediction is wrong. If exit is 2 with the TS5103 message, it's right.

## Architectural pushback

**The Tauri `app/` snapshot procedure was almost-but-not-quite reversible, and the brief's diagnostic for "did it work" doesn't catch the failure mode.**

Decision 1's incantation runs:
```
git rm -r app/ && git commit -m "archive: remove Tauri app/ ..."
```
Then AC12 checks `git log --all -- app/` shows the snapshot+removal pair. That check **passes** even when 8.2 GB of `target/` and `node_modules/` is still squatting in `app/` on disk. Because they were `.gitignore`'d, git never tracked them, so `git rm -r` doesn't touch them, so the on-disk tree survives with `?? app/` for as long as it takes Tom to `rm -rf app/` manually. The brief's mental model is "archive happens by committing then removing"; the reality is "you also have to scrub the working tree because git's `.gitignore` is one-way."

This is a generic pattern that will keep biting us: any directory with substantial gitignored build artefacts requires a TWO-STEP archive — `git rm -r` for the tracked content, then `rm -rf` for the rest of the directory. Add this as a rule to `docs/agent-team-workflow.md`'s archive-procedure section so the next milestone that retires a build target doesn't repeat it.

Less importantly: the `git switch main` step the Implementer hit (Delta 4) — where switching from `legacy/tauri-clipboard` to `main` wiped 35 source files from disk — is a known git footgun. The brief assumed the working tree state survives the switch, but git's behaviour is "remove files tracked on the source branch that are untracked on the destination." This is one place where a `git stash --include-untracked` before the switch, or a `git worktree add` instead of `git switch`, would have been bulletproof. Worth a sentence in the workflow doc; the recovery (`git checkout legacy/tauri-clipboard -- app/`) was clean, but the next contributor who hits this with a dirty working tree may not be so lucky.
