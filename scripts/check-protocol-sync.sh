#!/bin/sh
# check-protocol-sync.sh — fail if the two protocol.ts copies have drifted.
#
# Why this exists: M19 left the daemon shipping its own copy of the
# wire-protocol types at voix-backend/src/audio_io/protocol.ts so the
# HA Add-on Docker build (context = voix-backend/) can install without
# reaching outside the context. packages/protocol/src/audio-io.ts is
# the same content, consumed by the UI + future RN client. If the two
# diverge silently, daemon and clients speak different protocols.
#
# Run before any commit that touches either file. Hook this into a
# pre-push hook or CI when one exists; today it's a manual ritual
# documented in docs/build-workflow.md.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="${REPO_ROOT}/voix-backend/src/audio_io/protocol.ts"
B="${REPO_ROOT}/packages/protocol/src/audio-io.ts"

if [ ! -f "${A}" ]; then
  echo "check-protocol-sync: missing ${A}" >&2
  exit 2
fi
if [ ! -f "${B}" ]; then
  echo "check-protocol-sync: missing ${B}" >&2
  exit 2
fi

# Strip the SYNC NOTE header (first 5 comment lines) before diffing —
# each file points at the other, so those lines DON'T match by design.
TMP_A="$(mktemp)"
TMP_B="$(mktemp)"
trap 'rm -f "${TMP_A}" "${TMP_B}"' EXIT INT TERM

tail -n +6 "${A}" > "${TMP_A}"
tail -n +6 "${B}" > "${TMP_B}"

if ! diff -q "${TMP_A}" "${TMP_B}" >/dev/null; then
  echo "check-protocol-sync: DRIFT detected." >&2
  echo "  ${A}" >&2
  echo "  ${B}" >&2
  echo "These files must stay byte-identical below their SYNC NOTE headers." >&2
  echo "Diff:" >&2
  diff "${TMP_A}" "${TMP_B}" >&2 || true
  exit 1
fi

echo "check-protocol-sync: OK"
