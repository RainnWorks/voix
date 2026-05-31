# A3 — Marina v4 + Wren v4 low/med cleanups (implementer report)

> Task: the 3 surviving low/med findings after M-MobileFit + polish-pass.
> Source: `tom-smoke-v4-marina.md` (SATISFIED, 2 med + 1 low) and
> `tom-smoke-v4-wren.md` (SATISFIED, low overlaps). Standing signing bypass.
> One commit per fix, pushed after each, full smoke (check + ui build + app
> tsc + iOS Debug xcodebuild) green at every commit.

## Commits (all pushed to `origin/main`)

| # | Fix | SHA | Files |
|---|-----|-----|-------|
| 1 | LogBox dev toast silenced in production bundles | `6a80024` | `clients/app/index.js` |
| 2 | Inactive page-dot tint tokenised | `ef27278` | `packages/ui/src/lib/theme.ts`, `packages/ui/src/onboarding/Onboarding.tsx` |
| 3 | Tone snippet → body text, not reserved HA blue | `1b58e65` | `packages/ui/src/voices/VoiceList.tsx` (rowTone hunk only) |

Push chain: `af7b1f8 → 6a80024 → ef27278 → 1b58e65`.

---

## Fix 1 — Debugger toast over bottom nav (Marina v4 LOW / Wren v4 #7, carried since M19)

**Finding:** the RN LogBox "Open debugger to view warnings" overlay floats over
the bottom edge and collides with the tab bar (frames 03/04/05).

**Root cause:** RN dev-mode LogBox notification toast. It is already inert in a
true production bundle (LogBox is a `__DEV__`-only subsystem), which is why
Marina/Wren both scored it LOW and "almost certainly debug-build-only."

**Fix (chose task option b):** at the native entry `clients/app/index.js`, when
`process.env.NODE_ENV === "production"` call `LogBox.ignoreAllLogs(true)`. This
is a belt-and-suspenders guarantee that a release-configured build can never
surface the toast as product chrome, while dev builds keep their warnings. The
guard lives in the **native** entry (not shared `@voix/ui`) because LogBox is
RN-only — the web target (Vite) has no LogBox and must not import it.

Did **not** choose option (a) "gate behind `__DEV__`": the toast isn't our
component to gate — it's RN's. Disabling it in production is the cleaner lever.

---

## Fix 2 — Page-dots invisible in dark mode (backlog A3b / Marina v3 #6)

**Important nuance — visibility was already RESOLVED.** Marina v4 §Inbox #1 and
Wren v4 §Resolved both confirm the dark-mode page-dot invisibility was fixed in
the polish-pass: `obPalette.dotInactive` already returns a light-on-dark neutral
(`rgba(255,255,255,0.25)`) in dark mode. Verified against
`/tmp/voix-tom-smoke/v3/01-welcome.png` — the dark welcome screen shows the
active blue pill **plus two visible grey inactive dots**. So there is **no live
visibility regression**; the dots render correctly in both schemes.

**What remained** was the colour-discipline tail the backlog A3b flagged: the
magic literal `rgba(0,0,0,0.2)` still lived inline in two places (the
`obPalette` light-mode branch and the `dot` StyleSheet default). Per the task's
"use a colour token" instruction, tokenised it:

- Added `colors.pageDotInactive: "rgba(0,0,0,0.2)"` to `theme.ts` (light-mode
  tint; theme.ts is light-only by design, so the dark-mode neutral stays
  resolved inline in `obPalette` where scheme is known).
- `Onboarding.tsx` line 91 and the `dot` StyleSheet default now reference
  `colors.pageDotInactive` — no inline literal.

**Net visual change: none.** Light mode keeps the same tint; dark mode keeps its
scheme-aware override. This is a maintainability/colour-discipline cleanup, not
a render fix (the render was already correct).

---

## Fix 3 — Tone-snippet colour treatment (Marina v4 MED #2 / Wren v4 #6)

**Finding:** voice-card tone snippets ("Talks back. Knows when to shut up.",
"Just transcribes. No rewrite.") rendered in `haBlueText` — accent-blue body
copy that reads as tappable link text under an already-tappable row, and
re-spends the reserved brand blue on running copy.

**Fix:** `rowTone.color` → `colors.textBody` (the secondaryLabel-equivalent
neutral). Per Marina §brand the snippet is BODY copy describing how the voice
sounds, not a voix moment. The voice's colour identity already lives on the
leading swatch `Puck`, which continues to carry it. Italic is preserved for the
voice-character feel.

`colors.textBody` (#3f3f46) over `textMuted` (#8b8b90): the task named
`textBody` explicitly, and the snippet is the voice's signature character line
(slightly more present than the generic `routingHint` fallback, which stays
`textMuted`).

---

## ⚠️ Concurrency hazard observed — shared working tree

The session-start git snapshot showed a **clean tracked tree**. During my work,
**12 tracked files appeared modified by another worker** (A1 iOS-nativeness:
pull-to-refresh, swipe-to-delete, haptics — `bun.lock`, `Podfile.lock`,
`AppDelegate.mm`, `AppShell.tsx`, `ConversationList.tsx`, `TalkButton.tsx`,
`VoiceList.tsx`, `history.ts`, `store.ts`, …). A1 and A3 are editing the **same
working tree concurrently.**

**My fix 3 lives in `VoiceList.tsx` alongside A1's pull-to-refresh changes.** To
avoid entangling A1's uncommitted work into my commit, I staged **only my
rowTone hunk** via a targeted `git apply --cached` patch and committed that
alone. Verified post-commit: A1's RefreshControl/ScrollView/useCallback changes
remain **unstaged and intact** in the working tree (`git diff --stat` still
shows 12 dirty files; my commit contains only the 8-insert/4-delete rowTone
hunk). Fixes 1 and 2 touched files A1 was not editing (`index.js`, `theme.ts`,
`Onboarding.tsx`), so those commits were clean.

**Recommendation to coordinator:** dispatch concurrent implementers into
separate git worktrees (`isolation: worktree`) to avoid this race. A1's work is
still uncommitted in the shared tree — it must be committed by A1, not lost.

---

## Smoke results (green at every commit)

| Check | Result |
|---|---|
| `bun run check` | OK (native-siblings / protocol-sync / pin-bounds) |
| `cd voix-backend/ui && bun run build` | ✓ built (Vite, 371 kB) |
| `bunx tsc -p clients/app/tsconfig.json --noEmit` | 0 errors |
| `xcodebuild … -scheme voix -configuration Debug … build` | **BUILD SUCCEEDED** (per commit) |

All three fixes are JS-only; the iOS native build is structurally unaffected but
was run green after each commit per the task brief.
