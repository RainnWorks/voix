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
# M19 note: the repo is now a bun monorepo (root package.json with
# workspaces). The HA Add-on build context is still `voix-backend/`
# (the directory containing config.yaml) — we can't COPY from above
# it. Both `voix-backend/package.json` and `voix-backend/ui/package.json`
# stay declarative and standalone-installable, so `bun install` without
# the workspace-root lockfile works fine inside the image: bun resolves
# against the registry the way it did before workspaces existed. The
# only cost vs. pre-M19 is that we drop `--frozen-lockfile` because the
# canonical lockfile now lives at the repo root and isn't part of this
# build context. Trade-off: image builds are reproducible only up to
# version-range resolution, not pinned-tree resolution. Acceptable for
# now; revisit if bit-for-bit reproducibility becomes a goal.

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
