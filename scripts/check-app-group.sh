#!/usr/bin/env bash
# check-app-group.sh — guard for M24 Risk 4.
#
# Confirms both host (voix) and extension (VoixKeyboard) targets
# declare the same App Group, group.co.rowm.voix. If the entitlements
# files drift apart, FileManager.containerURL returns nil silently on
# the extension side and the keyboard cannot read its own state file
# — the very subtle failure mode Architect flagged.
#
# Run before each M24 step's commit; CI-friendly (exits non-zero on
# drift).
set -euo pipefail

GROUP="group.co.rowm.voix"

HOST_ENTITLEMENTS="clients/app/ios/voix/voix.entitlements"
EXT_ENTITLEMENTS="clients/app/ios/VoixKeyboard/VoixKeyboard.entitlements"

fail=0

for f in "$HOST_ENTITLEMENTS" "$EXT_ENTITLEMENTS"; do
  if [[ ! -f "$f" ]]; then
    echo "check-app-group: missing $f" >&2
    fail=1
    continue
  fi
  if ! grep -q "$GROUP" "$f"; then
    echo "check-app-group: $f does not declare $GROUP" >&2
    fail=1
  fi
done

if [[ $fail -ne 0 ]]; then
  exit 1
fi

echo "check-app-group: OK ($GROUP present in host + extension)"
