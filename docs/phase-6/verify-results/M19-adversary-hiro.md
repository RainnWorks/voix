# Hiro's adversarial review of M19

> Posture: try to break this. Persona: release engineer, scarred by
> three monorepo migrations that shipped silent bugs. Default
> assumption: this introduces more surface than it removes.

## Receipts

Review run: **2026-05-31 11:07 UTC**, against `HEAD = fa638d7`
(baseline `de00987`).

### Files read (`stat -f "%m %z %N"`)

```
1780222826 6732   docs/phase-6/verify-briefs/M19-adversary-hiro.md
1780225659 7851   docs/phase-6/verify-results/M19-implementer-report.md
1780222652 24493  docs/phase-6/architecture-m19.md
1780222767 626    package.json
1780222770 679    tsconfig.base.json
1780223611 114570 bun.lock
1780224967 3408   voix-backend/Dockerfile
1780223084 5119   voix-backend/run.sh
1780223268 797    voix-backend/package.json
1780223251 417    voix-backend/src/audio_io/protocol.ts
1780223401 665    voix-backend/ui/package.json
1780223423 3686   voix-backend/ui/vite.config.ts
1780223606 768    packages/ui/package.json
1780223993 2213   packages/ui/src/index.ts
1780223234 9360   packages/protocol/src/audio-io.ts
1780223954 709    packages/ui/src/conversations/InlineAudioPlayer.tsx
1780223943 836    packages/ui/src/conversations/InlineAudioPlayer.native.tsx
1780223897 6068   packages/ui/src/conversations/TalkButton.tsx
1780223977 9817   packages/ui/src/conversations/ConversationDetail.tsx
1780174001 10453  packages/ui/src/audio_io/client.ts
1780223887 1789   packages/ui/src/audio_io/client.native.ts
```

### Commands run (timestamps approximate, ~11:00 UTC)

| Cmd | Outcome |
|---|---|
| `git log --stat de00987..HEAD` | Six commits, clean one-per-step shape. |
| `git diff de00987..HEAD --stat` | 40 files, +1612 / -697. |
| `bun install` | Clean re-install. "Checked 432 installs … (no changes)". |
| `bun pm ls --all react` | One `react@19.1.4` install. |
| `cd voix-backend/ui && bun run build` | ✓ 325 modules / 573 ms. |
| `cd voix-backend/ui && bun run typecheck` | ✓ passes. |
| `cd packages/ui && bun run typecheck` | ✓ passes. |
| `cd packages/protocol && bun run typecheck` | ✓ passes. |
| `cd voix-backend && bun run typecheck` | ✗ 5 TS4111 (pre-existing). |
| **`bun run dev` (from root)** | **✗ Daemon dies at boot — `SyntaxError: Export named 'Unsafe' not found … @sinclair+typebox@0.27.10`.** |
| **`cd voix-backend && bun src/index.ts`** | **✗ Same error.** |
| `bun -e "import('elysia')"` from voix-backend | **✗ Same error.** |
| `diff de00987:voix-backend/src/audio_io/protocol.ts packages/protocol/src/audio-io.ts` | IDENTICAL. |
| `grep -rn "<audio" packages/ui/src/` | Only `InlineAudioPlayer.tsx`. ✓ |
| `grep -c "implement in M22" voix-backend/ui/dist/assets/*.js` | 0. ✓ |
| `grep -oE 'jsx\("audio"' voix-backend/ui/dist/assets/*.js` | 1 match. ✓ |
| `find packages -name "*.native.*"` | 2 files, each with a sibling non-`.native`. ✓ |

---

## Findings, by severity

### Blockers (must fix before ship)

#### B1 — **`bun run dev` fails immediately: Elysia ↔ typebox version split**

The Implementer self-flagged Delta C (Docker prod) and reported AC2
(daemon typecheck) as "PARTIAL — pre-existing TS4111". That made it
sound like the daemon was fine at runtime in dev. **It is not.**
Cold-running the daemon at HEAD reproduces this every time:

```
$ cd voix-backend && bun src/index.ts
SyntaxError: Export named 'Unsafe' not found in module
'/Users/tom/Projects/voix/node_modules/.bun/@sinclair+typebox@0.27.10/
node_modules/@sinclair/typebox/typebox.js'.
```

What changed:

- **Pre-M19** (`de00987:voix-backend/bun.lock`):
  `@sinclair/typebox@0.34.49` — satisfies Elysia's peer
  `">= 0.34.0 < 1"`.
