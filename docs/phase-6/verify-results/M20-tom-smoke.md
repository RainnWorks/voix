# M20 Tom-smoke (run by claude on Tom's behalf)
Status: PARTIAL

Both apps built and launched successfully. iOS rendered the expected UI
(sidebar + Voices list populated from the daemon). macOS app process is
confirmed running but visual verification was blocked by the Mac being at
the login window over SSH-equivalent access; Tom needs to unlock the
screen to confirm the macOS UI. One non-blocking discovery: the
react-native-macos platform autodetect is broken because
`@react-native-community/cli-platform-apple` is not surfaced into
`clients/app/node_modules/` — see "Surprises beyond the manual" below.

## Steps

### 0. Pre-flight
- `git status && git log -1 --oneline` — instant, exit 0.
  - Branch `main`, HEAD `535a3c7 clients/app(M20 fix-pass-2): pin
    typescript@5.9.3 at workspace root`.
  - Untracked: M19 and M20 verify-results report files (expected). No
    committed working-tree changes.
- `which watchman` — **MISSING** (as the brief warned).
- `brew install watchman` — **17s**, exit 0, no sudo prompt.
  - Installed deps: snappy, folly, fizz, wangle, xxhash, fbthrift, fb303,
    edencommon, watchman 2026.05.25.00.

### 1. Workspace refresh
- `rm -rf ... && bun install` — **8s**, exit 0.
- Output tail:
  ```
  + typescript@5.9.3
  + react-native-macos@0.81.7
  1684 packages installed [1000.00ms]
  ```
- Both `clients/app/node_modules/react-native` and
  `react-native-macos` resolved as workspace symlinks.

### 2. iOS pods
- The manual says run `bundle install` from `clients/app/ios`. The
  Gemfile actually lives at `clients/app/Gemfile` (one level up). I ran
  `bundle install` from `clients/app` instead.
- `bundle install` — **6s**, exit 0. 45 gems including cocoapods 1.15.2.
- `bundle exec pod install` from `clients/app/ios` — **30s**, exit 0.
  73 pods installed from 74 dependencies. Hermes 0.81.6 cached.
- Output tail:
  ```
  Pod install took 28 [s] to run
  Integrating client project
  [!] Please close any current Xcode sessions and use `voix.xcworkspace`
  Pod installation complete! There are 74 dependencies from the Podfile
  and 73 total pods installed.
  ```
- No recovery actions needed; pods were cached locally.

### 3. macOS pods
- `bundle exec pod install` from `clients/app/macos` — **23s**, exit 0.
  73 pods installed from 74 dependencies. RN-macOS pods at 0.81.7
  (vs RN at 0.81.6 in iOS).
- No recovery actions needed.

### 4. Dev daemon URL
- Skipped per brief. Verified `DEV_DAEMON_URL = "http://192.168.99.86:8765/"`
  in `packages/ui/src/lib/apiBase.native.ts` and `ifconfig en0` shows
  `192.168.99.86`.

### 5a. Metro start
- `cd clients/app && nohup bun run start > /tmp/voix-metro.log 2>&1 &`
- **Ready in 2s.**
- Banner present:
  ```
  Welcome to React Native v0.81
  Starting dev server on http://localhost:8081
  Welcome to Metro v0.83.7
  ```
- Note: `"Dev server ready"` (the literal string the manual suggested
  grepping for) does not appear in the v0.81 output. I used the
  `Welcome to Metro` / `Loading dependency graph, done` patterns and
  the start banner instead.

### 5b. Daemon boot
- `cd voix-backend && nohup bun src/index.ts > /tmp/voix-daemon.log 2>&1 &`
- **Ready in ~3s** (PID written to /tmp/voix-daemon.pid).
- Confirmation line present:
  ```
  voix-backend: listening on :8765 (log_level=info)
  ```
- Loaded: 6 modes, 73 history entries, 2 device records. HA MCP source
  not configured (expected — no ha_url + ha_token in env).

### 5c. iOS run + screenshot
- Available Pro sims (output of `xcrun simctl list devices available`):
  iPhone 16 Pro, 16 Pro Max, 17 Pro, 17 Pro Max. Used `iPhone 16 Pro`.
- `bunx react-native run-ios --simulator="iPhone 16 Pro"` — **97s**,
  exit 0.
- Final lines:
  ```
  ▸ Build Succeeded
  success Successfully built the app
  info Installing "/Users/tom/Library/Developer/Xcode/DerivedData/.../voix.app"
  info Launching "org.reactjs.native.example.voix"
  success Successfully launched the app
  ```
