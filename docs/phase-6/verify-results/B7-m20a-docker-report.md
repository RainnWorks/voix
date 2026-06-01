# B7 — M20a: HA Add-on Docker context shift

**Task #147.** Unblocks the production (stable-channel) HA Add-on install,
which was broken because the add-on's web UI declares `workspace:*` deps
on `@voix/ui` + `@voix/protocol` (in `packages/`) that the old
`voix-backend/`-only Docker build context couldn't resolve. Only
`dev_mode` (clones the full repo at boot) worked.

**Status: DONE on source + locally verified.** One Tom go-live step
remains (publish + make GHCR packages public) — documented below; not a
blocker for the code work.

---

## The wall (verified against HA docs) and how we got around it

The task's primary plan was "shift the Supervisor's Docker build context
to the repo root." **That is not possible** — confirmed against
[developers.home-assistant.io/docs/add-ons/configuration](https://developers.home-assistant.io/docs/add-ons/configuration/):

- The Supervisor's **local builder pins the Docker build context to the
  add-on directory** (`voix-backend/`). There is no config field to set a
  parent-dir context or an external Dockerfile path.
- `build.yaml` (which historically held `build_from`/`args`/`labels`) is
  **deprecated / no longer read**; build options moved into the
  Dockerfile (`FROM`, `ARG`, `LABEL`).
- The `image:` field in `config.yaml` makes the Supervisor **pull a
  prebuilt image from a registry instead of building locally.**

So the only way to give the build the full workspace is to **build the
image ourselves (from the repo root, where the build context is
unrestricted) and have the Supervisor pull it.** This is cleaner than
the task's fallback (vendoring `packages/` into `voix-backend/` in CI) —
no duplication, no committed copies. The fallback's `cp -r packages/`
step is unnecessary once the build runs from root.

---

## What changed

### 1. `voix-backend/Dockerfile` — build context = repo root
- Copies workspace root manifests + `bun.lock` + `tsconfig.base.json`,
  then `packages/` + `voix-backend/{src,ui}`. **`clients/*` is excluded.**
- `bun install --filter './voix-backend' --filter './voix-backend/ui'`
  installs only the daemon + UI dependency closure (which includes the
  `@voix/*` workspace links). The root package's own RN deps and
  `clients/*` are skipped — verified: **0 `react-native` packages** in
  the image's `node_modules`.
- `--frozen-lockfile` intentionally omitted: `clients/*` isn't in the
  context, so the resolved workspace set is a strict subset of the
  lockfile's and bun would reject it as drift.
- Image mirrors the monorepo (`/app/voix-backend/...`) so the daemon's
  `import.meta`-relative UI-dist path (`src/ui/route.ts`) and workspace
  `node_modules` resolution both work unchanged.

### 2. `.dockerignore` (new, repo root)
Keeps `node_modules`, `.git`, `clients/` (14 GB of iOS/macOS build
trees!), `dist/`, `.pioenvs`, `.esphome`, `docs/` out of the build
context. Without it, `docker build .` would ship the whole monorepo.

### 3. `voix-backend/run.sh` — production branch
Runs from `/app/voix-backend` (was `/app`) to match the new layout. Dev
mode unchanged.

### 4. Protocol parallel-copy kludge retired
- `voix-backend/src/audio_io/protocol.ts` → `export * from "@voix/protocol"`
  (daemon's relative imports unchanged).
- Added `@voix/protocol: workspace:*` to the daemon's deps.
- Deleted `scripts/check-protocol-sync.sh`; removed it from `bun run
  check` (root `package.json`); cleared the `SYNC NOTE` headers.
  `packages/protocol/src/audio-io.ts` is the single source of truth again.
- This is safe **because** the production build now runs from the repo
  root (and dev_mode always cloned the full repo), so `@voix/protocol`
  resolves everywhere.

### 5. `voix-backend/config.yaml` — `image:` field
`image: ghcr.io/rainnworks/voix-backend-{arch}` → Supervisor pulls
instead of local-building. `{arch}` → `aarch64`/`amd64`; tag tracks
`version`.

### 6. `.github/workflows/addon-publish.yml` (new)
Builds the image **from the repo root**, per-arch
(`aarch64`→`linux/arm64`, `amd64`→`linux/amd64`) via buildx+QEMU, and
pushes to GHCR on `addon-v*` tags or manual dispatch. Auth = built-in
`GITHUB_TOKEN` (`packages: write`).

### 7. `docs/build-workflow.md`
Removed operating rule #10 (the protocol.ts sync rule), marked the M20a
phase-map row ✅, fixed the header milestone note, dropped "protocol
sync" from the CI checks table, and added a new **"HA Add-on image
(Docker)"** section documenting the build + the go-live steps.

---

## Verification (all local, all green)

| Check | Result |
|---|---|
| `docker build -f voix-backend/Dockerfile .` (repo root) | ✅ succeeds (image 466 MB) |
| Image `node_modules` has react-native | ✅ 0 packages (clients excluded) |
| `@voix/ui` + `@voix/protocol` resolve in image | ✅ (UI builds in-image to `dist/`) |
| Container boots (production mode) | ✅ registers providers, seeds 6 voices, `listening on :8765` |
| `GET /api/voices` | ✅ returns the 6 built-in voices JSON |
| `GET /` | ✅ serves the bundled web UI HTML |
| Runtime `@voix/protocol` resolution via re-export | ✅ (full boot through the import graph) |
| `bun run check` (root) | ✅ (protocol-sync no longer present) |
| `bun run typecheck` (daemon) | ✅ `tsc --noEmit`, 0 errors |
| `bun test` (daemon) | ✅ 140 pass / 0 fail |
| `bun run build` (web UI, local) | ✅ 348 modules, built in 660 ms |
| `config.yaml` + `addon-publish.yml` YAML parse | ✅ |

---

## Remaining go-live step (Tom — one-time, NOT blocking)

The code is done; the production install flips on with:

1. **Cut an `addon-v0.1.0` tag** (matching `config.yaml` `version`) →
   `addon-publish.yml` builds + pushes `voix-backend-aarch64` and
   `voix-backend-amd64` to GHCR.
2. **Make both GHCR packages public** under `github.com/RainnWorks` so
   the Supervisor can pull them anonymously (GHCR packages are private
   on first publish).
3. On each later release: bump `version` + cut a new `addon-v*` tag.

I can't perform these from here (no registry credentials / GH package
visibility control), and a CI publish can't be triggered without a push
event I don't control. Until then **`dev_mode` remains the working
install path** (unchanged) — so this is not a regression: production was
already broken, and the new `image:` path is the forward fix.

> Note: with `image:` set, the Supervisor will try to PULL on install.
> Before the first publish that pull 404s — but the add-on is
> pre-acceptance (no production users yet) and `dev_mode` is unaffected,
> so this is the intended sequencing, not a break.

---

## Commits (pushed to `main`)

| SHA | Subject |
|---|---|
| `08644c0` | build(addon): shift Docker build context to repo root (M20a) |
| `0224f01` | refactor(protocol): drop parallel-copy kludge, re-export @voix/protocol (M20a) |
| `33a591f` | ci(addon): publish prebuilt image to GHCR; config.yaml pulls it (M20a) |
| _(this commit)_ | docs(build-workflow): retire protocol-sync rule, document Add-on image + B7 report |
