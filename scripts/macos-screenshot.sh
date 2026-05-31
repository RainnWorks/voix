#!/usr/bin/env bash
# macos-screenshot.sh — compile + run voix-window-screenshot.swift
#
# Builds the Swift tool to /tmp/voix-window-screenshot (cached, rebuilt
# only when the .swift file is newer) and writes a PNG of the voix
# window to /tmp/voix-macos-window.png (or $1 if passed).
#
# Exits 2 if the Mac is locked — DOES NOT capture the login window
# (the M20 mistake). Exits 3 if no voix window is found.
#
# Usage:
#   bash scripts/macos-screenshot.sh                 # → /tmp/voix-macos-window.png
#   bash scripts/macos-screenshot.sh /tmp/foo.png    # → /tmp/foo.png

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
src="$repo_root/tools/voix-window-screenshot/voix-window-screenshot.swift"
bin="/tmp/voix-window-screenshot"
out="${1:-/tmp/voix-macos-window.png}"

if [[ ! -f "$src" ]]; then
    echo "macos-screenshot: source missing at $src" >&2
    exit 1
fi

# Rebuild if the binary is missing or older than the source.
if [[ ! -x "$bin" || "$src" -nt "$bin" ]]; then
    echo "macos-screenshot: compiling $src → $bin" >&2
    swiftc -O "$src" -o "$bin"
fi

"$bin" "$out"
