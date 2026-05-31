# M19 fix-pass report
Status: SUCCESS

## Receipts

### Files written/modified (stat -f "%m %z %N")

```
1780226524    667 package.json
1780226372 114588 bun.lock
1780226515    898 tsconfig.base.json
1780226233    760 voix-backend/package.json
1780226238    735 voix-backend/tsconfig.json
1780226222   9648 voix-backend/src/audio_io/protocol.ts
1780226302   2858 voix-backend/Dockerfile
1780226228   9652 packages/protocol/src/audio-io.ts
1780226332   1629 scripts/check-protocol-sync.sh
1780226367  18694 docs/build-workflow.md
```

### Commits (git log --oneline -10)

```
5b95afd monorepo(M19 fix): tsconfig paths + clients/* glob — Hiro M3/H3 cleanup
09cebc3 monorepo(M19 fix): revert daemon @voix/protocol dep — parallel-sync resolves Docker + typecheck
5127013 monorepo(M19 fix): pin @sinclair/typebox to unblock daemon boot
fa638d7 monorepo(M19 followup): Dockerfile — flag known-broken AC8
a5547d5 monorepo(M19 step6): STATE — close M19, document workspace shape
d174ee7 monorepo(M19 step4): platform suffix split (+ Delta A InlineAudioPlayer)
d9ee0fb monorepo(M19 step3): @voix/ui — move, don't refactor
6e7937c monorepo(M19 step2): @voix/protocol — shared wire types
e1d71e0 monorepo(M19 step1): root workspace + React 19 bump
5e5c12b docs(phase-6): M19 verify-phase briefs (tester + adversary-Hiro + product-Marina)
```

All three fix commits pushed to origin/main.

## Fix 1 — @sinclair/typebox override

- Commit: `5127013`
- Root `package.json` gained `"overrides": { "@sinclair/typebox": "^0.34.49" }`.
- `bun install` re-resolved; `bun pm ls --all | grep typebox` now shows the single hoisted `@sinclair/typebox@0.34.49`.
- Daemon boot smoke (`cd voix-backend && bun src/index.ts`):

  ```
  11:14:52.043 INFO  voix-backend: voices: first boot — seeded 6 built-in modes
  11:14:52.046 INFO  voix-backend: history: loaded 73 entries
  11:14:52.046 INFO  voix-backend: devices: loaded 2 device records
  11:14:52.046 INFO  voix-backend: context: registered source voix
  11:14:52.046 INFO  voix-backend: boot: HA MCP source not configured (ha_url + ha_token missing) — realtime sessions will run without HA tools/state.
  11:14:52.054 INFO  voix-backend: listening on :8765 (log_level=info)
  ```

  Daemon got past the typebox `Unsafe`-not-found error and reached `listening on :8765`. Confirmed pin holds.

## Fix 2 — revert daemon workspace dep + restore canonical protocol.ts

- Commit: `09cebc3`
- `voix-backend/src/audio_io/protocol.ts`: restored to full content (was `export * from "@voix/protocol";`); SYNC NOTE header added pointing at `packages/protocol/src/audio-io.ts`.
- `packages/protocol/src/audio-io.ts`: SYNC NOTE header added pointing at the daemon copy.
- `voix-backend/package.json`: `"@voix/protocol": "workspace:*"` removed.
- `voix-backend/tsconfig.json`: reverted `baseUrl` + `paths` additions to match pre-M19 shape (file is now byte-identical to pre-M19 modulo path).
- `voix-backend/Dockerfile`: replaced the multi-line M19 KNOWN-BROKEN comment block with a shorter monorepo note. Did NOT restore `--frozen-lockfile` because the canonical lockfile lives at the repo root, not in the daemon build context (no `bun.lock` available inside the `voix-backend/` Docker context).
- `scripts/check-protocol-sync.sh`: created (chmod +x), validates the two protocol.ts copies stay byte-identical below their SYNC NOTE headers. Returns 0 on match, 1 on drift.
- `docs/build-workflow.md`: added Operating rule #10 documenting the parallel-copy + sync ritual.

