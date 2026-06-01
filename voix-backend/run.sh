#!/bin/sh
# voix-backend HA Add-on entrypoint.
#
# Two startup modes:
#
#   • **Production** (`dev_mode=false`, default): runs the baked-in
#     code from /app. The Dockerfile already COPY'd src + ran
#     `bun install` at build time. Just `bun src/index.ts`.
#
#   • **Dev** (`dev_mode=true`): clones (or pulls) the live git repo
#     into /data/voix-dev/ at startup, polls every DEV_POLL_S seconds
#     for new commits, and resets the working tree on each new HEAD.
#     `bun --watch` picks up source changes and restarts the daemon.
#
# Why /data: HA Add-on Supervisor mounts /data as the persistent
# volume — survives container rebuilds, doesn't get wiped on add-on
# upgrades. The dev clone lives there so we don't need to re-clone
# from scratch on every restart.
#
# Why poll instead of webhook: webhooks need a public-facing URL.
# Polling from the add-on side keeps the dev setup zero-network-config
# — works behind any NAT / firewall.

set -eu

# Read dev-mode options from /data/options.json. The Supervisor writes
# user-set add-on options there; env-var overrides win (useful for local
# `bun start` outside the container — env.ts handles app-level config
# the same way).
OPTIONS_JSON=/data/options.json
if [ -f "${OPTIONS_JSON}" ] && command -v jq >/dev/null 2>&1; then
  DEV_MODE_DEFAULT=$(jq -r '.dev_mode // false' "${OPTIONS_JSON}")
  DEV_REPO_DEFAULT=$(jq -r '.dev_repo // "https://github.com/RainnWorks/voix.git"' "${OPTIONS_JSON}")
  DEV_BRANCH_DEFAULT=$(jq -r '.dev_branch // "main"' "${OPTIONS_JSON}")
  DEV_POLL_S_DEFAULT=$(jq -r '.dev_poll_s // 30' "${OPTIONS_JSON}")
else
  DEV_MODE_DEFAULT=false
  DEV_REPO_DEFAULT=https://github.com/RainnWorks/voix.git
  DEV_BRANCH_DEFAULT=main
  DEV_POLL_S_DEFAULT=30
fi

DEV_MODE="${DEV_MODE:-${DEV_MODE_DEFAULT}}"
DEV_REPO="${DEV_REPO:-${DEV_REPO_DEFAULT}}"
DEV_BRANCH="${DEV_BRANCH:-${DEV_BRANCH_DEFAULT}}"
DEV_POLL_S="${DEV_POLL_S:-${DEV_POLL_S_DEFAULT}}"

log() { printf "[run.sh] %s\n" "$*"; }

if [ "${DEV_MODE}" != "true" ] && [ "${DEV_MODE}" != "1" ]; then
  log "production mode — running /app/voix-backend/src/index.ts"
  # M20a: the image now mirrors the monorepo layout (build context =
  # repo root), so the daemon lives under voix-backend/ with the
  # workspace root one level up at /app for node_modules resolution.
  cd /app/voix-backend
  exec bun src/index.ts
fi

# ─── Dev mode ──────────────────────────────────────────────────────────
DEV_DIR=/data/voix-dev
log "dev mode — repo=${DEV_REPO} branch=${DEV_BRANCH} poll=${DEV_POLL_S}s"

if [ ! -d "${DEV_DIR}/.git" ]; then
  log "cloning ${DEV_REPO} → ${DEV_DIR}"
  # Shallow clone keeps startup fast on slow internet — full history
  # isn't needed for a runtime checkout.
  rm -rf "${DEV_DIR}"
  git clone --depth 50 --branch "${DEV_BRANCH}" "${DEV_REPO}" "${DEV_DIR}"
else
  log "existing checkout — fetching latest"
  cd "${DEV_DIR}"
  git fetch --depth 50 origin "${DEV_BRANCH}"
  git reset --hard "origin/${DEV_BRANCH}"
fi

cd "${DEV_DIR}"
log "running bun install (workspace root)"
bun install --silent

# Build the UI bundle into voix-backend/ui/dist so the daemon's
# /api/ui route has something to serve. Cheap (~600 ms) on top of the
# rest of boot. The workspace install above hoisted the UI deps, so
# we just need to invoke the build script.
log "building UI"
( cd voix-backend/ui && bun run build >/dev/null 2>&1 ) || \
  log "UI build failed — daemon will start but / will 404 until next pull"

cd "${DEV_DIR}/voix-backend"

# Background poller — every DEV_POLL_S, check for new commits and
# reset the tree. `bun --watch` notices the file changes and restarts
# automatically.
(
  while true; do
    sleep "${DEV_POLL_S}"
    cd "${DEV_DIR}" || exit 0
    old_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
    if ! git fetch --depth 50 origin "${DEV_BRANCH}" 2>/dev/null; then
      log "fetch failed — will retry next tick"
      continue
    fi
    new_sha=$(git rev-parse "origin/${DEV_BRANCH}" 2>/dev/null || echo "")
    if [ -n "${new_sha}" ] && [ "${old_sha}" != "${new_sha}" ]; then
      log "new commit ${new_sha} (was ${old_sha}) — reinstall + reset"
      # Bring in just the new package.json files + root bun.lock FIRST.
      # This doesn't touch any src/ files, so bun --watch won't reload
      # yet. M19: root package.json + bun.lock is canonical; nested
      # workspace bun.lock files no longer exist.
      git checkout "origin/${DEV_BRANCH}" -- package.json bun.lock voix-backend/package.json voix-backend/ui/package.json || true
      # Install from repo root so workspace resolution works.
      ( cd "${DEV_DIR}" && bun install --silent )
      # NOW reset everything. bun --watch sees the src changes and
      # reloads — with the new deps already in node_modules.
      git reset --hard "origin/${DEV_BRANCH}"
      # Rebuild the UI bundle. The daemon's static route serves the
      # built dist/, so without this step UI changes don't surface.
      ( cd "${DEV_DIR}/voix-backend/ui" && bun run build >/dev/null 2>&1 ) || \
        log "UI rebuild failed — keeping previous bundle"
      cd "${DEV_DIR}/voix-backend"
    fi
  done
) &

log "starting bun --watch (PID 1)"
exec bun --watch src/index.ts
