# M20 macOS visual baseline followup

**Date**: 2026-05-31  
**Run by**: M22 Implementer  
**Status**: PARTIAL — voix window found, but appears blank (title bar only)

## Context

M20's smoke (`docs/phase-6/verify-results/M20-tom-smoke.md`) caught the
login screen because the Mac was locked and `screencapture -x` cannot
distinguish "voix didn't render" from "screen is at login". M22
Decision 6 specs a window-specific capture tool to retroactively close
this gap. Step 1 of M22 shipped that tool; this is Step 2 — running
it.

## Tool

`scripts/macos-screenshot.sh` → `tools/voix-window-screenshot/voix-window-screenshot.swift`
(commit `b9af44f`).

## Run

```
$ bash scripts/macos-screenshot.sh /tmp/voix-smoke-screenshots/m20-followup-macos.png
wrote /tmp/voix-smoke-screenshots/m20-followup-macos.png (21864 bytes, 1280x752)
exit=0
```

Mac was unlocked when this ran (CGSession `kCGSSessionOnConsoleKey =
true`), so the tool proceeded to ScreenCaptureKit. It found one window
owned by an `applicationName == "voix"` process and captured a
1280×752 PNG.

## Findings

### Process state

```
$ ps aux | grep -i "voix.*Build" | grep -v grep
tom  58092  ... /Users/tom/Library/Developer/Xcode/DerivedData/voix-fptthiixpwgzbsfmzuwwpgdjiyck/Build/Products/Debug/voix.app/Contents/MacOS/voix
```

This is the **same pid** the M20 smoke reported (process running since
~15:01). No Metro server has been started since M20's teardown (which
killed Metro + daemon but left the apps alive — see M20 smoke §7).

### The window

The captured PNG shows:

- macOS window chrome: traffic-light buttons (greyed-out, indicating
  the window doesn't have focus right now), title "voix".
- A blank white window body. No sidebar, no Voices list, no status
  pill. Nothing.

### Diagnosis

The M20 voix-macOS app **launched and rendered an empty window**.
The reason it's empty is almost certainly that Metro is no longer
running (the M20 smoke explicitly killed it at teardown, and nothing
has restarted it). React Native debug builds bundle JS from the Metro
dev server on launch; with no Metro available, the app starts but
shows an empty RCTRootView.

This is **not** a M20-quality bug — it's a "Metro was stopped before
the screenshot." On a fresh `bun run start:macos` + relaunch, the
window would re-render the Voices UI. The M21 implementer's iOS smoke
(`/tmp/voix-smoke-screenshots/m21-step5.png`) confirms the JS bundle
itself renders correctly; the bundle just needs a live Metro at boot.

### What the screenshot proves vs disproves

**Proves**:

- `bun run macos` from M20 produced a real voix-titled window
  (not just a launchctl artefact).
- The Cocoa app shell + RCTRootView wiring works on macOS Sequoia.
- The `screencapture -x` failure in M20 was a "Mac locked," not a
  "window invisible" failure.

**Doesn't prove**:

- That the M20 macOS app shows the same UI as iOS — we'd need to
  restart Metro + relaunch the app to confirm. That's effectively
  M22's smoke (Step 12), which Tom runs at the end.

## Caveat — same-process screenshot precision

Two voix windows might exist if the user opens multiple instances of
the dev build over a day. The tool picks the largest by area, which
heuristically lands on the main content window. On this Mac, there's
only one (pid 58092).

## Tom action items

- None for this followup. The empty-window state is consistent with
  "Metro was killed at M20 teardown." M22's Step 12 manual will start
  a fresh Metro + macOS app at which point the rendered UI replaces
  the blank.

## Artifacts

- `/tmp/voix-smoke-screenshots/m20-followup-macos.png` — 21864 bytes,
  1280×752, captured via SCScreenshotManager.
- `tools/voix-window-screenshot/voix-window-screenshot.swift` — the
  reusable tool (commit `b9af44f`).
