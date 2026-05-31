# M20 Research Report: RN-CLI Scaffold + Archive Tauri Relic

**Snapshot**: 2026-05-31. Compiled by the M20 Researcher (Explore
subagent, read-only — coordinator transcribed this report to disk
since Explore can't Write).

---

## Receipts

| Item | Path / URL | Verified |
|---|---|---|
| app/ Tauri relic | `/Users/tom/Projects/voix/app/` | `git ls-files app/` returns empty (untracked) |
| Rust commands.rs | `/Users/tom/Projects/voix/app/src-tauri/src/commands.rs` | 314 LOC; M02b voice rename visible |
| Rust tray.rs | `/Users/tom/Projects/voix/app/src-tauri/src/tray.rs` | 122 LOC; cycle_voice canonical |
| JS settings.js | `/Users/tom/Projects/voix/app/src/settings.js` | 968 LOC; mode→voice PALETTE rename |
| packages/ui imports | `/Users/tom/Projects/voix/packages/ui/src/` | 28 relative imports with .tsx/.ts |
| Dockerfile | `/Users/tom/Projects/voix/voix-backend/Dockerfile` | UI workspace dep caveat documented |
| run.sh | `/Users/tom/Projects/voix/voix-backend/run.sh` | dev_mode workspace path at line 74 |
| config.yaml | `/Users/tom/Projects/voix/voix-backend/config.yaml` | v0.1.0 |
| ui/package.json | `/Users/tom/Projects/voix/voix-backend/ui/package.json` | React 19.1.4, RN 0.81.6, workspace:* on @voix/ui + @voix/protocol |
| packages/ui/package.json | `/Users/tom/Projects/voix/packages/ui/package.json` | @voix/protocol workspace:*, peerDep RN 0.81.6 |
| RN-macOS releases | https://github.com/microsoft/react-native-macos/releases | Fetched 2026-05-31 14:02 UTC |
| RN getting-started | https://reactnative.dev/docs/getting-started-without-a-framework | Fetched via Context7 |
| Metro config docs | https://github.com/facebook/metro/blob/main/docs/Configuration.md | Fetched via Context7 |

---

## 1. app/ Tauri relic inventory

Status: **entirely untracked**. `git ls-files app/` is empty.

| Category | Files | LOC / Bytes |
|---|---|---|
| Rust src | 8 | 1437 LOC (lib.rs, main.rs, commands.rs, tray.rs, settings.rs, ha_client.rs, paste.rs, menu.rs) |
| Rust config | 3 | Cargo.toml + Cargo.lock + tauri.conf.json + build.rs |
| JS src | 4 | 1008 LOC (settings.js, ha.js, tauri-shim.js, index.html) |
| JS config | 2 | package.json + package-lock.json |
| Tauri capabilities | 1 | default.json (JSON ACL) |
| Gen schema | 4 | acl-manifests / capabilities / desktop-schema / macOS-schema |
| Icons/assets | 10 | .icns, .png tray icons + 6 SVG marks |
| Docs | 1 | README.md |
| Ignore | 1 | .gitignore |
| Build artifacts | (large) | target/, node_modules/ |

Tracked-source total: ~3.7 KB config + 2.4 KB code + 48 KB assets
(excluding target/ + node_modules/).

### Secret / config-bearing files (flagged)

| File | Risk | Why |
|---|---|---|
| `commands.rs:32-42` | MEDIUM | `update_settings` persists HA URL + token; tokens not hardcoded but flow visible |
| `tray.rs:105-107` | MEDIUM | Constructs HA service URL + bearer call; URL + token from settings (no hardcoded secret) |
| `settings.js` (whole) | HIGH | Renders form for HA_URL, HA_TOKEN, API keys, WS token. Form code visible (not secrets) |
| `ha_client.rs:30-80` | MEDIUM | WebSocket client; reads URL + token from AppState; auth flow visible |

**Verdict**: no hardcoded secrets. The risk is architectural shape
inference, acceptable for public archive. Flag in legacy branch
README.

### M02e rename diffs — must preserve before archive

1. `commands.rs` lines 103-104, 17-24: `HaMode` struct (should be
   `HaVoice`); comment "voix.cycle_voice (M02b canonical)".
2. `tray.rs` lines 32, 57, 103: "Cycle Mode" → "Cycle Voice" menu
   items; "voix.cycle_voice" service ref.
3. `settings.js` (largest surface): `modeCache`, `editingModeId`,
   the entire "modes" view name. All M02e PALETTE renames.

These were never committed to main. Architect must preserve them in
the legacy branch.

---

## 2. packages/ui internal import patterns — 28/28 carry explicit extensions

Every relative import inside `packages/ui/src/**/*.{ts,tsx}` uses an
explicit `.ts` or `.tsx` extension. Metro's `.native.ts` resolution
only fires on extensionless imports — these block native target
builds.

| File | Imports with extension |
|---|---|
| App.tsx | 6 (`./components/AppShell.tsx`, etc.) |
| components/AppShell.tsx | 3 |
| components/Puck.tsx | 1 |
| components/Wordmark.tsx | 2 |
| voices/VoiceEditor.tsx | 2 |
| voices/VoiceList.tsx | 3 |
| conversations/ConversationList.tsx | 4 |
| conversations/ConversationDetail.tsx | 3 |
| conversations/TalkButton.tsx | 2 (incl. `../audio_io/client.ts` — critical) |
| surfaces/SurfaceList.tsx | 2 |

Surgical patch: strip every `.ts` / `.tsx` from relative imports.
Mechanical change; one commit.

---

## 3. HA Add-on Docker UI install — vendoring needs

Dockerfile builds from `voix-backend/` context. `cd ui && bun install`
can't resolve UI's `workspace:*` deps because `packages/` is outside
the build context.

### UI deps (voix-backend/ui/package.json)

`@voix/protocol`, `@voix/ui` — both `workspace:*`. Plus React 19.1.4,
RN 0.81.6, RN-Web ^0.21.0, TS 5.9.3, Vite ^6.0.5, vite-tsconfig-paths
^5.1.4.

### Current dev_mode workaround (run.sh:74)

`bun install --silent` from `/data/voix-dev` (the cloned repo root).
Works because dev_mode clones the full repo. Production Add-on Store
install does NOT clone repo — only the addon dir.

### M20 vendoring step needs

```dockerfile
COPY packages/ui/ ./packages/ui/
COPY packages/protocol/ ./packages/protocol/
COPY bun.lock package.json ./
RUN bun install --production  # from repo root
RUN cd voix-backend/ui && bun install && bun run build
```

---

## 4. react-native-macos current state

**Latest stable: 0.81.2** (released 2026-02-11, C++23 compat). Still
pins to RN 0.81.x. M19's RN 0.81.6 lock remains optimal.

Prior releases: v0.81.1 (2026-01-22), v0.81.0 (2026-01-17).

Note: RN 0.82.0 exists in the wider ecosystem; no RN-macOS 0.82.x
release yet. Track post-M20.

---

## 5. RN-CLI scaffold

Canonical command: `npx @react-native-community/cli@latest init <name>`.

Recommended for M20:
```
npx @react-native-community/cli@latest init voix \
  --version 0.81 \
  --install-pods false
```

Generated layout: `ios/` + `android/` + `index.js` + `App.tsx` +
`metro.config.js` + `package.json` + `tsconfig.json` + `Podfile`.

Bare init defaults to Legacy (Paper) architecture; M19's "New
Architecture ON" decision means an extra step to flip the flag.

---

## 6. Metro workspace package resolution

Canonical 2026 pattern (watchFolders + nodeModulesPaths):

```js
// clients/app/metro.config.js
const path = require('path');
module.exports = {
  projectRoot: path.resolve(__dirname),
  watchFolders: [path.resolve(__dirname, '../../packages')],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
  },
};
```

`extraNodeModules` is the alternative but less robust for workspace
hoisting. Stick with watchFolders + nodeModulesPaths.

---

## 7. iOS / macOS dev-env requirements

| Tool | Version | Notes |
|---|---|---|
| CocoaPods | 1.16.2 (Xcode 16) | Min 1.13, not 1.15.0/.1 |
| Xcode | 15.0+ recommended (16 supported); 14.3 min for RN 0.81 | |
| iOS min | 13.4 (RN 0.81 template); M19 set to 15.1 |  |
| macOS min | 11.0 (RN-macOS 0.81.2) | |
| Ruby | System Ruby (macOS 12+) | for CocoaPods |
| Watchman | Required | `brew install watchman` |

Tom's prereq: `xcode-select --install` if not done; `pod setup` on
first ever pod install.

---

## 8. .native sibling-exists invariant

Current state: 2 `.native` files; 2/2 have non-`.native` companions:

| .native file | Companion | OK |
|---|---|---|
| `audio_io/client.native.ts` | `audio_io/client.ts` | ✓ |
| `conversations/InlineAudioPlayer.native.tsx` | `conversations/InlineAudioPlayer.tsx` | ✓ |

Guard script (Hiro M2):
```bash
for nf in packages/ui/src/**/*.native.ts*; do
  base=$(basename "$nf" | sed 's/\.native//')
  dir=$(dirname "$nf")
  [ -f "$dir/$base" ] || { echo "ORPHAN: $nf"; exit 1; }
done
```

---

## Summary — actionable items for M20

| Item | Priority | Owner |
|---|---|---|
| Archive app/ to legacy branch | P1 | Implementer (per Architect spec) |
| Preserve M02e diffs (commands.rs, tray.rs, settings.js) | P1 | Implementer |
| Strip 28 explicit `.ts(x)` extensions in packages/ui | P1 | Implementer |
| Confirm RN-macOS 0.81.2 still locks to RN 0.81 | DONE | Researcher ✓ |
| RN CLI scaffold (`@react-native-community/cli@latest init voix --version 0.81`) | P2 | Implementer |
| Metro config with watchFolders + nodeModulesPaths | P2 | Implementer |
| Add `.native` sibling guard script | P2 | Implementer |
| HA Add-on Docker UI vendoring | P2 → DEFERRED to M20a | Architect call |
| Tom-facing iOS/macOS prereq doc | P2 | Implementer (verbatim from Architect) |