- After 12s sleep: `xcrun simctl io booted screenshot` succeeded.
- Screenshot: `/tmp/voix-smoke-screenshots/ios-after-boot.png` (256KB).

### 6. macOS run + screenshot
- First attempt `bunx react-native run-macos` (from `clients/app`) —
  **exit 1 in 1s**:
  ```
  error macOS project folder not found. Are you sure this is a React Native project?.
  ```
- Same error from `bun run macos` and `bunx react-native-macos
  run-macos --scheme voix-macOS`.
- Root cause (after digging): `react-native-macos/react-native.config.js`
  registers the `macos` platform only if it can
  `require.resolve('@react-native-community/cli-platform-apple',
  {paths: [process.cwd()]})`. That package is not surfaced in
  `clients/app/node_modules/@react-native-community/` (only
  `cli`, `cli-platform-android`, `cli-platform-ios` are). The package
  exists in bun's content-addressed store at
  `/Users/tom/Projects/voix/node_modules/.bun/@react-native-community+cli-platform-apple@20.0.0/...`
  but bun did not expose it at top-level.
- **Workaround applied (runtime only, NOT committed)**: symlinked
  ```
  /Users/tom/Projects/voix/clients/app/node_modules/@react-native-community/cli-platform-apple
   -> /Users/tom/Projects/voix/node_modules/.bun/@react-native-community+cli-platform-apple@20.0.0/node_modules/@react-native-community/cli-platform-apple
  ```
- After the symlink: `bunx react-native config` shows `platforms.macos`
  registered and `project.macos.sourceDir = clients/app/macos`.
- `bunx react-native run-macos --scheme voix-macOS` — **71s**, exit 0.
  ```
  ▸ Build Succeeded
  info Launching app "org.reactjs.native.voix" from
    ".../Build/Products/Debug/voix.app"
  success Successfully launched the app
  ```
- `lsappinfo list | grep voix` shows the app registered:
  ```
  "voix" ASN:0x0-0x11ec1eb:
    bundleID="org.reactjs.native.voix"
  ```
- `ps aux` confirmed the macOS voix process running at PID 58092.
- `screencapture -x /tmp/voix-smoke-screenshots/macos-after-boot.png`
  succeeded but **the screenshot shows the macOS login window** (Sun
  31 May 15:02, "Thomas Nairn" lock screen). The voix.app window is
  not visible because the Mac is locked / no GUI session is active.
  This is a hard limit of headless screenshot capture; needs Tom to
  unlock and re-screenshot.

### 7. Teardown
- `kill $(cat /tmp/voix-metro.pid)` and `kill $(cat /tmp/voix-daemon.pid)`
  both clean (SIGTERM accepted). Post-kill `pgrep -fl` for both
  patterns returned nothing.
- The voix iOS app process and the voix macOS app process **were
  left running** — the brief's teardown only kills Metro and the
  daemon. Tom can close them via the normal app quit flow.

## Visual verification

- **iOS screenshot at: `/tmp/voix-smoke-screenshots/ios-after-boot.png`**
  - Sidebar (left): app title "Voix /vva/" top-left, "New conversation"
    button with `⌘N` accelerator, "TODAY" section heading, one history
    entry "Kitchen quick chat • 2 min ago • Realtime". Bottom toolbar:
    "Voices 6" (highlighted, blue chip) and "Surfaces".
  - Main pane (right): "Voices" header, status pill "NOW puck-1 -
    Realtime", and a card list of 6 voice modes:
    - Realtime (showing ACTIVE chip in blue, "Real-time back an[d
      forth]…", subtitle truncated)
    - Dictation — orange dot — "Raw transcription[…]processing. Use
      v[…]" — Activate button
    - Message — green dot — "Clean up casual / chat apps like Sla[ck]"
      — Activate
    - Email — blue dot — "Format as profe[ssional] for mail apps an[d]"
      — Activate
    - Note — purple dot — "Format as structu[red] markdown. Use fo[r]"
      — Activate
    - Code — blue dot — "Format speech a[s] coding assistants" — Activate
  - **Daemon connection works**: the Voices list populated from the
    backend (the daemon log shows "voices: loaded 6 modes" — exactly 6
    are rendered) and "puck-1 - Realtime" appears in the NOW pill,
    matching the 2 device records reported by the daemon. No red error
    overlay; UI is clean and rendered correctly.

