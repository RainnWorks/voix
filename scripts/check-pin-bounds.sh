#!/bin/sh
# check-pin-bounds.sh — fail if `react-native-worklets` drifts past the
# known-compatible 0.8.x band for our RN 0.81.6 pin.
#
# Decision 13 risk 6 (M21 architecture) — worklets 0.9.x asserts RN
# 0.83+ at the pod level; bumping it silently breaks `pod install` for
# anyone on the 0.81.6 base. The exact pin lives in
# `clients/app/package.json` + root `package.json`; this script asserts
# both call out `0.8.x` and that they agree.
#
# M21-implementer note: brief originally pinned `0.9.0 (exact)`. That
# was incompatible with RN 0.81.6 (Delta C). We pin `0.8.3` instead;
# this script enforces "stays in 0.8.x" rather than "exact 0.8.3" so
# a 0.8.4 patch bump can land without editing this script.
#
# Run via `bun run check`. Cheap (< 50 ms).

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_MAJOR_MINOR='"0\.8\.'

ROOT_PKG="${REPO_ROOT}/package.json"
APP_PKG="${REPO_ROOT}/clients/app/package.json"

# Both should pin react-native-worklets at "0.8.X" (exact, no caret —
# worklets ships breaking changes per minor, the M19 audit's "exact
# pin" pattern carries through).
ROOT_PIN=$(grep '"react-native-worklets"' "${ROOT_PKG}" | sed -n 's/.*: *"\([^"]*\)".*/\1/p')
APP_PIN=$(grep '"react-native-worklets"' "${APP_PKG}" | sed -n 's/.*: *"\([^"]*\)".*/\1/p')

if [ -z "${ROOT_PIN}" ]; then
  echo "check-pin-bounds: react-native-worklets missing from ${ROOT_PKG}" >&2
  exit 1
fi
if [ -z "${APP_PIN}" ]; then
  echo "check-pin-bounds: react-native-worklets missing from ${APP_PKG}" >&2
  exit 1
fi

case "${ROOT_PIN}" in
  0.8.*) ;;
  *)
    echo "check-pin-bounds: ${ROOT_PKG} pins react-native-worklets at ${ROOT_PIN}; expected 0.8.x" >&2
    echo "  M21 Decision 13 risk 6: 0.9.x requires RN 0.83+, we're on RN 0.81.6." >&2
    exit 1
    ;;
esac
case "${APP_PIN}" in
  0.8.*) ;;
  *)
    echo "check-pin-bounds: ${APP_PKG} pins react-native-worklets at ${APP_PIN}; expected 0.8.x" >&2
    echo "  M21 Decision 13 risk 6: 0.9.x requires RN 0.83+, we're on RN 0.81.6." >&2
    exit 1
    ;;
esac

if [ "${ROOT_PIN}" != "${APP_PIN}" ]; then
  echo "check-pin-bounds: react-native-worklets pin disagrees between root and clients/app:" >&2
  echo "  root: ${ROOT_PIN}" >&2
  echo "  app:  ${APP_PIN}" >&2
  exit 1
fi

# Carat caret-disallowed check: enforce exact pin shape (no leading
# `^` or `~`) so bun's resolver can't silently float forward to 0.8.4
# without explicit human intent.
case "${ROOT_PIN}" in
  [\^~]*)
    echo "check-pin-bounds: ${ROOT_PKG} uses range pin '${ROOT_PIN}'; use exact pin without ^ or ~" >&2
    exit 1
    ;;
esac

echo "check-pin-bounds: OK (react-native-worklets pinned at ${ROOT_PIN})"
