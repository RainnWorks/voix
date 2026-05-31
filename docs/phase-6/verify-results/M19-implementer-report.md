# M19 Implementer report

**Status: PARTIAL**

Steps 1-4 + 6 all shipped and pushed. The Docker AC8 is FAIL: a
known structural break introduced by step 2's daemon-side workspace
dep on `@voix/protocol`, surfaced after committing because Docker
daemon wasn't running locally to smoke test sooner. Dev paths (local
+ HA Add-on dev_mode) are unaffected. Three solution paths
documented in the Dockerfile and Delta C below for coordinator
decision.

## Receipts

### Files written / modified / moved (stat output)

```
1780222767 626 /Users/tom/Projects/voix/package.json
1780222770 679 /Users/tom/Projects/voix/tsconfig.base.json
1780223611 114570 /Users/tom/Projects/voix/bun.lock
1780222811 859 /Users/tom/Projects/voix/.gitignore
1780224167 33086 /Users/tom/Projects/voix/docs/STATE.md
1780224967 3408 /Users/tom/Projects/voix/voix-backend/Dockerfile
1780223084 5119 /Users/tom/Projects/voix/voix-backend/run.sh
1780223268 797 /Users/tom/Projects/voix/voix-backend/package.json
1780223261 890 /Users/tom/Projects/voix/voix-backend/tsconfig.json
1780223251 417 /Users/tom/Projects/voix/voix-backend/src/audio_io/protocol.ts
1780223401 665 /Users/tom/Projects/voix/voix-backend/ui/package.json
1780223485 388 /Users/tom/Projects/voix/voix-backend/ui/tsconfig.json
1780223423 3686 /Users/tom/Projects/voix/voix-backend/ui/vite.config.ts
1780223756 279 /Users/tom/Projects/voix/voix-backend/ui/src/main.tsx
1780223244 437 /Users/tom/Projects/voix/packages/protocol/package.json
1780223245 215 /Users/tom/Projects/voix/packages/protocol/tsconfig.json
1780223234 9360 /Users/tom/Projects/voix/packages/protocol/src/audio-io.ts
1780223241 575 /Users/tom/Projects/voix/packages/protocol/src/index.ts
1780223606 768 /Users/tom/Projects/voix/packages/ui/package.json
1780223388 221 /Users/tom/Projects/voix/packages/ui/tsconfig.json
1780223747 1716 /Users/tom/Projects/voix/packages/ui/src/App.tsx
1780223993 2213 /Users/tom/Projects/voix/packages/ui/src/index.ts
1780174001 10453 /Users/tom/Projects/voix/packages/ui/src/audio_io/client.ts
1780223887 1789 /Users/tom/Projects/voix/packages/ui/src/audio_io/client.native.ts
1780223549 1479 /Users/tom/Projects/voix/packages/ui/src/components/Puck.tsx
1780223551 1451 /Users/tom/Projects/voix/packages/ui/src/components/Wordmark.tsx
1780223631 7377 /Users/tom/Projects/voix/packages/ui/src/components/AppShell.tsx
1780223684 7392 /Users/tom/Projects/voix/packages/ui/src/conversations/ConversationList.tsx
1780223977 9817 /Users/tom/Projects/voix/packages/ui/src/conversations/ConversationDetail.tsx
1780223897 6068 /Users/tom/Projects/voix/packages/ui/src/conversations/TalkButton.tsx
1780223954 709 /Users/tom/Projects/voix/packages/ui/src/conversations/InlineAudioPlayer.tsx
1780223943 836 /Users/tom/Projects/voix/packages/ui/src/conversations/InlineAudioPlayer.native.tsx
1780129027 5387 /Users/tom/Projects/voix/packages/ui/src/lib/api.ts
1780058260 5074 /Users/tom/Projects/voix/packages/ui/src/lib/theme.ts
1780223700 9521 /Users/tom/Projects/voix/packages/ui/src/surfaces/SurfaceList.tsx
1780223671 7052 /Users/tom/Projects/voix/packages/ui/src/voices/VoiceList.tsx
1780223678 29126 /Users/tom/Projects/voix/packages/ui/src/voices/VoiceEditor.tsx
```

### Commits

```
fa638d7 monorepo(M19 followup): Dockerfile — flag known-broken AC8
a5547d5 monorepo(M19 step6): STATE — close M19, document workspace shape
d174ee7 monorepo(M19 step4): platform suffix split (+ Delta A InlineAudioPlayer)
d9ee0fb monorepo(M19 step3): @voix/ui — move, don't refactor
6e7937c monorepo(M19 step2): @voix/protocol — shared wire types
e1d71e0 monorepo(M19 step1): root workspace + React 19 bump
```

## Per-step pass/fail

