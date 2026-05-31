# voix-backend — Home Assistant Add-on container.
#
# Bun's official Alpine image gives us a small, fast base with Bun
# built in. We add `git` so dev mode can pull straight from the repo
# at runtime (see run.sh).
#
# Two-stage logical layout (still single Docker stage to keep the
# image small):
#   1. Daemon deps + sources baked at /app (production default)
#   2. UI bundle built at image time, lives at /app/ui/dist
# In dev mode the entrypoint clones the live repo into /data and runs
# from there instead — including rebuilding the UI when commits land.
#
# M19 KNOWN-BROKEN note (flagged by Implementer, awaiting coordinator
# decision): the repo is now a bun monorepo (root package.json with
# workspaces). `voix-backend/package.json` declares a workspace dep on
# `@voix/protocol` ("workspace:*"); `voix-backend/ui/package.json`
# declares deps on `@voix/protocol` and `@voix/ui`. The HA Add-on build
# context is fixed at `voix-backend/` and Docker COPY cannot reach
# files outside the context — so `packages/protocol/` and
# `packages/ui/` aren't visible inside this build. `bun install` here
# will fail to resolve `workspace:*` and exit non-zero.
#
# Dev paths are unaffected:
#   - local `bun --watch src/index.ts` works via the workspace symlink
#   - HA Add-on dev_mode clones the whole repo to /data/voix-dev and
#     runs `bun install` from the workspace root (see run.sh)
#
# Production HA Add-on image install will break until one of:
#   (a) a CI pre-build step vendors packages/ into voix-backend/ before
#       docker build runs (HA Add-on Store doesn't run such a step)
#   (b) the daemon stops depending on @voix/protocol at runtime — keep
#       voix-backend/src/audio_io/protocol.ts as the canonical types,
#       drop the workspace dep, accept manual sync between it and
#       packages/protocol/src/audio-io.ts
#   (c) a tarball/bundle of @voix/protocol is committed under
#       voix-backend/ and the Dockerfile COPYs that
# M20+ will decide which path to take.
#
# Pre-existing comment: We drop `--frozen-lockfile` because the
# canonical lockfile now lives at the repo root and isn't in this
# build context. Trade-off: image builds are reproducible only up to
# version-range resolution, not pinned-tree resolution. Acceptable
# trade if AC8 is solved by (a)/(b)/(c) above.

FROM oven/bun:1-alpine

# Git is required for dev mode. ca-certificates so HTTPS clones work.
# jq is used by run.sh to parse /data/options.json from the Supervisor.
RUN apk add --no-cache git ca-certificates jq

WORKDIR /app

# Daemon dependency layer first — source changes don't bust the dep
# cache.
COPY package.json ./
RUN bun install --production

COPY src ./src
COPY tsconfig.json ./tsconfig.json

# UI: install + build inside the image so /app/ui/dist ships ready to
# serve. Adds ~250 KB of static assets to the final image.
COPY ui/package.json ui/tsconfig.json ui/vite.config.ts ui/index.html ./ui/
COPY ui/src ./ui/src
RUN cd ui && bun install && bun run build && rm -rf node_modules

COPY run.sh /run.sh
RUN chmod +x /run.sh

# Default WS port. Add-on options override via env, but declared here
# so `docker inspect` shows the intent.
EXPOSE 8765

# Stay root so dev mode can write to /data and re-install deps. The
# previous version dropped to the `bun` user; that breaks dev pulls
# because /data is owned by root in HA Add-on Supervisor.
ENTRYPOINT ["/run.sh"]
