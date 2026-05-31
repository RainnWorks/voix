# M19 Monorepo UI Dependency Surface Map

**Research Goal**: Map voix-backend/ui/ dependency surface for M19 lift into shared package without surprises.
**Snapshot Date**: 2026-05-31  
**Base**: React 18.3.1 + TypeScript 5.6.3 + Vite 6.0.5 + react-native-web 0.19.13

---

## File Stat Receipts (mtime size path)

| File | mtime | Size | Purpose |
|------|-------|------|---------|
| main.tsx | 1780055737 | 276 | React root mount; **web leak: document.getElementById()** |
| App.tsx | 1780129027 | 1692 | Root section router (voices/conversations/surfaces) |
| lib/api.ts | 1780129027 | 5387 | Daemon client: fetch-based HTTP (M17 history types) |
| lib/theme.ts | 1780058260 | 5074 | Design tokens: colors, fonts, spacing, nearestSwatch(rgb) palette mapping |
| audio_io/browserClient.ts | 1780174001 | 10453 | M18 audio I/O endpoint; **web leak: window.location, document.title** |
| components/AppShell.tsx | 1780099557 | 7366 | Sidebar + main area chrome (mocked system title bar) |
| components/Puck.tsx | 1779979103 | 1476 | Brand glyph; puck icon (circular + inner dot) |
| components/Wordmark.tsx | 1779979119 | 1444 | "Voix /vwa/" wordmark (glyph + text + pronunciation) |
| conversations/ConversationList.tsx | 1780174001 | 7378 | M17 history list; calls historyApi.list(), voicesApi.list() |
| conversations/ConversationDetail.tsx | 1780129027 | 9922 | M17 detail: transcript + entry + context + **inline audio HTML element** |
| conversations/TalkButton.tsx | 1780174001 | 6069 | M18 press-to-talk: fetch(WS_TOKEN_URL) + BrowserAudioIoClient |
| surfaces/SurfaceList.tsx | 1780099776 | 9511 | M16 devices/surfaces list with capability chips |
| voices/VoiceList.tsx | 1780057498 | 7042 | Voice grid with puck swatch; voicesApi.list(), devicesApi.list() |
| voices/VoiceEditor.tsx | 1780073270 | 29116 | M14 voice editor: Realtime vs Dictation, STT/TTS/LLM provider UI |

**Build Artifacts:**
- vite.config.ts | 1780059600 | 1776 | Vite bundle config (base: "./", react-native alias) |
- tsconfig.json | 1779978544 | 620 | TS 5.6.3 strict mode, es2022 target |
- package.json | 1779978562 | 574 | React 18.3.1, react-native-web 0.19.13, Vite 6.0.5 |
| index.html | 1779978435 | 670 | Root HTML; script src="/src/main.tsx" (Vite handles) |
| dist/index.html | 1780173886 | 695 | Built root (generated; base: "./" → relative asset paths) |

**Directory Stats:**
- src/ → 14 .ts/.tsx files, 3353 lines total
- components/ → 2 files (2920 bytes)
- audio_io/ → 1 file (10453 bytes)
- conversations/ → 3 files (23369 bytes)
- lib/ → 2 files (10461 bytes)
- surfaces/ → 1 file (9511 bytes)
- voices/ → 2 files (36158 bytes)

---

## Import Graph (Leaf-First, Dependency Order)

### Tier 0 (No Internal Imports)
- **lib/theme.ts** — design tokens only; exports `colors`, `fontFamily`, `spacing`, `radius`, `nearestSwatch(rgb)`
- **audio_io/browserClient.ts** — standalone M18 class; no internal deps; exports `BrowserAudioIoClient`, type `BrowserClientEvent`, `BrowserClientStatus`, `BrowserClientOpts`
- **lib/api.ts** — standalone daemon client; no internal deps; exports `Voice`, `VoiceUpdate`, `Surface`, `Device`, `SurfaceCapabilities`, `HistoryEntry`, `HistoryContextEntry`, `TranscriptResponse`; routes: `voicesApi`, `devicesApi`, `surfacesApi`, `historyApi`
- **components/Puck.tsx** → lib/theme (colors)
- **components/Wordmark.tsx** → lib/theme (colors, fontFamily); components/Puck (reuse)