Smoke tests:

- Daemon typecheck (`cd voix-backend && bun run typecheck`):

  ```
  $ tsc --noEmit
  exit 0
  ```

  AC #2 regression resolved — no TS4111s remaining.

- Daemon boot (`cd voix-backend && bun src/index.ts`):

  ```
  11:19:40.019 INFO  voix-backend: voices: loaded 6 modes
  11:19:40.020 INFO  voix-backend: history: loaded 73 entries
  11:19:40.021 INFO  voix-backend: devices: loaded 2 device records
  11:19:40.021 INFO  voix-backend: context: registered source voix
  11:19:40.021 INFO  voix-backend: boot: HA MCP source not configured (ha_url + ha_token missing) — realtime sessions will run without HA tools/state.
  11:19:40.025 INFO  voix-backend: listening on :8765 (log_level=info)
  ```

- UI build (`cd voix-backend/ui && bun run build`, last lines):

  ```
  vite v6.4.2 building for production...
  transforming...
  ✓ 325 modules transformed.
  rendering chunks...
  computing gzip size...
  dist/index.html                  0.70 kB │ gzip:   0.42 kB
  dist/assets/index-CYY0s67N.js  336.03 kB │ gzip: 104.15 kB │ map: 1,503.85 kB
  ✓ built in 615ms
  exit 0
  ```

  Workspace `@voix/ui` + `@voix/protocol` deps in `voix-backend/ui/package.json` still resolve via the bun workspace symlinks; UI build unaffected.

- `scripts/check-protocol-sync.sh`: created ✓ ; first run → `check-protocol-sync: OK` ✓
- Dockerfile cleaned up: ✓ (M19 KNOWN-BROKEN block removed, shorter note explains remaining UI-install caveat for production HA Add-on builds — dev_mode unaffected)

## Fix 3 — tsconfig paths + clients/* glob

- Commit: `5b95afd`
- `tsconfig.base.json`: dropped `paths` + `baseUrl` from the base. The base's map was dead code because every leaf sets its own `baseUrl` (TS resolves paths relative to whichever tsconfig wins on baseUrl). Each leaf already declares its own `@voix/*` paths; nothing changes functionally but a future workspace inheriting the base without re-declaring won't silently fail.
- `package.json`: removed `clients/*` from `workspaces`. The dir doesn't exist; M20 re-adds.

Smoke tests rerun: ✓ (daemon typecheck exit 0, daemon boot reaches `listening on :8765`, UI build 325 modules in ~593 ms, UI typecheck exit 0, check-protocol-sync OK).

## Issues surfaced beyond the brief

- The `voix-backend/Dockerfile` UI install step (`cd ui && bun install && bun run build`) still depends on workspace symlinks (`voix-backend/ui/package.json` has `@voix/ui` + `@voix/protocol` as `workspace:*`). Fix 2's brief only asked to revert the **daemon's** workspace dep, which it did. The Dockerfile comment now explicitly flags this remaining caveat: production HA Add-on Store install will still fail at the UI step. HA Add-on **dev_mode** (clones the whole repo, installs from workspace root, then builds UI) is unaffected and remains the supported install path until M20.
- `tsconfig.base.json` is now near-empty content-wise. If the next milestone adds zero leaves the base could be removed; for now it still serves as the single place to bump strictness flags.
- `bun.lock` was regenerated when adding the typebox override (Fix 1); no `voix-backend/ui` build regressions and the React 19 install graph is unchanged otherwise.

## Re-verify recommendation

ready-to-reverify

All three blockers (Hiro B1, AC #2 typecheck, AC #8 Docker — partial: daemon-side resolved, UI-side still scoped as M20 work) addressed within the brief's bounds. Daemon typechecks clean, daemon boots clean, UI builds clean, protocol-sync script in place. HA Add-on dev_mode path (the canary) is preserved at every commit because dev_mode never touched the daemon-context `bun install` or the daemon's workspace dep — it always installs from the workspace root.
