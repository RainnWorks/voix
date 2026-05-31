# Phase 6 / M19 — Monorepo Architecture Brief

Owner: Architect. Status: ready for Implementer.
Scope: M19 only (monorepo shape + shared UI package). M20-M24 are
called out where decisions in M19 force their hand, but their
execution lives in their own briefs.

## Receipts

Files read (`stat -f "%m %z %N"`):

```
1779896242 14039 /Users/tom/Projects/voix/CLAUDE.md
1780057498   760 /Users/tom/Projects/voix/voix-backend/package.json
1779978562   574 /Users/tom/Projects/voix/voix-backend/ui/package.json
1780059600  1776 /Users/tom/Projects/voix/voix-backend/ui/vite.config.ts
1779978544   620 /Users/tom/Projects/voix/voix-backend/ui/tsconfig.json
1779781308   359 /Users/tom/Projects/voix/app/package.json
1780174252 30705 /Users/tom/Projects/voix/docs/STATE.md
1780042041 32754 /Users/tom/Projects/voix/docs/voix-build-plan.md
1780042050 13847 /Users/tom/Projects/voix/docs/voix-architecture.md
1779975306 21446 /Users/tom/Projects/voix/docs/architecture.md
1780042654 26130 /Users/tom/Projects/voix/docs/inventory-vs-architecture.md
1779982669 42165 /Users/tom/Projects/voix/docs/design-brief-multi-surface.md
1780064976  9360 /Users/tom/Projects/voix/voix-backend/src/audio_io/protocol.ts
1780129027  1692 /Users/tom/Projects/voix/voix-backend/ui/src/App.tsx
```