- **macOS screenshot at: `/tmp/voix-smoke-screenshots/macos-after-boot.png`**
  - Shows the macOS login window: large "15:02" clock, "Sun 31 May",
    user avatar labeled "Thomas Nairn", a "Login items" notification
    bubble in the top-right. **No voix UI visible from this
    capture vantage**.
  - The voix.app process IS running (verified via `ps aux` and
    `lsappinfo`); its window is just behind the login screen.

## What needed Tom's hands

1. **Visual verification of the macOS app.** Build + launch are
   confirmed (exit 0, ps aux, lsappinfo). What's behind the login
   window I cannot tell. Tom: unlock the Mac and confirm voix-macOS
   renders the expected sidebar + Voices UI; bring it forward with
   `open -a voix` if needed.
2. **(Nothing else)** No sudo prompts, no Xcode license prompts, no
   SDK selection prompts, no provisioning prompts. All builds went
   through with the existing developer setup.

## Surprises beyond the manual

1. **`react-native-macos` platform autodetect is broken under bun
   workspaces.** `clients/app/node_modules/@react-native-community/`
   is missing `cli-platform-apple`, and rn-macos's `react-native.config.js`
   silently skips registering the `macos` platform when that resolve
   fails. Symptom: `bunx react-native run-macos` exits 1 with
   `error macOS project folder not found. Are you sure this is a React
   Native project?` — looks like the project is mis-set-up, but it's
   actually the platform plugin that didn't load.
   - This is reproducible on a fresh `bun install`; not specific to
     this run.
   - Workaround for this smoke: manual symlink (see Step 6, not
     committed).
   - Suggested fix for M21 (or sooner): either add
     `@react-native-community/cli-platform-apple` as an explicit
     dependency in `clients/app/package.json` so bun hoists it, or
     adjust the workspace install to surface `cli-platform-apple`
     into `clients/app/node_modules`.
   - The same code path works for `cli-platform-ios` and
     `cli-platform-android` because those ARE listed as devDependencies
     in `clients/app/package.json`.

2. **Gemfile location mismatch with manual.** Manual says
   `cd clients/app/ios && bundle install`, but the Gemfile is at
   `clients/app/Gemfile`. `bundle install` from `clients/app/ios` would
   walk up and find it, but worth updating the manual to be precise.

3. **`"Dev server ready"` is not in Metro v0.83.7 output.** The manual
   suggests polling `grep -q "Dev server ready"`. The actual ready
   signal is `"Welcome to Metro v0.83.7"` (visible within ~2s).

4. **Metro bundling error during macOS run, but app launched anyway.**
   While `react-native run-macos` was building, Metro (started by the
   iOS-default `bun run start` on port 8081) logged a hard error:
   ```
   ERROR Error: Unable to resolve module
   ../../src/private/devsupport/rndevtools/ReactDevToolsSettingsManager
   from .../react-native@0.81.6/.../Libraries/Core/setUpReactDevTools.js
   ```
   when something asked it to bundle for the `.macos` platform.
   - Likely cause: macOS run should use `bun run start:macos`
     (port 8082) — which is the script `clients/app/package.json`
     already defines — but the manual doesn't mention starting a
     second Metro. The macOS app likely ran off its build-time
     bundled JS rather than a live Metro bundle.
   - This means dev-time live-reload for macOS may be broken or at
     least confusing. Worth a follow-up before M21 if hot-reload on
     macOS is wanted.

5. **iOS deprecation notice from pod install (not blocking).**
   Both pod-install runs printed:
   ```
   ==================== DEPRECATION NOTICE =====================
   Calling `pod install` directly is deprecated in React Native
   because we are moving away from Cocoapods toward alternative
   solutions to build the project.
   =============================================================
   ```
   FYI for M21+.

## Artifacts

- Screenshot dir: `/tmp/voix-smoke-screenshots/`
  - `ios-after-boot.png` (256KB, 1206x2622 effective iPhone 16 Pro)
  - `macos-after-boot.png` (642KB, 1920x1080 — login window, not voix)
- Log files (preserved post-smoke):
  - `/tmp/voix-metro.log`
  - `/tmp/voix-daemon.log`
  - `/tmp/voix-ios-run.log`
  - `/tmp/voix-macos-run.log`
  - `/tmp/voix-podinstall-ios.log`
  - `/tmp/voix-podinstall-macos.log`
- Runtime-only workaround (NOT committed, can be cleaned by another
  `bun install` if Tom prefers):
  - `clients/app/node_modules/@react-native-community/cli-platform-apple`
    (symlink into the bun store).
