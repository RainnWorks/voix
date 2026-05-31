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
# Monorepo note (M19 fix-pass): the repo is a bun workspace root. The
# daemon's package.json deliberately declares NO workspace:* deps so
# this image can build the daemon from the voix-backend/ context
# alone. The wire-protocol types are parallel-copied at
# voix-backend/src/audio_io/protocol.ts and
# packages/protocol/src/audio-io.ts — see the SYNC NOTE headers in
# both files; scripts/check-protocol-sync.sh enforces parity.
#
# UI caveat: voix-backend/ui/package.json still has workspace:* deps
# on @voix/ui + @voix/protocol. The `cd ui && bun install` step below
# can't resolve those from inside this image (packages/ lives outside
# the build context). For M19 the HA Add-on dev_mode path (run.sh
# clones the whole repo + installs from the workspace root) is the
# only supported install path. Production HA Add-on Store install
# remains broken; M20a will land a pre-build vendoring step.
#
# `--frozen-lockfile` is dropped because the canonical lockfile lives
# at the repo root and isn't in this build context. Image builds are
# reproducible only up to version-range resolution, not pinned-tree
# resolution. Acceptable trade-off given the daemon's dep surface is
# small + well-pinned.

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