Also read (not stat'd separately): `voix-backend/Dockerfile`,
`voix-backend/run.sh`, all of `voix-backend/ui/src/{components,
voices, conversations, surfaces, lib, audio_io}/`.

WebFetched (all 2026-05-31, UTC ~12:15):

- <https://reactnative.dev/versions>
- <https://reactnative.dev/docs/the-new-architecture/landing-page>
- <https://github.com/microsoft/react-native-macos> (repo + releases)
- <https://docs.expo.dev/versions/latest/>
- <https://docs.expo.dev/develop/development-builds/introduction/>
- <https://docs.expo.dev/build-reference/app-extensions/>
- npm registry (programmatic): `react-native`, `react-native-macos`,
  `react`, `@types/react`, `typescript`, `metro`
- raw GitHub: `microsoft/react-native-macos/main/package.json`,
  `react-native-macos@0.81.7` peerDependencies

Key fact from registry: `react-native-macos@0.81.7` peerDeps =
`{ react: "^19.1.4", react-native: "0.81.6" }`. The RN pin is exact,
not caret. This drives the whole version matrix below.

---

## Decision 1 — Workspace manager: **Bun workspaces**

Bun workspaces. Same daemon-side toolchain, zero extra installer in
the dev loop, no impact on the HA add-on Dockerfile (which already
calls `bun install` twice). Metro reads workspace symlinks correctly
since 0.76 — there's no remaining "RN doesn't like workspaces" lore
that applies to our pin. We add a single `package.json` at the repo
root with `"workspaces": ["voix-backend", "voix-backend/ui",
"packages/*", "clients/*"]` and run everything from there. No Nx /
Turborepo — the build graph is three leaves (web, ios, macos) all
consuming one `packages/ui`, which doesn't need a task graph.
Reconsider Turborepo at M22+ if `bun --filter` becomes a bottleneck;
not before.

Risks: Metro + Bun symlink edge cases on RN 0.81. Mitigation in
Decision 9 step 5 (early "Hello world" RN build before any code
moves). If Metro misbehaves we fall back to **npm workspaces only
for `clients/app/`** (RN keeps its own lockfile) while the rest of
the repo stays on bun. The daemon's bun lockfile stays sacred.

## Decision 2 — Package layout

```
/                                      # bun workspace root
├── package.json                       # "workspaces": [...]
├── tsconfig.base.json                 # path mappings; everyone extends
├── packages/
│   ├── protocol/                      # NEW. wire types only.
│   │   ├── package.json               # name: "@voix/protocol"
│   │   ├── src/
│   │   │   ├── audio-io.ts            # moved from voix-backend/src/audio_io/protocol.ts
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   └── ui/                            # NEW. RN-flavoured components.
│       ├── package.json               # name: "@voix/ui"; "react-native": "src/index.ts"
│       ├── src/
│       │   ├── components/            # moved from voix-backend/ui/src/components/
│       │   ├── voices/                # ditto
│       │   ├── conversations/         # ditto
│       │   ├── surfaces/              # ditto
│       │   ├── lib/                   # theme.ts, api.ts
│       │   ├── audio_io/              # browserClient.ts (web target only)
│       │   ├── platform/              # NEW. target-specific shims.
│       │   │   ├── storage.ts         # localStorage on web, AsyncStorage on RN
│       │   │   ├── storage.native.ts
│       │   │   ├── audioCapture.ts    # web getUserMedia
│       │   │   ├── audioCapture.native.ts   # placeholder for M22+; throws "not impl"
│       │   │   ├── clipboard.ts       # navigator.clipboard
│       │   │   ├── clipboard.native.ts
│       │   │   └── index.ts
│       │   ├── App.tsx                # moved from voix-backend/ui/src/App.tsx
│       │   └── index.ts               # public surface
│       └── tsconfig.json
├── voix-backend/                      # UNCHANGED externally.
│   ├── package.json                   # still ships HA add-on
│   ├── src/                           # daemon (untouched in M19)
│   ├── src/audio_io/protocol.ts       # → re-export shim: `export * from "@voix/protocol"`
│   └── ui/                            # SHRINKS to a thin web target.
│       ├── package.json               # still "voix-ui"; deps drop to react/react-dom/react-native-web + @voix/ui workspace dep
│       ├── index.html                 # unchanged
│       ├── vite.config.ts             # unchanged (alias react-native → react-native-web)
│       └── src/
│           ├── main.tsx               # renders <App/> from @voix/ui
│           └── (everything else gone — moved to packages/ui)
├── clients/                           # NEW. Created in M20, empty in M19.
│   └── app/                           # RN-CLI app, M20.
├── app/                               # RELIC. Untouched by M19. Archived to branch `legacy/tauri-clipboard` as part of M20.
└── docs/, esphome/, ha-integration/, …   # unchanged
```

Rationale — one `packages/ui` not three:

- Three packages (`ui-core`, `platform-web`, `platform-rn`) tempt
  abstraction we don't yet need. The whole point of M21 is *file
  suffixes* (`foo.ts` + `foo.native.ts`). Metro and Vite both honour
  `.native.ts` already — Vite via a tiny resolver plugin we ship in
  voix-backend/ui/vite.config.ts. Single package keeps the import
  graph trivial: every consumer says `import {…} from "@voix/ui"`.
- Shared types lift into `@voix/protocol`. Today `voix-backend/ui/`
  imports types from `voix-backend/src/audio_io/protocol.ts` via a
  relative path. Once the UI moves to `packages/ui/`, that relative
  path breaks. Rather than re-stitch with a new relative path (which
  re-couples UI to daemon-internal layout), we lift the file. The
  daemon's `src/audio_io/protocol.ts` becomes a one-line re-export
  for backwards compat — internal callers don't change.
- `voix-backend/ui/` stays at its path because Dockerfile + run.sh
  reference it explicitly, and changing those is out-of-scope for
  M19. It shrinks to a 5-file Vite shell that consumes `@voix/ui`.

## Decision 3 — RN distro: **bare react-native CLI**

`@react-native-community/cli`. No Expo. Two hard reasons:

1. Expo SDK 56 pins RN 0.85. `react-native-macos` is stuck at
   0.81.6. Expo + rn-macos is not a supported combination today; the
   Expo docs don't even mention macOS as a platform. M20-M22 ship
   macOS — we have to be on bare CLI.
2. The iOS keyboard extension (M24) is a second Xcode target with
   its own entitlements + App Group setup. EAS Build *does* support
   extensions via config plugins, but the plugin to do this for a
   keyboard extension doesn't exist; we'd write it ourselves. At
   that point we're maintaining an Expo config plugin AND a bare RN
   project for macOS — two build systems for one app. Cheaper: bare
   CLI everywhere, hand-write the Xcode targets once.

We can still install individual Expo *modules* (e.g.
`expo-clipboard`, `expo-haptics`) into a bare RN app via the
`install-expo-modules` path. That's deferred — M19 doesn't pull any.

## Decision 4 — Version pins

Locked to `react-native-macos@0.81.7`'s peer requirements, because
that's the most constrained dependency in the tree.

| Package | Pin | Why |
|---|---|---|
| `react-native` | `0.81.6` | exact — rn-macos peer pin |
| `react-native-macos` | `0.81.7` | latest patch |
| `react` | `19.1.4` | rn-macos peer (`^19.1.4`); avoid bumping to 19.2 until we verify Metro 0.83 + RN 0.81 |
| `react-dom` | `19.1.4` | match react |
| `@types/react` | `19.1.4` | match react; `@types/react@19.2.x` works but adds churn |
| `react-native-web` | `^0.21.0` | latest; supports React 19 |
| `metro` | `0.83.x` | the version RN 0.81 ships with — don't override |
| `typescript` | `5.9.3` | matches voix-backend; ts6 just released, RN tooling not ready |
| `@react-native-community/cli` | `^21.x` | matches RN 0.81 |
| `node` | `>=20.19.4` | rn-macos engines field |

**New Architecture: ON from day one.** Default since RN 0.76; rn-macos
0.81 has it. We're not shipping a single library that's incompatible
(we won't, in M19 — `packages/ui` has zero native deps). Opting *out*
of newarch later would force a config flip on three platforms; opting
*in* later means a second migration we don't need. Default-on.

**Note**: this pins us *behind* RN latest (0.85) for as long as macOS
matters. We accept that. The voix-backend daemon and the HA add-on
are not on this train at all — they stay on Bun + Elysia and don't
care. The only thing dragging is feature parity for RN-iOS (we get
0.81's features, not 0.85's). That's fine for shipping; revisit if a
specific 0.83+ feature becomes a blocker.

## Decision 5 — Platform minimums

| Platform | Min | Test matrix |
|---|---|---|
| iOS | **15.1** | RN 0.81's floor. Test iOS 17 + iOS 18 in sim, iOS 18 on Tom's device. |
| macOS | **11.0 (Big Sur)** | rn-macos 0.81's floor. Test macOS 14 + 15 in CI; Tom's dev box runs 15.x. |
| Browsers | last-2 evergreen | unchanged from current Vite target `es2022` |

iOS 15.1 is a deliberate floor — Voice PE users skew Apple-current,
and dropping the long tail (iOS 13/14) keeps the keyboard extension
binary small. Keyboard extensions have a ~75 MB memory budget, every
KB matters.

## Decision 6 — react-native-web survival path: **keep the alias**

Stay on Vite + `react-native: react-native-web` alias. Do NOT move
to Expo Web.

- Expo Web uses Metro. Replacing Vite means re-doing the HA ingress
  fix (`base: "./"`) under a bundler that doesn't have a clean
  equivalent. Metro's `publicPath` is part of `dev-middleware` and
  doesn't apply to production output the same way Vite's `base`
  does. We'd be hand-rewriting asset URLs at deploy time.
- The voix-backend HA add-on serves a static `dist/` folder. Vite
  produces that natively; Metro requires `react-native bundle --platform web` plus
  a serve step, and the result isn't optimised for static hosting.
- We already have a working Vite setup, eight months of iteration on
  the ingress quirk, and a daemon that knows how to serve it. Don't
  pay a migration cost for parity with Expo we don't gain.

Trade-off: we maintain two bundlers. Vite for `voix-backend/ui/`
(web); Metro for `clients/app/` (iOS + macOS). The shared package
`packages/ui` ships TypeScript source — both bundlers transpile it.
No build step on `@voix/ui`. The `.native.ts` suffix split handles
the divergence; Vite needs a 10-line resolver plugin to ignore
`.native.ts` (built-in to Metro). This is the smallest possible
divergence surface.

## Decision 7 — Asset strategy

Two tiers:

1. **SVG icons / brand marks** (the `voix-*.svg` files): wrap in a
   single `<Icon name="…" />` component in `@voix/ui`. Behind the
   scenes, `Icon.tsx` + `Icon.native.tsx`:
   - web: imports SVG as URL via Vite's `?url` suffix, renders
     `<img>`.
   - native: imports SVG via `react-native-svg` (added in M21, not
     M19); for M19, ships a `<Text>` placeholder so types compile.
   Assets live in `packages/ui/src/assets/`.
2. **Fonts**: deferred. The current UI uses system fonts only. When
   we need a font (probably never — the brand guide uses SF Pro on
   Apple platforms), add an `useFont()` hook in
   `packages/ui/src/platform/fonts.ts` with the usual split. Don't
   build the abstraction speculatively.

For M19 specifically: no asset import lives in any moved file. The
SVGs at repo root stay at repo root; nothing consumes them
programmatically today. This is a no-op for M19 — call it out only
so the Implementer doesn't invent a system.

## Decision 8 — Build / dev commands

Root `package.json` scripts:

```json
{
  "scripts": {
    "dev": "bun run --filter voix-backend dev",
    "dev:ui": "bun run --filter voix-ui dev",
    "dev:app": "bun run --filter voix-app start",
    "build:ui": "bun run --filter voix-ui build",
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun run --filter '*' test"
  }
}
```

`dev` keeps doing what it does today (daemon with `bun --watch`).
`dev:ui` runs Vite on :5173 with the existing proxy. `dev:app`
(M20+) runs `react-native start` (Metro). Each workspace keeps its
own scripts; the root just orchestrates.

Target matrix:

| Target | Workspace | Bundler | Entry | Output |
|---|---|---|---|---|
| HA add-on web | `voix-backend/ui` | Vite | `src/main.tsx` | `dist/` (served by daemon at `/api/ui`) |
| iOS app | `clients/app` (M20) | Metro | `index.js` | iOS `.app` |
| macOS app | `clients/app` (M20) | Metro | `index.js` | macOS `.app` |
| Daemon | `voix-backend` | bun | `src/index.ts` | bun runtime |

`packages/ui` and `packages/protocol` are libraries — no build.
Consumers transpile from source. tsconfig path mappings make
`@voix/ui` and `@voix/protocol` resolve to `src/index.ts` in the
workspace, so changes are live-reloaded in every consumer.

## Decision 9 — M19 migration order

Each step is a commit. The HA add-on must build at every commit
(verify with `cd voix-backend/ui && bun run build`). If a step
breaks the add-on, revert and re-plan.

**Step 1 — root workspace skeleton.** Create root `package.json`
declaring `workspaces`, root `tsconfig.base.json` with path
mappings (empty at first), root `bun.lockb` regenerated. Add
`/node_modules` to root `.gitignore`. Verify `bun install` from
root produces a working `voix-backend/ui` + `voix-backend` setup
(no behaviour change). **Smoke test**: `cd voix-backend/ui && bun
run build` must pass and produce `dist/`.

**Step 2 — `@voix/protocol`.** Create `packages/protocol/` with
`src/audio-io.ts` copied verbatim from
`voix-backend/src/audio_io/protocol.ts`, plus a one-line
`src/index.ts` re-exporting it. Update path mapping in
`tsconfig.base.json`: `"@voix/protocol": ["packages/protocol/src/index.ts"]`.
Replace the body of `voix-backend/src/audio_io/protocol.ts` with
`export * from "@voix/protocol";`. **Smoke test**: daemon
typechecks (`cd voix-backend && bun run typecheck`); UI typechecks;
UI builds.

**Step 3 — `@voix/ui` (move, don't refactor).** Create
`packages/ui/` with the workspace layout from Decision 2. Move
files in this order to keep intermediate states compiling:
1. `lib/theme.ts` first (no deps on siblings).
2. `lib/api.ts`.
3. `components/Wordmark.tsx`, `Puck.tsx`.
4. `components/AppShell.tsx`.
5. `voices/`, `conversations/`, `surfaces/` together.
6. `audio_io/browserClient.ts` — flag as web-only (see step 4).
7. `App.tsx`.

After each sub-move, `voix-backend/ui/src/main.tsx` updates its
imports to `@voix/ui`. The directory shrinks until `main.tsx` is
all that's left in `voix-backend/ui/src/`. **Smoke test after each
sub-move**: UI build.

**Step 4 — platform suffix split (M19's only real refactor).**
Anything web-only inside `@voix/ui` gets a `.native.ts` companion
that throws "not implemented in M19". For M19 the only web-only
file is `audio_io/browserClient.ts` (uses `MediaStream`,
`AudioContext`). Move the type-only parts to `audio_io/client.ts`
(shared interface) and the web impl to
`audio_io/browserClient.web.ts` — but Metro picks up `.web.ts` only
in RN ≥ 0.79, so we use the conventional split:

- `audio_io/client.ts` — the interface + shared logic
- `audio_io/client.native.ts` — `throw new Error("audio capture: implement in M22")`

The web build (Vite) doesn't see `.native.ts` (resolver plugin
filters); RN's Metro picks `.native.ts` by default. **Smoke test**:
UI build still works (it should — `.native.ts` is invisible to
Vite once the plugin is in).

**Step 5 — Hello-world RN smoke (NEW MILESTONE M19.5 OR PART OF M20).** Do *not* do this in M19. Flagged here only so the Implementer
doesn't think they need to. M19 ends after step 4.

**Step 6 — docs + STATE update.** Update `docs/STATE.md` to mark
M19 closed, note the new workspace shape, and link this brief.
Update `CLAUDE.md` "Hosts and paths" section if any path moved
(none did externally).

**Order rationale**: each step preserves the only thing the user
actually sees (the HA add-on rebuilding and serving the same UI),
and each step is small enough to revert without unwinding the next.
The risky bit is step 4's resolver-plugin for Vite — verify it in
isolation before committing.

## Decision 10 — Risk register

| # | Risk | Detect | Mitigate |
|---|---|---|---|
| 1 | **Bun + Metro symlink resolution explodes** when `clients/app` lands in M20. | M20 first `npx react-native run-ios` either hangs at "transforming" or 500s. | Step 5 above defers this to M20. If it breaks, fall back to `nohoist` for `clients/app` deps, or move that one workspace off bun (`npm install` in `clients/app` only). The bun lockfile for the daemon stays untouched. |
| 2 | **HA add-on Dockerfile breaks** because `bun install` now needs to install workspace symlinks for `voix-backend/ui`'s new `@voix/ui` dep. | `docker build` of the add-on fails; or it succeeds but `ui/dist/` is empty. | Dockerfile already does `COPY package.json bun.lock* ./` then `bun install --production`. We need to also `COPY packages/ ./packages/` and `COPY package.json bun.lock* ./` from root before the workspace install. The mitigation is a Dockerfile patch in step 1 — flagged as part of step 1's smoke test, not deferred. |
| 3 | **Vite's react-native-web alias stops working** when `react-native` types now resolve via `packages/ui`'s own `node_modules` (hoisted differently). | UI build fails with "Cannot find module 'react-native'" or runtime "ReactNative.View is undefined". | Verify the alias still wins by inspecting the bundle output for `react-native-web`. If Bun's hoisting puts a real `react-native` package at the root (it might — `@voix/ui` may pull it as a peer dep), the Vite alias still wins because it runs at resolve time. Belt-and-braces: also add `react-native` to `voix-backend/ui/package.json`'s `resolutions` field. |
| 4 | **TypeScript path mappings don't resolve in Vite** without `vite-tsconfig-paths` plugin. | Build error: `Cannot find module '@voix/ui'`. | Add `vite-tsconfig-paths` to `voix-backend/ui/devDependencies` in step 1. It's a 3-KB plugin, no transitive cost. |
| 5 | **Researcher's UI-deps map disagrees** with this brief's assumed dependency surface — e.g. they find a node-only import in a component file that breaks RN. | Researcher's `docs/phase-6/research-ui-deps.md` flags it; or step 3 sub-move fails to typecheck. | Implementer pauses, files a delta against this brief, Architect re-decides for that one file. Don't try to absorb into platform shims without re-deciding. |

---

## Acceptance criteria for M19

A commit on `main` is M19-complete when **all** of the following
hold (verifiable in one terminal session):

1. `bun install` at repo root succeeds with no warnings about
   unresolved peer deps for the daemon or web UI workspaces.
2. `cd voix-backend && bun run typecheck` passes.
3. `cd voix-backend/ui && bun run build` produces `dist/index.html`
   referencing assets via `./assets/…` (the `base: "./"` quirk
   survives).
4. `cd voix-backend/ui && bun run typecheck` passes.
5. `packages/ui/src/App.tsx` exists; `voix-backend/ui/src/App.tsx`
   does not.
6. `voix-backend/ui/src/main.tsx` imports `App` from `@voix/ui`.
7. `packages/protocol/src/audio-io.ts` exists; the daemon-side
   re-export at `voix-backend/src/audio_io/protocol.ts` is a single
   `export * from "@voix/protocol";` line.
8. The HA add-on Docker image builds end-to-end (`cd voix-backend &&
   docker build .`) and the resulting `/app/ui/dist/` contains the
   bundle.
9. `docs/STATE.md` Phase 6 / M19 row marked closed with a link to
   this brief.
10. Tauri `app/` and `app/src-tauri/` directories are **untouched**
    (M20 archives them, not M19).

Out of scope for M19 (explicit non-goals): any file under
`clients/`, any RN install, any iOS/macOS Xcode work, any change to
`esphome/` or `ha-integration/`, any daemon behaviour change.

---

## Coordinator deltas (added after review)

Two corrections to the brief, applied in addition to the steps above:

### Delta A — `ConversationDetail.tsx` is also web-only

The Researcher's `docs/phase-6/research-ui-deps.md` catalogued a 12th
web-only API leak in `voix-backend/ui/src/conversations/ConversationDetail.tsx`:
an HTML `<audio>` element used for inline WAV playback ("Listen back —
What I said / What voix said"). This file is *not* mentioned in
Decision 9 step 4's split.

**Action**: step 4 also splits `ConversationDetail`. Approach:
- `conversations/ConversationDetail.tsx` — keep the React Native
  components (View/Text/Pressable for the chrome).
- Extract the `<audio>`-element render into a small
  `<InlineAudioPlayer src={url} />` component in
  `conversations/InlineAudioPlayer.tsx` (web impl: `<audio
  controls />`) + `conversations/InlineAudioPlayer.native.tsx`
  (stub: returns a `<Text>Playback: M22</Text>` placeholder; real
  impl deferred to M22+ when audio capture/playback shims land).
- `ConversationDetail` imports `InlineAudioPlayer` and renders it
  the same way for both targets.

### Delta B — this milestone also bumps React 18 → React 19

`voix-backend/ui/package.json` currently pins `react@^18.3.1`. The
brief's Decision 4 mandates `react@19.1.4` (driven by
`react-native-macos@0.81.7`'s exact peer pin).

That's a major version bump, not just a monorepo migration. React 19
breaking changes that may bite this codebase:

- `forwardRef` is no longer needed for new components (cleanup
  opportunity; not a break)
- `ReactDOM.render` and `ReactDOM.hydrate` removed (we already use
  `createRoot` since M18 — no impact)
- `defaultProps` deprecated on function components (not used here)
- Stricter Suspense semantics (no Suspense boundaries in this UI)
- `react-test-renderer` deprecated (we don't ship test renderer)

**Action**: step 1 of Decision 9 already bumps `react` and
`react-dom` to 19.1.4 as part of the workspace root + workspace
`package.json` updates. After the bump, **run the existing web UI in
the dev server and click through each screen** before continuing to
step 2. If anything renders blank or warns in dev tools, fix in the
same commit. The smoke test for step 1 changes to:

> `cd voix-backend/ui && bun run build && bun run dev` — open the
> dev UI, click Conversations / Voices / Surfaces, confirm no
> blank screens, no React error overlays, no warnings in dev tools
> about removed APIs.

This is the highest-risk part of M19. A failure here means
back-pedalling the React bump (keep `react@18.3.1` for the web
target, bump `react@19.1.4` only for `clients/app` in M20 — costs
one extra package boundary but unblocks shipping). The Implementer
should report the screen check explicitly in their `worker_done`.

### Delta C — none on numbering

Step 5 in Decision 9 is correctly labelled "do NOT do this in M19" —
it's anti-pattern documentation for the Implementer's benefit.
Steps 1-4 + step 6 (docs) are M19's actual work; the "step 5"
reservation prevents creep.