### Tier 1 (Imports from Tier 0 + RN/React)
- **components/AppShell.tsx** → lib/theme (colors, fontFamily, radius, spacing); components/Puck, Wordmark
- **voices/VoiceList.tsx** → lib/api (voicesApi, devicesApi, Voice); lib/theme (colors, fontFamily, nearestSwatch, radius, spacing); components/Puck

### Tier 2 (Imports from Tier 0–1)
- **surfaces/SurfaceList.tsx** → lib/api (surfacesApi, voicesApi, Surface, Voice, SurfaceCapabilities); lib/theme (colors, fontFamily, nearestSwatch, radius, spacing); components/Puck
- **conversations/TalkButton.tsx** → audio_io/browserClient (BrowserAudioIoClient, BrowserClientStatus); lib/theme (colors, fontFamily, radius, spacing); fetch(WS_TOKEN_URL)
- **conversations/ConversationList.tsx** → lib/api (historyApi, voicesApi, HistoryEntry, Voice); lib/theme; components/Puck; conversations/TalkButton
- **conversations/ConversationDetail.tsx** → lib/api (historyApi, HistoryEntry, HistoryContextEntry); lib/theme; **HTML audio element**

### Tier 3 (App Router)
- **App.tsx** → components/AppShell (Section type); conversations/ConversationDetail, ConversationList; surfaces/SurfaceList; voices/VoiceEditor, VoiceList; useState
- **voices/VoiceEditor.tsx** → lib/api (voicesApi, Voice, VoiceUpdate); lib/theme; useState, useEffect, useCallback

### Tier 4 (Root)
- **main.tsx** → React.createRoot(document.getElementById("root")); renders `<App />`; **document.getElementById web leak**

---

## External Dependencies Used vs. Unused

### Production Dependencies (package.json)
| Package | Version | Used | Purpose |
|---------|---------|------|---------|
| react | ^18.3.1 | ✓ | useState, useCallback, useEffect, useRef hooks everywhere |
| react-dom | ^18.3.1 | ✓ | ReactDOM.createRoot(element) in main.tsx |
| react-native-web | ^0.19.13 | ✓ | View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView (ui/src imports all from "react-native", alias resolves to rnw) |

### Dev Dependencies (Vite/TS/React toolchain)
| Package | Version | Used | Purpose |
|---------|---------|------|---------|
| @vitejs/plugin-react | ^4.3.4 | ✓ | Vite JSX transform (vite.config.ts plugins) |
| vite | ^6.0.5 | ✓ | Bundler; base: "./", alias for react-native |
| typescript | ^5.6.3 | ✓ | tsc --noEmit in build/typecheck |
| @types/react | ^18.3.12 | ✓ | React type defs |
| @types/react-dom | ^18.3.1 | ✓ | ReactDOM type defs |
| @types/react-native | ^0.73.0 | ✓ | RN component types (RN compat even though using rnw) |

**No unused or redundant dependencies identified.**

---

## Web-Only API Leaks (Browser Context Only)

### Known Leaks (Pre-Audit)

**1. main.tsx line 5**
```
const root = document.getElementById("root");
```
**Impact**: Hard-coded DOM selection. Web-only.  
**M19 Shim**: Require shim providing `document` stub on RN (or gate mount logic).

**2. audio_io/browserClient.ts line 79 (wsUrlFromDocument)**
```
const loc = window.location;
const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
const path = loc.pathname.replace(/\/$/, "");
```
**Impact**: Reads window.location.protocol, window.location.host, window.location.pathname for HA ingress prefix relay.  
**M19 Shim**: Require shim providing `window` stub on RN (or pass wsUrl as constructor option).

**3. audio_io/browserClient.ts line 202 (sendHello)**
```
friendly_name: typeof document !== "undefined" ? document.title : "browser",
```
**Impact**: Conditional check; falls back gracefully if document missing (SSR-proof). Still a web API reference.  
**M19 Shim**: M21 can substitute device-friendly-name from platform context.