- **Post-M19** (root `bun.lock`): only
  `@sinclair/typebox@0.27.10` — pulled by Jest's `@jest/schemas`
  (`^0.27.8`), which arrived as a transitive of
  `react-native@0.81.6`. The bun-workspaces hoist resolved a
  single version, and Jest's looser range got it.
- Elysia's `Unsafe` export was added in typebox 0.30+; 0.27.10
  doesn't have it. **Production daemon, dev daemon, and every
  smoke test that starts a server all crash on import.**

The Implementer's claim "AC2 PARTIAL — succeeds; 3 transitive peer
warnings from RN tooling, don't block" is wrong for the version
that matters: Elysia's `@sinclair/typebox` peer is unsatisfied and
the daemon doesn't run. The Implementer never ran the daemon after
the React-Native install; they ran `tsc --noEmit` and called it.

This is exactly the hoisting weirdness flagged in the brief's
"What I suspect" preamble, just on a different package than
suspicion #2 (React) called out.

Fix options (descending preference):

1. Pin `@sinclair/typebox@^0.34.0` as a direct dep of
   `voix-backend/package.json` and add it to `voix-monorepo`'s root
   `overrides` so Bun's hoist can't downgrade it.
2. Add a Bun `trustedDependencies` / `resolutions` entry forcing
   `@sinclair/typebox: 0.34.49`. (Same effect, cleaner blast radius.)
