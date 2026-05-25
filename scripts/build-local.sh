#!/usr/bin/env bash
#
# build-local.sh — compile our Voice PE firmware locally (Mac) instead of via
# the HA dashboard. ~5× faster once the PlatformIO toolchain + cache are warm.
#
# Usage:
#   scripts/build-local.sh                  # compile only
#   scripts/build-local.sh upload [ip]      # compile + OTA upload
#   scripts/build-local.sh logs [ip]        # stream device logs
#
# Defaults to the 095e4e device YAML and resolves the device IP via HA's mDNS
# (since DHCP keeps reassigning it). Override with the second arg.
#
# Pre-requisites:
#   pip install --user 'esphome==2026.5.1'
#   esphome/secrets.yaml present (one-time: scp root@<ha>:/config/esphome/secrets.yaml esphome/)
set -euo pipefail

cd "$(dirname "$0")/.."

YAML="${VOIX_YAML:-esphome/home-assistant-voice-095e4e.yaml}"
CMD="${1:-compile}"
DEVICE_ARG="${2:-}"

if [[ ! -f esphome/secrets.yaml ]]; then
  echo "ERR: esphome/secrets.yaml missing. Fetch with:" >&2
  echo "  scp root@<ha-host>:/config/esphome/secrets.yaml esphome/" >&2
  exit 1
fi

export PATH="$HOME/Library/Python/3.14/bin:$PATH"

case "$CMD" in
  compile)
    exec esphome compile "$YAML"
    ;;
  upload|run|logs)
    if [[ -z "$DEVICE_ARG" ]]; then
      DEVICE_ARG=$(ssh "${HA_HOST:-root@192.168.96.15}" "getent hosts home-assistant-voice-095e4e.local 2>/dev/null | awk '{print \$1}'" | head -1 || true)
      [[ -z "$DEVICE_ARG" ]] && { echo "ERR: could not resolve device IP via HA host" >&2; exit 1; }
    fi
    echo "==> device: $DEVICE_ARG"
    exec esphome "$CMD" "$YAML" --device "$DEVICE_ARG"
    ;;
  *)
    echo "Usage: $0 [compile|upload|run|logs] [ip]" >&2
    exit 2
    ;;
esac
