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

# History: the `upload` action used to silently re-flash the LAST cached
# binary if compile failed somewhere in the middle (e.g. a header change
# only failed in a free-function context that pulled stale .o files). We
# now ALWAYS compile fresh and verify the binary's mtime advanced before
# uploading. Stale uploads waste hours of debugging time.
BIN_PATH="esphome/.esphome/build/home-assistant-voice-095e4e/.pioenvs/home-assistant-voice-095e4e/firmware.bin"

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
    if [[ "$CMD" == "upload" ]]; then
      # Capture the pre-build mtime so we can verify compile actually
      # produced a fresh binary before letting `upload` run.
      before=$(stat -f "%m" "$BIN_PATH" 2>/dev/null || echo 0)
      echo "==> compiling…"
      esphome compile "$YAML" || { echo "ERR: compile failed — refusing to upload stale binary" >&2; exit 1; }
      after=$(stat -f "%m" "$BIN_PATH" 2>/dev/null || echo 0)
      if [[ "$before" == "$after" ]] && [[ "$after" != "0" ]]; then
        echo "ERR: firmware.bin mtime didn't change — compile likely silently used cached .o files. Aborting." >&2
        echo "     Try: rm -rf esphome/.esphome/build/home-assistant-voice-095e4e/.pioenvs/home-assistant-voice-095e4e/src/esphome/components/voix_realtime_client/" >&2
        exit 1
      fi
      echo "==> compile produced fresh binary (mtime $before → $after)"
      exec esphome upload "$YAML" --device "$DEVICE_ARG"
    fi
    exec esphome "$CMD" "$YAML" --device "$DEVICE_ARG"
    ;;
  *)
    echo "Usage: $0 [compile|upload|run|logs] [ip]" >&2
    exit 2
    ;;
esac