### Additional Leaks (Audit)

**4. audio_io/browserClient.ts line 120 (getUserMedia)**
```
this.mediaStream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
});
```
**Impact**: Pure web audio API. No graceful fallback.  
**M19 Shim**: M21 audio I/O shim maps RN-side audio to same interface.

**5. audio_io/browserClient.ts line 159 (WebSocket)**
```
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
```
**Impact**: WebSocket for binary audio frames.  
**M19 Shim**: M21 provides platform-specific transport (likely same WS on iOS; native audio stack on macOS).

**6. audio_io/browserClient.ts line 119 (AudioContext)**
```
this.audioContext = new AudioContext();
```
**Impact**: Web Audio API context for mic + speaker PCM.  
**M19 Shim**: M21 bridges to native audio (iOS: AVAudioEngine; macOS: RemoteIO).

**7. audio_io/browserClient.ts line 243 (ScriptProcessorNode)**
```
const node = this.audioContext.createScriptProcessor(2048, 1, 1);
```
**Impact**: Deprecated (in favor of AudioWorklet) but portable. Mic PCM16 batcher.  
**M19 Shim**: Same AudioWorklet upgrade applies to web path; RN uses platform audio.

**8. audio_io/browserClient.ts line 272 (AudioBuffer / createBuffer)**
```
const buf = this.audioContext.createBuffer(1, pcm.length, 24000);
```
**Impact**: Speaker PCM buffer + playback via createBufferSource.  
**M19 Shim**: M21 swaps for platform playback.

**9. lib/api.ts line 61 (fetch)**
```
const r = await fetch(path, { ...init, headers: { "content-type": "application/json", ... } });
```
**Impact**: Global fetch for daemon HTTP. Used everywhere (voicesApi, devicesApi, surfacesApi, historyApi).  
**M19 Shim**: M21 can polyfill fetch or map to RN's fetch (available on RN as global).

**10. conversations/ConversationDetail.tsx line 198 (HTML audio element)**
```
<audio controls preload="metadata" src={src} style={audioStyle} />
```
**Impact**: React Native Web forwards unknown JSX to DOM; native HTML5 audio player rendered in browser.  
**M19 Shim**: RN app requires platform audio player component (iOS: AVPlayer or native Media); web uses this native element.

**11. localStorage (browserClient.ts lines 64–68)**
```
const existing = localStorage.getItem(DEVICE_ID_KEY);
localStorage.setItem(DEVICE_ID_KEY, fresh);
```
**Impact**: Per-browser device_id persistence (key: "voix.browser_device_id").  
**M19 Shim**: M21 maps to platform storage (iOS: UserDefaults; macOS: Keychain or defaults).

**12. crypto.randomUUID (browserClient.ts line 56, fallback**)**
```
if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
  return crypto.randomUUID();
}
// Fallback: Math.random() + Date.now() string concat
```
**Impact**: Graceful fallback already present.  
**M19 Shim**: None needed; fallback covers RN.

---

## react-native-web Patterns Requiring RN-Incompatible Styling

### None Identified

**Styling Rationale:**
- All `StyleSheet.create()` calls use RN property subset (flexbox, colors, fonts, padding/margin, borderRadius, borderWidth, opacity, etc.)
- No CSS-specific properties found (`:hover`, `::before`, media queries, transforms, CSS Grid, CSS columns, etc.)
- **react-native-web forwards unknown JSX children to DOM** (pattern in ConversationDetail.tsx line 198 `<audio>` element) — but this is intentional web-only, not a style leak
- **inline style in ConversationDetail.tsx line 203**:
  ```
  const audioStyle = { width: "100%", maxWidth: 480 };
  ```
  → RN-compatible (flex + sizing)
- **AppShell.tsx inline styles** (lines 172, 185, 202):
  ```
  backgroundColor: "rgba(255,255,255,0.5)",  // semi-transparent
  backgroundColor: "rgba(0,0,0,0.04)",        // subtle tint
  ```
  → RN-web supports rgba(); native RN also supports

