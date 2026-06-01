# B5 — Documentation prune report

**Status:** shipped (4 commits, all pushed to `main`)
**Date:** 2026-06-01
**Goal:** collapse the operational doc surface from "sprawling milestone
diaries" to "cold-readable load-bearing only" so the next session can pick up
cold and know what's where.

---

## Before / after sizes

| File | Before | After | Δ |
|------|--------|-------|---|
| `docs/STATE.md` | 64,911 B (1,235 lines) | **7,401 B** (~150 lines) | **−89%** |
| `docs/phase-6/m20-manual.md` | 4,502 B | _(deleted)_ | — |
| `docs/phase-6/m21-manual.md` | 4,303 B | _(deleted)_ | — |
| `docs/phase-6/m22-manual.md` | 5,197 B | _(deleted)_ | — |
| `docs/phase-6/m23-manual.md` | 7,366 B | _(deleted)_ | — |
| `docs/phase-6/m24-manual.md` | 7,512 B | _(deleted)_ | — |
| `docs/phase-6/tom-manual.md` | — _(new)_ | 12,309 B | consolidates 5 files (28,880 B → 12,309 B, −57%) |
| `docs/session-handoff/2026-06-01-overnight.md` | — _(new)_ | 65,760 B | archived prior STATE.md narrative |
| `docs/build-workflow.md` | 19,247 B | 19,7xx B | +Phase-6-closed banner |
| `docs/session-handoff/2026-05-30-audit-pass.md` | 15,637 B | 16,017 B | +SUPERSEDED header |

Net: the **cold-read entry point shrank from ~65 KB to 7.4 KB**; the historical
narrative is preserved verbatim in the dated archive (not lost, just moved out
of the hot path).

---

## Consolidation map

### 1. STATE.md prune (`13f47f7`)
**Kept (load-bearing):** current phase status (Phases 1–5 + verification cliff;
Phase 6 closed; M-MobileFit/overnight closed; next = M20a + Phase 7), Phase 6
closed-on-source verdict (4 surfaces + provider-agnostic seam), M-MobileFit
closure summary (commit SHAs for the 8 polish fixes + A2/A3/B1/B2), the 6-item
Tom-pending live-device behaviour list, a "See also" pointer block.

**Deleted → archived to `docs/session-handoff/2026-06-01-overnight.md`**
("archived prior STATE.md", full 65 KB verbatim with an explanatory header):
- the per-milestone narrative (M01–M24 + M-Arch Wave A/B diaries)
- the Pre-M01 snapshot section (hosts, repo layout, status table, redesign
  notes, HA sync contract, dev-iteration recipes)
- the lessons-learned section
- the "Test plan for the very next iteration" section

### 2. Manual consolidation (`d77c9a6`)
`m20`+`m21`+`m22`+`m23`+`m24-manual.md` → **one `docs/phase-6/tom-manual.md`**,
reorganised by surface (not milestone):
- **§0 Common setup** — pre-flight, workspace refresh + pods, daemon URL,
  daemon+Metro start. All recovery one-liners pulled up here (hermes, RN not
  found, cli-platform-apple symlink, worklets 0.8.3 pin, license/SDK).
- **§1 iOS sim** — boot/Voices (M20), onboarding (M23), tone+intent+PTT (M23),
  Settings smoke (M23).
- **§2 iOS device** — Apple Developer enrolment + trust (M24), background-audio
  survival (M23).
- **§3 macOS** — boot (M20), screenshot baseline (M22), status item (M23),
  hotkey→overlay→paste load-bearing flow (M22).
- **§4 iOS keyboard** — enable/pill/bounce-loop/failure-paths/memory (M24) +
  the full App Review story preserved verbatim.
- Acceptance-reporting checklist per surface.
Originals removed via `git rm`.

### 3. build-workflow Phase 6 closed (`9f83f23`)
Top-of-file `> Phase 6 closed 2026-06-01` banner + the Phase 6 table heading
marked `✅ CLOSED 2026-06-01` with a status line. Table retained for the record.

### 4. audit-pass SUPERSEDED (`c0d0736`)
`docs/session-handoff/2026-05-30-audit-pass.md` (pre-Phase-6, stale) gets a
SUPERSEDED header pointing at `docs/STATE.md` (current) +
`2026-06-01-overnight.md` (archived narrative).

---

## Smoke

`bun run check` → **all green** (docs-only change, nothing structural broke):
```
check-native-siblings: OK
check-protocol-sync: OK
check-pin-bounds: OK (react-native-worklets pinned at 0.8.3)
```

## Cold-read sanity (action 5)

`docs/STATE.md` now answers "what's the current state of voix?" top-to-bottom
in well under 5 minutes: phase-status bullets first, then the Phase 6 verdict,
the M-MobileFit closure, the Tom-pending list, and a pointer block. No reader
needs to scroll a 1,200-line milestone diary to learn what's shippable and what
still needs Tom's hands.

## Notes

- Worked in a shared working directory alongside parallel B3/B6 workers; the
  branch took concurrent pushes mid-run. All 4 B5 commits landed cleanly on
  `origin/main` (13f47f7, d77c9a6, 9f83f23, c0d0736); final tree in sync.
- Git signing bypassed per task (`-c commit.gpgsign=false`); the SSH-agent
  signing warnings on push are environmental and did not block the pushes.
- Archived/historical docs (architecture-m*.md, verify-results, the overnight
  archive) still reference the old `m2x-manual.md` paths — left as-is since
  they are point-in-time diaries, not live navigation.