3. Add `nohoist`-equivalent for `@sinclair/typebox` so it stays
   workspace-local in `voix-backend/node_modules/`. (Bun's
   `nohoist` is per-workspace; the daemon already keeps its own
   `node_modules/@sinclair/typebox@0.34.49` real dir from May 28
   pre-M19, but Bun's isolated installer ignores it.)

#### B2 — **Step 2's smoke test never tested what step 2 broke**

The brief's Decision 9 step 2 smoke test is "daemon typechecks; UI
typechecks; UI builds." Step 2 commit (`6e7937c`) added
`"@voix/protocol": "workspace:*"` to `voix-backend/package.json` —
which simultaneously broke the production HA Add-on Docker build
(can't COPY across the build context) **and** poisoned the
daemon's runtime resolution against typebox (B1 above).

Neither failure shows up in `tsc --noEmit`. Both show up in
`bun src/index.ts` or `docker build`. The brief and the
Implementer's per-step verification both rely exclusively on the
former. **The acceptance contract is structurally blind to the
class of failures that just bit us.**

The Implementer can't be blamed for not exceeding the brief, but
the brief itself is unsafe in monorepo-conversion territory.
Coordinator should add to AC2: `cd voix-backend && bun
src/index.ts &` + wait for ready-banner OR exit. That single
extra line catches both Docker breakage (b/c the daemon doesn't
start) and runtime resolution drift.

### High (fix this milestone or document why not)

#### H1 — **Stale `voix-backend/node_modules/@sinclair/typebox@0.34.49` lying around**

Real directory, not a symlink, dated May 28 (pre-M19). Bun's
isolated installer does not clean local workspace `node_modules/`
when it switches to its own `node_modules/.bun/` store. A
debugger who deletes it (`rm -rf voix-backend/node_modules`) and
re-runs `bun install` reproduces B1 from scratch. Until B1 is
fixed, the only thing standing between us and chaos is whatever
artefact survived. Even after B1 is fixed, this clutter will
mislead the next person reading the tree.

Recommended: a step-1 sub-task to `rm -rf
voix-backend/node_modules voix-backend/ui/node_modules` after
flipping workspaces. The Implementer did this for the lockfile
(`voix-backend/bun.lock` was removed) but skipped the directories.

#### H2 — **`react-native@0.85.3` ghosts in `.bun/` store**

`node_modules/.bun/react-native@0.85.3+c17a4eaa02433b13/` exists
on disk (installed at 12:20 during step 1 before the version pin
was tightened), unreferenced by any current workspace symlink.
Not actively breaking anything *today* — Bun resolves
`react-native` → `react-native@0.81.6` via the lockfile — but:

- It's evidence that the install graph went through an undocumented
  intermediate state. A future `bun install --frozen-lockfile` on
  a fresh checkout will reproduce the right (0.81.6) state, but a
  watching engineer sees both versions present and reasonably
  worries.
- `@react-native/virtualized-lists@0.85.3` is also present with
  the same provenance. It carries a hard `react-native: "0.85.3"`
  dep that pulls 0.85.3 transitively if anything ever resolves
  that virtualized-lists version. We're one careless dep
  promotion away from a real two-versions-of-RN situation, with
  the brief's exact-pin rationale (rn-macos 0.81.7 peer pin)
  silently violated.

Fix: `rm -rf node_modules && bun install` once B1 is fixed,
verify no 0.85 strings appear in `node_modules/.bun/`. Also add
explicit `"resolutions"`/overrides for
`react-native: 0.81.6` and `@react-native/virtualized-lists:
0.81.6` to root `package.json` so the pin survives future RN
sub-package version drift.

#### H3 — **`workspaces: ["clients/*"]` glob points at a directory that doesn't exist**

```bash
$ ls clients
ls: clients: No such file or directory
```

Bun tolerates this today (`bun install` completes clean). Two
silent failure modes downstream:

- Anyone who creates `clients/foo/package.json` without
  understanding workspaces just enrolled it into the root install.
  This is the brief's intent, but it's also the trap the brief
  warned about with `app/`: the workspaces glob is too permissive
  for a phase-bound migration.
- When M20 lands and `clients/app/` is a real React Native CLI app,
  its lockfile contract will be folded into root `bun.lock`. We
  established in B1 that the root install can pick the wrong
  version of a daemon-critical transitive when RN's tooling is in
  the tree. The same exposure will happen for whatever RN-CLI
  introduces.

The brief's Decision 1 even predicts this ("Metro + Bun symlink edge
cases on RN 0.81 … fall back to npm workspaces only for `clients/app/`
if Metro misbehaves"). But that fallback is reactive. **Forward-fix
posture**: declare in the brief that any transitive of RN must NOT
be allowed to override a daemon-declared peer, and enforce via
root `overrides` / `resolutions`. M19 has no such enforcement.

#### H4 — **Coordinator Delta C / D / E status, verified by me**

- **Delta C (Docker break)**: Confirmed at code-reading level — `voix-backend/package.json` declares `"@voix/protocol": "workspace:*"` (line 18), Dockerfile build context is `voix-backend/` (config.yaml is there), `bun install` inside the image can't resolve workspace deps because `packages/protocol/` is above the build context. **The Implementer's analysis is right.** I did not run `docker build` — Docker daemon not available in my shell either — but the reasoning is sound and the Dockerfile comment block (added in `fa638d7`) accurately documents the failure modes.

- **Delta D (Metro `.native` resolution vs explicit `.ts` extensions)**: Confirmed. `packages/ui/src/index.ts:40` says `export { InlineAudioPlayer } from "./conversations/InlineAudioPlayer.tsx";` — the `.tsx` suffix is explicit. Metro's `.native.tsx` platform resolution fires only on extensionless module specifiers. Web works (the explicit `.tsx` lands directly on `InlineAudioPlayer.tsx`, and Vite's `ignoreNativeSuffixes` plugin would have stripped a `.native` anyway). Native will silently load the web file. Implementer's M20-deferral is correct; the brief should be amended to forbid explicit `.ts(x)` extensions in package-public re-exports for any module that has a `.native.*` companion. Otherwise we re-discover this every time we add a split.

- **Delta E (`@types/react-native` removal)**: Confirmed — gone from `voix-backend/ui/package.json`, gone from root `bun.lock`. But the stale install at `/node_modules/.bun/@types+react-native@0.73.0+00482aeb9a5c65ca/` still sits there (its content is a tiny deprecation stub with no `index.d.ts`, so it has zero effect at type-check time). Same H1 hygiene gripe applies. Annoying, not breaking.

### Medium (fix-or-defer; default fix)

#### M1 — **Brief AC1 ("no unresolved peer warnings") wasn't actually verified**

The Implementer reports "PARTIAL — succeeds; 3 transitive peer
warnings from RN tooling, don't block." They give zero detail on
*which* peers were unresolved. Given B1 (Elysia's typebox peer is
violated, which is itself a peer warning), at least one of those
"don't block" warnings was load-bearing and should have been
escalated. **AC1 needs the actual warning text captured in the
report, not summarised away.**

#### M2 — **Vite resolver plugin's edge cases are fine but undocumented**

Audited
`voix-backend/ui/vite.config.ts:26-56`. The plugin correctly:

- Skips when source is `.native`, `.native.ts`, or `.native.tsx` (so
  explicit imports work).
- Only intercepts relative / absolute paths (package-name resolves
  pass through).
- Delegates to the default resolver, then post-strips `.native` if
  the result landed there.

Suspicion 1 from the brief asked whether it handled `.native.tsx`,
nested paths, and `index.native.ts` style. It does — the regex
`/\.native(\.tsx?)$/` covers all of those. **Suspicion 1 REFUTED.**

But: the plugin has an asymmetric failure if a `.native.ts` exists
**without** a non-native sibling. The post-strip would return null
or fall back to the same delegate, and the consumer gets a
"module not found" at build time. Today every `.native` has a
sibling (`audio_io/client.ts`, `conversations/InlineAudioPlayer.tsx`),
verified. But there's no test or assertion that enforces this
invariant. M20+ will add more native splits; one missing sibling
later, a quiet Vite warning, and prod ships missing UI.

Recommend: add a build-time check (a 10-line script run in
`prebuild`) that walks `packages/ui/src/`, finds every
`*.native.*`, and asserts a non-native sibling exists. Cheap
insurance.

#### M3 — **`voix-backend/ui/tsconfig.json` re-declares `paths`, defeating the base**

```json
// tsconfig.base.json
"paths": {
  "@voix/protocol": ["packages/protocol/src/index.ts"],
  "@voix/ui": ["packages/ui/src/index.ts"]
}

// voix-backend/ui/tsconfig.json  ← extends base, then overrides
"paths": {
  "@voix/protocol": ["../../packages/protocol/src/index.ts"],
  "@voix/ui": ["../../packages/ui/src/index.ts"]
}
```

The local override is needed because TS path mappings resolve
relative to the config file with `baseUrl` (and the base's
`baseUrl: "."` points to the root, so a consumer that sets its own
`baseUrl` needs to re-pin). Functionally correct, but it makes
the base's path map dead code for the only consumer that
inherits it today. If a future workspace inherits the base
without re-declaring, their imports silently fail.

Recommend: either drop the path map from the base (each leaf
declares its own) or keep the base's map and make leaves point
at it with relative inheritance documented as required. Right
now we have the worst of both worlds — duplication AND fragility.

#### M4 — **Workspaces install discards lockfile-frozen guarantees in production**

`voix-backend/Dockerfile:65` dropped `--frozen-lockfile`. The
comment justifies it ("canonical lockfile lives at repo root, not
in build context"), but the *effective* downside is that every
production HA Add-on rebuild does a fresh registry-side resolve.
Any drift between maintainers running `bun install` locally and a
release build will land silently. This was true pre-M19 but at
least there was a per-workspace lockfile to fall back on; now
there's none in the Docker context. Multiply by the typebox drift
in B1 and the surface area is real.

Fix paths overlap with Delta C's (a/b/c). I'd push hard for
**vendoring `packages/protocol` into `voix-backend/` at CI time**
(option a) — same blast radius as option c but no manual
synchronisation ritual.

### Low (nits, future-Hiro problems)

#### L1 — Implementer's report claims "Files moved: 13 (via `git mv`, history preserved)"

I see this verified in the diff stats — files appear as renames,
not adds/deletes. Good. No finding.

#### L2 — `clients/` glob will trigger Bun warnings if someone runs `bun install` on macOS with `clients/.DS_Store`

Trivial. Future-you problem.

#### L3 — Commit shape audit — clean

`build-workflow.md` says "one milestone = clean commit per step."
Six commits, six steps' worth (1, 2, 3, 4, 6 + Dockerfile
followup). The followup is its own commit (`fa638d7`),
distinguished from the step commits. No mixed-purpose commits.

#### L4 — `package.json:14` `scripts.dev` runs `bun run --filter voix-backend dev` — which currently fails (B1)

The root-level `dev` script is dead until B1 is fixed. Mention in
the README / STATE update so a new contributor doesn't waste an
hour.

---

## Architectural pushback

### Decision 2 — single `packages/ui` vs three-package split

The brief argues a single package keeps imports trivial and that
`.native.ts` suffixes plus a Vite plugin handle the divergence.
That's accurate **mechanically**, but it doesn't address the
*social* failure mode I've watched eat three monorepos:

- The split between web-safe and native-safe imports lives entirely
  in human discipline. Someone in M22, under deadline, will
  `import { localStorage } from "../platform/storage.ts"` directly
  rather than wrap it in a `.native.ts` companion. Today that
  works on web. Tomorrow on native it explodes. There's no lint
  rule, no CI assertion, no boundary type.
- Decision 7 (Asset strategy) names `Icon.tsx` + `Icon.native.tsx`
  as the pattern. Nothing in `packages/ui/` enforces that all
  web-only APIs go through a similar wrapper.

**What's missing**: an architectural rule that no source under
`packages/ui/src/` may reference DOM/Web APIs except through a
`.native.ts`-companion'd module. Enforce via:

- a `biome` or `eslint-no-restricted-imports` rule rejecting any
  reference to `document`, `window`, `localStorage`, `MediaStream`,
  `AudioContext`, `crypto.subtle`, etc. from files without a
  `.native.ts` sibling;
- a CI check that lists every `.native.*` file, asserts a non-native
  sibling exists, and asserts each web-only import lives only in
  the non-native file (i.e. fails if `theme.ts` directly references
  `document`).

Without this, the "we'll move to multi-package later if needed" stance
is wishful — by then there will be six unaudited DOM leaks and the
M22 implementer will be debugging them at midnight.

### `@voix/protocol` lifting — what enforces wire-shape parity?

The architect's justification ("daemon and UI both consume the
same source") is sound, but the post-lift state has:

- `packages/protocol/src/audio-io.ts` — canonical types.
- `voix-backend/src/audio_io/protocol.ts` — `export * from "@voix/protocol";`

That's a single source of truth in source, but **two physical
locations on production endpoints** if Delta C is solved via option
(b) (drop the workspace dep and parallel-copy) or option (c)
(tarball commit). The brief's Delta C mitigations all degrade the
"one source" guarantee they were designed to enforce. **Until Delta
C is resolved with option (a) — vendoring at CI time — the
architectural win of @voix/protocol is undelivered.**

This isn't an M19 fix; it's a reminder that M19's headline win
(shared protocol types) is mortgaged against Delta C, and the
mortgage is real.

### 5-step migration order — `bun run build exit 0` is not a sufficient guard

Already argued under B2. The brief's smoke test is too narrow for
the failure modes that monorepo conversions actually produce. A
build-passes / typecheck-passes pair lets the daemon-boot failure
of B1 through unobstructed. **Detection upgrade**: every step's
smoke test must include `start the daemon and confirm a healthy
ready-banner`, not just compile-time checks. Implementer cost:
about 5 lines per step (`bun src/index.ts & sleep 2; curl
localhost:8765/health; kill %1`).

### `app/` workspaces glob — clean

Brief asked me to verify the workspaces glob doesn't inadvertently
pick up the `app/` Tauri relic. Verified:

```json
"workspaces": ["voix-backend", "voix-backend/ui", "packages/*", "clients/*"]
```

`app/` is explicitly excluded. `app/package.json` exists with its
own `package-lock.json`; Bun does not enter `app/` during install.
**No finding.**

---

## The 3-week prediction

> A new contributor (or me, returning to this in three weeks) will
> run `bun install` on a fresh checkout, see "no changes", run `bun
> run dev` to start the daemon, get the typebox `Unsafe` syntax
> error, and lose 90+ minutes chasing it through Elysia, Bun, and
> Sinclair issue trackers — because nothing in CLAUDE.md, the M19
> brief, or the Implementer's report names `@sinclair/typebox` as
> the load-bearing transitive that monorepo-hoist downgraded.

That's B1 cashed in. More specifically, my falsifiable claim for
M22 scoring:

**Between now and M22, exactly one of the following will happen:**

1. Someone bisects the daemon-startup regression and lands a
   `resolutions` / `overrides` fix that pins
   `@sinclair/typebox: ^0.34.0` and they will commit-message it
   without mentioning M19. Cost: ≥ 60 minutes of debug + write-up.

2. The HA Add-on Builder pipeline tries to ship a Phase-6 release
   and fails because `bun install` inside the Docker build can't
   resolve `@voix/protocol: workspace:*` (Delta C). Time-to-fix
   measured in hours, blocking whatever was scheduled for that
   release window.

3. M22's RN client work installs additional RN transitives that
   bump the conflict surface — another peer pin gets silently
   downgraded (likely candidates: `metro-runtime`, `babel-core`,
   or a JSC variant). Symptom will look unrelated to M19. Will
   take ≥ 4 hours to root-cause.

If by 2026-06-21 none of these has happened, my prediction
fails — I will personally write the post-mortem.

---

## Summary verdict

The Implementer hit 6/10 ACs cleanly, surfaced AC8 (Delta C) as a
documented coordinator decision, and self-flagged Deltas D and E
correctly. The brief's mechanical asks (lift `@voix/protocol`,
move UI files, suffix split, Dockerfile annotate) are technically
delivered.

**But the verification methodology missed a daemon-runtime
regression** — B1 — that the brief's smoke tests were structurally
incapable of catching. M19 cannot ship without resolving B1; it
cannot ship sustainably without B2's process upgrade.

Empty-Blockers would have been suspicious. Two Blockers, four
Highs, and four Mediums is appropriate weight for a monorepo
conversion that touched dependency hoisting on a daemon with strict
peer pins. Recommend: M19 status downgrade from "complete" to
"complete with B1 + B2 followup required before any M20 work
starts."
