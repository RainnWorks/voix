#!/usr/bin/env bash
#
# deploy-ha-integration.sh — sync ha-integration/custom_components/voix
# to /config/custom_components/voix on the HA host, then restart HA core
# and verify it came back up.
#
# Why not rsync: HAOS doesn't ship rsync. We use a tar pipe instead — same
# "make remote match local" semantics, no extra binaries on remote.
#
# Why not `scp -r` alone: scp adds + overwrites, but never deletes. After
# M01 we have files that exist on remote but no longer in local (ws_view.py,
# stt/, post_process.py). Plain scp would leave them around, breaking import
# trees. Tar pipe handles delete cleanly.
#
# Usage:
#   scripts/deploy-ha-integration.sh           # deploy + restart + probe
#   scripts/deploy-ha-integration.sh --no-restart  # deploy only
#   scripts/deploy-ha-integration.sh --dry-run     # show what would change
#
# Env (loaded from .env if present):
#   HA_HOST — ssh target, defaults to root@192.168.96.15
set -euo pipefail

DO_RESTART=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-restart) DO_RESTART=0 ;;
    --dry-run)    DRY_RUN=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

HA_HOST="${HA_HOST:-root@192.168.96.15}"
LOCAL_DIR="ha-integration/custom_components/voix"
REMOTE_DIR="/config/custom_components/voix"

[[ -d "$LOCAL_DIR" ]] || { echo "ERR: $LOCAL_DIR not found in repo" >&2; exit 1; }

echo "==> repo: $ROOT"
echo "==> source: $LOCAL_DIR"
echo "==> target: $HA_HOST:$REMOTE_DIR"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> dry-run: local file list"
  ( cd "$LOCAL_DIR" && find . -type f -not -path '*/__pycache__/*' | sort )
  echo
  echo "==> dry-run: remote file list"
  ssh "$HA_HOST" "find $REMOTE_DIR -type f -not -path '*/__pycache__/*' 2>/dev/null | sed 's|^$REMOTE_DIR/||' | sort" || echo "(remote dir missing)"
  exit 0
fi

# Wipe-then-extract via tar pipe. The remote `rm -rf` cleans every file +
# subdir under $REMOTE_DIR (including the now-deleted ws_view.py, stt/, etc.)
# but preserves the directory itself so we keep its permissions / mount
# point. Tar then writes the new tree in place.
echo "==> syncing (tar pipe)"
# COPYFILE_DISABLE=1 stops macOS BSD tar from embedding `._<file>`
# AppleDouble resource forks. They don't crash HA but they accumulate
# noise + take up the file count budget.
COPYFILE_DISABLE=1 tar --exclude='__pycache__' --exclude='*.pyc' --exclude='._*' \
  -C "$LOCAL_DIR" -cf - . \
  | ssh "$HA_HOST" "
      mkdir -p $REMOTE_DIR &&
      find $REMOTE_DIR -mindepth 1 -delete &&
      tar -C $REMOTE_DIR -xf -
    "

echo "==> verifying remote tree"
ssh "$HA_HOST" "find $REMOTE_DIR -type f | sort | head -20"

if [[ "$DO_RESTART" == "0" ]]; then
  echo
  echo "==> --no-restart: skipping HA core restart"
  exit 0
fi

echo
echo "==> restarting HA core"
# ha core restart blocks until the process is told to restart, but the
# actual reload happens in the background. We poll the API afterwards.
ssh "$HA_HOST" 'ha core restart' &
SSH_PID=$!

echo "==> waiting for HA to come back (up to 90s)"
HA_BASE="http://${HA_HOST#*@}:8123"
ready=0
for i in $(seq 1 18); do
  sleep 5
  # /api/ returns 401 when HA is up (auth required) and connection-refused
  # when it's still down. We don't care about auth, just the TCP+HTTP
  # liveness signal.
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
    "$HA_BASE/api/" 2>/dev/null || true)
  if [[ "$code" == "401" || "$code" == "200" ]]; then
    ready=1
    echo "==> HA up after ~$((i*5))s (HTTP $code)"
    break
  fi
  printf "."
done
echo

wait $SSH_PID 2>/dev/null || true

if [[ "$ready" == "0" ]]; then
  echo "WARN: HA didn't respond within 90s — check ssh $HA_HOST 'ha core logs' manually" >&2
  exit 3
fi

echo
echo "==> last 25 voix log lines"
ssh "$HA_HOST" "ha core logs --no-progress 2>&1 | grep -iE 'voix' | tail -25" || true

echo
echo "==> done. If you see 'voix: ready (connector mode...)' above, M01 deployed clean."