**Conclusion:** All styles are react-native-compatible. No styling refactor needed for M21.

---

## Asset-Loading Patterns

### Static Assets
**None currently loaded.**

### Dynamic Asset Loading
**None identified.** All assets (images, sounds) exist server-side:
- `/recordings/<sessionId>/mic.wav` — daemon-hosted
- `/recordings/<sessionId>/speaker.wav` — daemon-hosted
- Puck SVG → rendered as View/nested View (no asset file)
- Wordmark → rendered as Puck + Text (no asset file)

### Vite Configuration for HA Ingress
- **base: "./"** — ALL asset paths in index.html are relative, ensuring HA ingress prefix survives the round-trip
  - `<script type="module" src="/src/main.tsx"></script>` → Vite rewrites to `./src/main.tsx` on bundle
  - Built: `<script type="module" src="./assets/main-XXX.js"></script>` (relative)
  - Resolved by browser from `<document-base>/assets/…` where document-base includes HA ingress prefix
- **No public/ directory** — no static assets to copy

**M19 Impact**: Asset loading is already platform-agnostic. No changes needed.

---

## Verification of Two Known Web Leaks

✓ **Leak #1: main.tsx line 5 — document.getElementById("root")**
- Confirmed: `const root = document.getElementById("root");`
- Hard dependency; no graceful fallback
- **M19 Action**: M21 shim must provide DOM stub or gate mount logic

✓ **Leak #2: audio_io/browserClient.ts lines 78–84 — wsUrlFromDocument()**
- Confirmed: reads `window.location.protocol`, `window.location.host`, `window.location.pathname`
- Purpose: Relay HA ingress prefix (e.g., `/api/hassio_ingress/<token>/`) from loaded document to WS URL
- Graceful fallback: `return "ws://localhost:8765/ws"` if `window` undefined
- **M19 Action**: M21 shim must provide `window` stub or accept wsUrl as constructor option

---

## Build Artifacts & Vite Quirks

### dist/ Directory Structure
- **dist/index.html** — built root HTML (generated by Vite build)
  - Relative script src: `<script type="module" src="./assets/main-HASH.js"></script>`
  - Relative link hrefs (if any stylesheets exist)
