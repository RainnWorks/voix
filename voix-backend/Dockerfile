# voix-backend — Home Assistant Add-on container.
#
# **Build context = repo root** (M20a). This image is NOT built by the
# HA Supervisor's local builder — that builder pins the context to the
# add-on directory (voix-backend/), which can't reach the monorepo's
# packages/ workspace siblings, so the bundled web UI can never resolve
# its `@voix/ui` / `@voix/protocol` workspace deps. Instead the image is
# built from the repo root in CI (.github/workflows/addon-publish.yml)
# and pushed per-arch to GHCR; config.yaml's `image:` field makes the
# Supervisor *pull* it rather than build locally. See docs/build-workflow.md.
#
#   docker build -f voix-backend/Dockerfile -t voix-backend .   # from repo root
#
# Bun's official Alpine image gives us a small, fast base with Bun
# built in. We add `git` so dev mode can pull straight from the repo
# at runtime (see run.sh).
#
# Layout baked into the image (mirrors the monorepo so workspace
# resolution + the daemon's import.meta-relative UI dist path both
# work unchanged):
#   /app/package.json, /app/bun.lock      — workspace root
#   /app/packages/{protocol,ui}           — shared source packages
#   /app/voix-backend/src                 — daemon
#   /app/voix-backend/ui/dist             — built web UI (served by the daemon)
# In dev mode the entrypoint clones the live repo into /data and runs
# from there instead — including rebuilding the UI when commits land.

FROM oven/bun:1-alpine

# Git is required for dev mode. ca-certificates so HTTPS clones work.
# jq is used by run.sh to parse /data/options.json from the Supervisor.
RUN apk add --no-cache git ca-certificates jq

WORKDIR /app

# ─── Dependency layer ───────────────────────────────────────────────
# Copy only the workspace manifests + lockfile first so source edits
# don't bust the dep cache. We deliberately do NOT copy clients/ — the
# `--filter` install below scopes resolution to the daemon, the web UI,
# and their shared workspace packages, so the RN app's heavy native
# deps (react-native-macos et al.) never enter this image.
COPY package.json bun.lock ./
# Shared tsconfig base — every workspace's tsconfig `extends` this for
# jsx + strictness. The UI build's `tsc` step fails without it.
COPY tsconfig.base.json ./
COPY voix-backend/package.json ./voix-backend/package.json
COPY voix-backend/ui/package.json ./voix-backend/ui/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/ui/package.json ./packages/ui/package.json

# Scoped install: voix-backend + voix-backend/ui pull their full
# dependency closure (which includes @voix/ui + @voix/protocol via the
# workspace links). The root package's own RN deps and clients/* are
# skipped. `--frozen-lockfile` is intentionally omitted: clients/* isn't
# in this context, so the resolved workspace set is a strict subset of
# the lockfile's — bun would reject that as drift. The dep surface here
# is small + well-pinned, so range resolution is an acceptable trade.
RUN bun install --filter './voix-backend' --filter './voix-backend/ui'

# ─── Source layer ───────────────────────────────────────────────────
# Shared packages (consumed by the UI; re-exported by the daemon's
# audio_io/protocol.ts).
COPY packages ./packages

# Daemon sources.
COPY voix-backend/src ./voix-backend/src
COPY voix-backend/tsconfig.json ./voix-backend/tsconfig.json

# Web UI: build inside the image so /app/voix-backend/ui/dist ships
# ready to serve. The daemon resolves dist/ relative to its own source
# location (src/ui/route.ts), so the voix-backend/ subdir must be kept.
COPY voix-backend/ui ./voix-backend/ui
RUN cd voix-backend/ui && bun run build

COPY voix-backend/run.sh /run.sh
RUN chmod +x /run.sh

# Default WS port. Add-on options override via env, but declared here
# so `docker inspect` shows the intent.
EXPOSE 8765

# Stay root so dev mode can write to /data and re-install deps. The
# previous version dropped to the `bun` user; that breaks dev pulls
# because /data is owned by root in HA Add-on Supervisor.
ENTRYPOINT ["/run.sh"]
