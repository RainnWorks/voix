# M20 Product brief — Marina (brief edition)

**Role**: Product. M20 is structural (RN scaffold + Tauri archive);
no user-visible feature change. Your job is **continuity-of-intent
through the platform expansion**:

- The brand layer (`@voix/ui`) survives unchanged.
- Tom's pre-pivot Tauri work is *preserved* in the legacy branch,
  not silently dropped.
- The native rendering of `<App />` produces the same chrome the
  user already knows (sidebar with Voices / Conversations /
  Surfaces; Puck glyph; HA blue only where it's earned).

## Canonical inputs

- `docs/phase-6/architecture-m20.md` (Decisions 1, 7, 8).
- `docs/phase-6/verify-results/M20-implementer-report.md`.
- `voix-brand-guide.html` + `voix-desktop-guide.html`.
- Current state of `packages/ui/src/lib/theme.ts`,
  `packages/ui/src/components/{Puck,AppShell,Wordmark}.tsx` — these
  must remain pure renames from M19.

## Tasks

1. **Brand layer untouched verification** — diff `packages/ui/src/`
   between `f9c6c92` (M19 close-out) and HEAD. Any change in
   `lib/theme.ts`, `components/*.tsx`, or `lib/api.ts` (other than
   the apiBase fetch wrapping in step 7) is a finding. The extension
   strip (step 5) should be the only intra-file edit; everything
   else should be additions to `clients/app/` or new files in
   `packages/ui/src/lib/`.

2. **apiBase platform shim — UX implication** — the hardcoded
   `DEV_DAEMON_URL` in `apiBase.native.ts` is `192.168.99.86:8765`
   (Tom's Mac IP from CLAUDE.md). When Tom runs the native app
   against a daemon NOT on his Mac (e.g. against the HA-host daemon),
   the IP needs to change. The brief calls this a `TODO(M21)` —
   confirm the TODO is in the code; flag whether the placeholder is
   embarrassing for a "first try" demo (you decide).

3. **Tauri archive — intent preservation** — check via:
   ```
   git log legacy/tauri-clipboard -p -- app/src-tauri/src/commands.rs \
     | grep -E "voix\.list_voices|HaVoice|voice_id"
   ```
   Must return matches. Same for `app/src-tauri/src/tray.rs` and
   `app/src/settings.js`. If any return empty, the M02e voice/mode
   rename intent didn't make it to the legacy branch — high finding.

4. **Sidebar chrome on native** — read `clients/app/index.js`. It
   should render the same `<App />` that web does, with NO native-
   specific overrides at the top level. If the Implementer inserted
   a wrapper, a SafeAreaProvider, or any chrome at the index.js
   level, flag it: M20 hello-world is "same App, native bindings,"
   not "different shell."

5. **Empty / placeholder states on native** — Conversations and
   Surfaces both call `fetch(getApiBase() + ...)`. On native against
   `192.168.99.86:8765`, those fetches will return real data when
   Tom is on his own LAN. But: if Tom takes the iPhone to a coffee
   shop, the fetches fail. The current UI shows an error banner.
   Note as watching brief for M21 — UX needs a "daemon unreachable"
   state distinct from "no data."

6. **The relic vs new app naming** — pre-pivot Tauri was
   "voix-app" (per `app/package.json`); RN scaffold is also named
   "voix" (per `clients/app/package.json` per Decision 2). Confirm
   the naming convergence is intentional, not accidental. If there's
   any user-visible string ("Voix Companion App" anywhere) that
   carries the relic's old framing into the new shell, flag it.

7. **Tone gap** — still no `tone` field on Voice (M04, M13b, M16, M19
   all deferred). M20 didn't address. Carry as a watching brief.

## Output

Saved to `docs/phase-6/verify-results/M20-product-marina.md`:

```
# Marina's M20 product review

## Receipts
[stat + commands]

## Brand continuity through the scaffold
[per-task ✓/✗/⚠ with one-line evidence]

## Findings, by severity
### Brand or intent regressions
### UX drift
### Watching briefs

## The one thing the brief should have anticipated but didn't
```

Empty findings is reasonable for M20 (structural). What you SHOULD
produce: concrete ✓ marks for brand continuity backed by `git
diff` output, not hand-waves.
