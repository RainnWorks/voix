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
  log "production mode — running /app/src/index.ts"
  cd /app
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

cd "${DEV_DIR}/voix-backend"
log "running bun install"
bun install --silent

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
      log "new commit ${new_sha} (was ${old_sha}) — reset + reinstall"
      git reset --hard "origin/${DEV_BRANCH}"
      cd "${DEV_DIR}/voix-backend"
      bun install --silent
    fi
  done
) &

log "starting bun --watch (PID 1)"
exec bun --watch src/index.ts