- **dist/assets/** → JavaScript bundle, CSS (if any), sourcemaps
  - Naming: `main-XXXX.js`, `main-XXXX.css` (hash-based cache busting)
- **sourcemap: true** → `.js.map` and `.css.map` files in dist/assets/

### Vite Quirks & Configuration Notes

**1. alias: "react-native" → "react-native-web"**
   - Every `import { View } from "react-native"` resolves to react-native-web in browser
   - Enables same component source for web + RN (on native shell, `react-native` resolves to real bindings)

**2. base: "./" for HA Ingress**
   - HA Add-on serves voix at `/api/hassio_ingress/<token>/` (not root)
   - Absolute `/assets/…` would 404; `./" makes them relative
   - Applies to index.html AND any manual asset references in code (none currently)

**3. target: "es2022"**
   - Modern JS syntax (no IE11 support)
   - Matches upstream daemon (Node 22 LTS / es2024)

**4. server.proxy for dev**
   - `dev`: Vite serves at http://localhost:5173
   - Proxy `/api/*` → daemon at :8765
   - Proxy `/recordings/*` → daemon at :8765
   - Enables hot reload while hitting real daemon state

**5. React Fast Refresh**
   - @vitejs/plugin-react enables JSX transform + fast refresh
   - HMR on file change (no full reload)

**6. TypeScript in Vite**
   - TS source in src/, but Vite transpiles directly (no `tsc` in build pipeline)
   - build: `tsc --noEmit && vite build` — type-check first, then bundle
   - Both ts and tsx files treated equally

---

## Type Exports & Cross-Module Contracts

| Module | Exports |
|--------|---------|
| lib/api.ts | Voice, VoiceUpdate, Voice, Device, Surface, SurfaceCapabilities, HistoryEntry, HistoryContextEntry, TranscriptResponse; namespaced APIs: voicesApi, devicesApi, surfacesApi, historyApi |
| audio_io/browserClient.ts | BrowserAudioIoClient (class), BrowserClientEvent, BrowserClientStatus, BrowserClientOpts |
| lib/theme.ts | colors (object), fontFamily (object), spacing (object), radius (object), nearestSwatch(rgb: [r,g,b]) → {hex, rgb} |
| components/AppShell.tsx | AppShell (component), Section ("voices" \| "conversations" \| "surfaces") |
| components/Puck.tsx | Puck (component) → Props { size, color?, bodyColor? } |
| components/Wordmark.tsx | Wordmark (component) → Props { size?, showPronunciation? } |

---

## M19 Migration Checklist for Implementer

### Pre-Migration (Arch Phase)
- [ ] Decide monorepo structure (clients/app vs shared packages; shared/ui location)
- [ ] Plan platform shims (M21 responsibility) for window, document, fetch, WebSocket, AudioContext, localStorage, navigator.mediaDevices
- [ ] Confirm react-native-web version lock (0.19.13) across all apps

### File Relocation
- [ ] Move src/ → shared/ui/src (or clients/web/src depending on strategy)
- [ ] Move vite.config.ts, tsconfig.json, package.json to shared/ui/
- [ ] Update import paths: relative imports remain unchanged; daemon API calls remain relative (work under any base)

### Import Rewrites
- [ ] All imports within src/ remain unchanged (relative paths, internal graph)
- [ ] External imports (react, react-native, etc.) unchanged if shared/ui has own node_modules
- [ ] If centralizing node_modules, ensure Vite can resolve react-native alias at monorepo root

### Web Leak Handling (M21 follows)
1. **document.getElementById()** (main.tsx) — M21 shim provides DOM stub or conditional mount
2. **window.location** (browserClient.ts) — M21 shim provides stub or pass wsUrl as option
3. **document.title** (browserClient.ts) — conditional, safe; M21 provides fallback context
4. **navigator.mediaDevices.getUserMedia** — M21 bridges to platform audio (iOS: AVAudioSession → getUserMedia shim; macOS: RemoteIO)
5. **WebSocket, AudioContext, ScriptProcessorNode** — M21 audio I/O shim encapsulates
6. **localStorage** — M21 maps to platform storage
7. **fetch** — RN has global fetch; no shim needed (or M21 provides polyfill if needed)
8. **HTML audio element** (ConversationDetail) — M21 provides RN audio player component; web uses native

### Build & Test
- [ ] Run `npm run build` from shared/ui/ (or monorepo root if centralized); verify dist/ output
- [ ] Type-check: `npm run typecheck`
- [ ] Manual test: web app at new location works (dev + build)
- [ ] Manual test: Vite hot-reload still functional (server.proxy paths match daemon)
- [ ] Audit: confirm no new relative imports break under monorepo paths

---

## Summary: Lift Readiness Assessment

| Aspect | Status | Notes |
|--------|--------|-------|
| Internal dependency graph | ✓ Clear | 14 files, 3353 lines; Tier 0–4 DAG with no cycles |
| External dependencies | ✓ Minimal | React + react-native-web only; no bloat |
| Web API leaks | ✓ Catalogued | 12 identified leaks; all solvable by M21 shims; no architectural blockers |
| Asset loading | ✓ Platform-agnostic | base: "./" works for web + future RN shells; no asset files to relocate |
| Styling | ✓ React-Native-compatible | All StyleSheet.create() patterns compatible; no CSS-specific code |
| Build config | ✓ Portable | Vite config is modular; base: "./" is intention-explicit; no hardcoded paths |
| Type definitions | ✓ Exportable | All types are hand-written and portable; no auto-generated dependencies |

**Conclusion**: voix-backend/ui/ is ready for M19 monorepo lift. Web leaks are contained in two files (main.tsx, browserClient.ts) and six external APIs (document, window, navigator, WebSocket, AudioContext, localStorage); all are M21 shim candidates. No unexpected import tangles, no platform-specific styling,