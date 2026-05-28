# voix-backend — Home Assistant Add-on container.
#
# Bun's official Alpine image gives us a small, fast base with Bun
# built in. We add `git` so dev mode can pull straight from the repo
# at runtime (see run.sh).
#
# Two-stage build with the prod app baked into /app: in production
# mode that's what `bun src/index.ts` runs. In dev mode the entrypoint
# script clones the live repo into /data and runs from there instead,
# making /app effectively unused. The wasted layer is ~5 MB — acceptable
# trade for having a single image that switches modes via env var.

FROM oven/bun:1-alpine

# Git is required for dev mode. ca-certificates so HTTPS clones work.
RUN apk add --no-cache git ca-certificates jq

WORKDIR /app

# Dependency layer first — source changes don't bust the dep cache.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./tsconfig.json
COPY run.sh /run.sh
RUN chmod +x /run.sh

# Default WS port. Add-on options override via env, but declared here
# so `docker inspect` shows the intent.
EXPOSE 8765

# Stay root so dev mode can write to /data and re-install deps. The
# previous version dropped to the `bun` user; that breaks dev pulls
# because /data is owned by root in HA Add-on Supervisor.
ENTRYPOINT ["/run.sh"]