All steps' `bun run build` produced 324-325 modules transformed cleanly
in ~575ms. Build output references assets via `./assets/…` (the
`base: "./"` quirk survives).

| Step | Commit | Build smoke | Notes |
|---|---|---|---|
| 1 root workspace + React 19 | e1d71e0 | ✓ 323 modules / 579ms | Delta B (React 19 manual screen check) PARTIAL — agent has no browser; static checks pass |
| 2 @voix/protocol | 6e7937c | ✓ | Runtime smoke: `bun --eval` confirms `parseHello` reachable through the daemon's re-export shim |
| 3 @voix/ui (move only) | d9ee0fb | ✓ 324 modules / 576ms | Hit Risk #3 mid-way → added `react-native-web` as devDep of `@voix/ui` so Vite's alias resolves from inside packages/ui |
| 4 platform suffix split + Delta A | d174ee7 | ✓ 325 modules / 577ms | `audio_io/browserClient.ts` → `client.ts` + `client.native.ts`; `InlineAudioPlayer.{tsx,native.tsx}` created; `grep -c "implement in M22" dist/assets/*.js = 0` (suffix filter working) |
| 5 (intentionally skipped — M20's job) | — | — | — |
| 6 STATE + Dockerfile followup | a5547d5, fa638d7 | — | STATE.md updated with new workspace shape |

## Acceptance criteria scorecard (10 items)

| # | Criterion | Result |
|---|---|---|
| 1 | `bun install` from root succeeds, no unresolved peer warnings | PARTIAL — succeeds; 3 transitive peer warnings from RN tooling, don't block |
| 2 | `voix-backend && bun run typecheck` passes | FAIL (pre-existing) — TS4111 in api/devices.ts + api/history.ts, confirmed pre-M19 |
| 3 | `voix-backend/ui && bun run build` produces dist/index.html with `./assets/…` | ✓ |
| 4 | `voix-backend/ui && bun run typecheck` passes | ✓ |
| 5 | packages/ui/src/App.tsx exists; voix-backend/ui/src/App.tsx does not | ✓ |
| 6 | voix-backend/ui/src/main.tsx imports App from @voix/ui | ✓ (11 lines total) |
| 7 | packages/protocol/src/audio-io.ts exists; daemon-side re-export single line | ✓ |
| 8 | HA Add-on Docker build end-to-end | **FAIL** (structural break, Delta C) — Docker daemon down on dev box so couldn't smoke test; code reading confirms it would fail anyway |
| 9 | STATE.md M19 row closed with brief link | ✓ |
| 10 | Tauri `app/` untouched | ✓ |

## Coordinator deltas surfaced by implementer

### Delta C — HA Add-on Docker build structurally broken (HIGH)

`voix-backend/package.json` declares `"@voix/protocol": "workspace:*"`.
HA Add-on Docker context is fixed at `voix-backend/`; Docker COPY
cannot escape it. `bun install` inside the image fails to resolve
`workspace:*`. Production HA Add-on reinstall breaks. Dev paths
(local + HA Add-on dev_mode) unaffected.

Three proposed paths in the Dockerfile body:

- **(a) CI vendoring**: pre-`docker build` step copies `packages/`
  into `voix-backend/`. Requires HA Add-on Builder pipeline
  control we don't cleanly have.
- **(b) Drop daemon workspace dep**: revert
  `voix-backend/src/audio_io/protocol.ts` to full content;
  `packages/protocol/` parallel-copies it; manual sync. Gives up
  step 2's "one source of truth" win; unblocks Docker.
- **(c) Tarball commit**: `bun pack @voix/protocol`, commit under
  `voix-backend/`, depend via `file:./vendor/voix-protocol.tgz`.
  Daemon ships a frozen snapshot at build time; adds commit-time
  ritual.

### Delta D — explicit `.ts` extensions in package imports block Metro `.native` resolution (MEDIUM, M20-deferred)

Internal imports inside `packages/ui/` use explicit `.ts(x)` suffixes
(needed for `allowImportingTsExtensions: true` + bun + Vite source-
only consumption). Metro's `.native.ts` resolution only fires on
extensionless imports — it'll stay on `client.ts` (web variant) on
the native target. Invisible in M19; bites M20.

Fix proposed: strip `.ts(x)` suffixes from internal imports in M20.
Vite + bun work equally well with extensionless under current
tsconfig.

### Delta E — `@types/react-native` removed (MINOR)

Deprecated stub depended on `react-native: "*"`. Removed; added
`react-native` directly as a peer. Avoids confusing peer warnings.

## Cost

- Wall-clock: ~80m (implementer-side, agent run)
- Commits: 6
- Files moved: 13 (via `git mv`, history preserved)
- Files created: 17
- Files modified: 8
