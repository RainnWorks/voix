#!/usr/bin/env bash
#
# deploy.sh — sync a Voice PE device config from this repo to the HA host
# and trigger compile + OTA via the ESPHome dashboard's WebSocket API.
#
# Usage:
#   scripts/deploy.sh [device-name] [device-ip]
#
# Default device-name: home-assistant-voice-095e4e
# Default device-ip:   resolves home-assistant-voice-<name>.local via the HA host
#
# Required env vars (loaded from .env if present):
#   HA_HOST          — ssh target for the HA host, e.g. root@192.168.96.15
#   ESPHOME_DASHBOARD_URL — defaults to http://192.168.96.15:6052
#
# What it does:
#   1. Validates that esphome/<device-name>.yaml and esphome/voice-pe.yaml exist.
#   2. scp's both files to /config/esphome/ on the HA host.
#   3. Triggers compile + OTA via scripts/esphome-dash.py.
#
# Why two files: voice-pe.yaml is the reusable package, included by name from
# the consumer YAML. They must travel together.
set -euo pipefail

DEVICE_NAME="${1:-home-assistant-voice-095e4e}"
DEVICE_IP="${2:-}"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# Load .env if present.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

HA_HOST="${HA_HOST:-root@192.168.96.15}"
DASH_URL="${ESPHOME_DASHBOARD_URL:-http://192.168.96.15:6052}"

CONSUMER="esphome/${DEVICE_NAME}.yaml"
PACKAGE="esphome/voice-pe.yaml"

[[ -f "$CONSUMER" ]] || { echo "ERR: $CONSUMER not found in repo"; exit 1; }
[[ -f "$PACKAGE" ]] || { echo "ERR: $PACKAGE not found in repo"; exit 1; }

echo "==> repo: $ROOT"
echo "==> consumer: $CONSUMER"
echo "==> package: $PACKAGE"
echo "==> HA host: $HA_HOST"
echo

echo "==> syncing files to $HA_HOST:/config/esphome/"
scp -q "$PACKAGE" "$HA_HOST:/config/esphome/voice-pe.yaml"
scp -q "$CONSUMER" "$HA_HOST:/config/esphome/${DEVICE_NAME}.yaml"

# Resolve the device IP if not provided.
if [[ -z "$DEVICE_IP" ]]; then
  echo "==> resolving ${DEVICE_NAME}.local on HA host"
  DEVICE_IP="$(ssh "$HA_HOST" "getent hosts ${DEVICE_NAME}.local 2>/dev/null | awk '{print \$1}'" | head -1 || true)"
  if [[ -z "$DEVICE_IP" ]]; then
    echo "WARN: could not resolve ${DEVICE_NAME}.local; OTA will fall back to mDNS"
    DEVICE_IP="OTA"
  fi
fi
echo "==> device IP: $DEVICE_IP"
echo

echo "==> compile + OTA via dashboard"
export ESPHOME_DASHBOARD_URL="$DASH_URL"
exec python3 scripts/esphome-dash.py run "${DEVICE_NAME}.yaml" "port=${DEVICE_IP}"
