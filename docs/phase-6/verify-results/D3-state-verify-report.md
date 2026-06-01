# D3 — STATE.md accuracy verify (post-overnight)

**Task:** Confirm `docs/STATE.md` (pruned to 7.4KB in B5) is still accurate
after ~50 overnight commits across A1–A3, B1–B15, C1–C3, and update any
load-bearing fact that changed. **Date:** 2026-06-01. **Worker:** D3.

## Method

Read STATE.md end-to-end, cross-referenced `/tmp/voix-overnight-state.txt`
(fire summaries) + `git log --since="2026-06-01"` + the B7/B12/C1 verify
reports + `docs/build-workflow.md` (M25 definition / Next-up).

## Finding: one stale load-bearing fact

STATE.md's **Next up** said *"M20a … still queued; until it lands the
production stable-channel Add-on build is broken."* **That is now false** —
B7 landed M20a on source overnight (`08644c0`, `0224f01`, `33a591f`,
`aafc3c9`). The Docker build context shift, the `image:`/GHCR pull path, and
the protocol-kludge retirement are all merged. What remains is a one-time
**Tom go-live** (cut `addon-v*` tag → CI publishes → make GHCR packages
public), which is a hands-on item, not queued code. Everything else in
STATE.md was still accurate (Phase 6 closed-on-source verdict, M-MobileFit
summary, the 6 existing Tom-pending items).

## Changes to STATE.md

| Section | Change |
|---|---|
| Current phase status → Next up | Rewrote: **Phase 7 / M25** (HA connector trim ~600–800 LOC) is now the next milestone; M20a noted as landed-on-source with the go-live one-liner. |
| **New since 2026-06-01 overnight** (new section, 4 bullets) | Added, grouped by *new infrastructure* (M20a/B7 Add-on image, B6 CI, B11 tests), *Phase 6 polish* (A1/B1/B8/B13/B15/B2), *bug fixes* (C1 SurfaceList BLOCKER + glyphs, C2/C3 dead-code/bundle), *macOS re-pass* (B12 passes both axes; optional menu-bar follow-up). |
| Tom-pending list | Added **item 7 — Production HA Add-on go-live (M20a/B7)**: cut `addon-v0.1.0` tag + make GHCR packages public; `dev_mode` works meanwhile. |

## Cross-reference checks (no change needed)

- **B12 macOS Marina+Wren** — review-only, no code shipped; passes BLOCKER
  bar on both axes. No new Tom-pending item (overlay HUD still covered by
  existing item 3). Optional "menu-bar voix-ify" noted in the overnight
  section, not added as a blocker.
- **iOS PTT round-trip (item 2)** — A1 added Taptics + native plumbing but
  no live test; correctly stays Tom-pending. Unchanged.
- **iOS onboarding/settings (item 4)** — B8 fixed the Settings daemon-URL
  editor on source; the live walk-through stays Tom-pending. Unchanged.
- macOS hotkey+paste (3), iOS background-audio (5), iOS keyboard (6) — all
  unchanged.

## Verification

- `wc -c docs/STATE.md` → **9630 bytes** (was 7401; under the 10KB cap).
- `bun run check` → **OK** (native-siblings OK, pin-bounds OK).
- All doc links referenced in the edits resolve (B7 report, build-workflow,
  tom-manual, overnight handoff).

## Commit

Single commit, signing bypassed, pushed to `main` — SHA in worker_done.
