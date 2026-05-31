# Pre-pivot Tauri snapshot

This branch is a snapshot of voix's pre-pivot Tauri companion app,
taken on 2026-05-31 as part of M20 (RN end-to-end scaffold). The
app/ directory here was a clipboard companion: it received
transcripts from Home Assistant, put them on the macOS clipboard,
and (optionally) auto-pasted into the focused app.

The voix product pivoted to use a shared React Native component
layer across web (HA add-on), macOS, and iOS — see main branch
docs/STATE.md and docs/build-workflow.md Phase 6 for the new
direction. This branch exists only to preserve the pre-pivot work,
including the M02e voice/mode rename diffs that were never committed
to main.

Do not push to this branch.
