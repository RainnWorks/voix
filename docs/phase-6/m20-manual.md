# M20 — Tom's manual smoke (after the Implementer commits land)

Verbatim from `docs/phase-6/architecture-m20.md` "Tom's manual
steps". Run from `/Users/tom/Projects/voix/`.

**0. Pre-flight** — clean status, HEAD = M20 close-out:
```bash
cd /Users/tom/Projects/voix && git status && git log -1 --oneline
which watchman || brew install watchman
```
Note: `app/` has already been removed; if you see `?? app/`, run
`rm -rf app/` — the snapshot lives on `legacy/tauri-clipboard`.

**1. Refresh workspace install** — pre-empts Hiro H1 stale dirs:
```bash
cd /Users/tom/Projects/voix
rm -rf node_modules clients/app/node_modules \
       voix-backend/node_modules voix-backend/ui/node_modules
bun install
```

**2. Install iOS pods** — expect `NN ≈ 80-95 pods`:
```bash
# NOTE: Gemfile lives at clients/app/, NOT clients/app/ios/. Run
# `bundle install` from clients/app/, then cd into ios/ for pod install.
cd /Users/tom/Projects/voix/clients/app && bundle install
cd ios && bundle exec pod install
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
`cd clients/app && bun run start` (wait for `Welcome to Metro` then
`Dev server ready`; Metro v0.83.7 prints "Welcome to Metro" before
the ready signal — both lines appear).
Terminal B: `bunx react-native run-ios --simulator="iPhone 16 Pro"`.
Expected (first build ≈ 2-5 min, smoke confirmed 97s): simulator
opens; Metro logs `Running "voix"`; sidebar with six built-in voices
renders.
Recovery: missing sim → `xcrun simctl list devices available`;
bundle fail → restart Metro; voices empty + red overlay → check
daemon (`cd voix-backend && bun src/index.ts` → `listening on :8765`)
+ apiBase IP.

**6. Run macOS** — Terminal A still running, then:
`cd clients/app && bunx react-native run-macos`. Recovery:
no provisioning profile → Xcode → voix-macOS target → Signing &
Capabilities → "Sign to Run Locally"; `react-native-macos not found`
→ Decision 4 hoist fix; **`macOS project folder not found`** →
`bun install` (the `cli-platform-apple` devDep added in M20
fix-pass-3 surfaces it correctly under bun workspaces).

**6a. Known M20 limitation — macOS hot-reload** — `bun run start`
launches Metro on port 8081 (iOS-default). `start:macos` script is
written for port 8082 but neither the macOS scheme nor the bundle
URL is plumbed to use it; macOS runs off its build-time bundle and
won't hot-reload. To get hot-reload on macOS during M21+ work, start
a second Metro: `cd clients/app && bun run start:macos` in a third
terminal, and edit the macOS scheme's `RCT_METRO_PORT` env var to
8082. Fix queued — see `docs/build-workflow.md` M21 carry-forwards.

**7. Acceptance** — Both iOS sim and macOS app show sidebar +
populated Voices list. Conversations + Surfaces may warn; M21's job.

---

## Deltas the Implementer surfaced (read before step 0)

1. **macOS Podfile pins `platform :macos, '14.0'`**, not `'11.0'`.
   That's the rn-macos-init 2.1.3 template default for RN 0.81.x;
   Tom's Mac runs macOS 26.3, so the 14.0 floor is operationally
   irrelevant. No action needed.
2. **`rn-macos-init` was bypassed**. The wrapper trips ENOWORKSPACES
   inside a bun-workspaces tree. Step 4 of the Implementer's commit
   called the underlying generator directly
   (`node_modules/react-native-macos/local-cli/generate-macos.js`);
   functional output is identical.
3. **`react-native-macos@0.81.7` is pinned in TWO places** — root
   `package.json` AND `clients/app/package.json`. The root pin
   prevents Bun's hoist from placing it above `clients/app/`
   (Decision 4); the leaf pin keeps `rn-macos-init`'s version check
   passing for future maintenance. Both are needed; don't drop
   either.
4. **packages/ui/src/audio_io/client.ts:248** got a `ws.send(pcm.buffer
   as ArrayBuffer)` cast for TS 5.x strict-DOM lib. Runtime payload
   is always a fresh non-shared buffer; cast is type-only.
