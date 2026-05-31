# Marina's product review of M19

**Persona**: macOS HIG zealot. **Posture**: continuity of intent through
a file move. M19 has no user-visible feature change — the work here is
auditing that nothing brand-shaped, brand-coloured, or UX-shaped got
silently lost in the structural reshape from
`voix-backend/ui/src/` → `packages/ui/src/`.

**Verdict**: PASS. The move is a clean rename. Brand tokens, glyph
proportions, chrome rules, and sidebar copy all survived. One *very*
minor cosmetic drift in imports (added `.ts`/`.tsx` extensions) is
already flagged as Delta D by the Implementer and isn't a brand
concern.

---

## Receipts

`stat -f "%m %z %N"` on every file read:

```
1780222858    4973  /Users/tom/Projects/voix/docs/phase-6/verify-briefs/M19-product-marina.md
1780225261    7851  /Users/tom/Projects/voix/docs/phase-6/verify-results/M19-implementer-report.md
1780222652   24493  /Users/tom/Projects/voix/docs/phase-6/architecture-m19.md
1779785213   39891  /Users/tom/Projects/voix/voix-brand-guide.html
1779788656   59410  /Users/tom/Projects/voix/voix-desktop-guide.html
1780058260    5074  /Users/tom/Projects/voix/packages/ui/src/lib/theme.ts
1780223549    1479  /Users/tom/Projects/voix/packages/ui/src/components/Puck.tsx
1780223631    7377  /Users/tom/Projects/voix/packages/ui/src/components/AppShell.tsx
1780223551    1451  /Users/tom/Projects/voix/packages/ui/src/components/Wordmark.tsx
1780129027    5387  /Users/tom/Projects/voix/packages/ui/src/lib/api.ts
```

Diff range under audit: `de00987..HEAD` (architecture brief commit →
M19 follow-up commit `fa638d7`).

Key `git diff` evidence:

```
voix-backend/ui/src/lib/theme.ts     → packages/ui/src/lib/theme.ts   similarity 100%
voix-backend/ui/src/lib/api.ts       → packages/ui/src/lib/api.ts     similarity 100%
voix-backend/ui/src/components/Puck.tsx     → similarity 97%  (import path extension only)
voix-backend/ui/src/components/Wordmark.tsx → similarity 93%  (import path extension only)
voix-backend/ui/src/components/AppShell.tsx → similarity 98%  (import path extension only)
```

The 3 % / 7 % / 2 % deltas are *exclusively* the `../lib/theme` →
`../lib/theme.ts` / `./Puck` → `./Puck.tsx` import-path extension
suffix additions — a TS-only consequence of the workspace's
`allowImportingTsExtensions: true` setting that ships zero pixels.

---

## Brand continuity check

| # | Task | Result | Evidence |
|---|---|---|---|
| 1 | Theme integrity — pure rename | ✓ | `git diff de00987..HEAD -- …theme.ts`: `similarity index 100%`, `rename from voix-backend/ui/src/lib/theme.ts → rename to packages/ui/src/lib/theme.ts`. Zero content delta. |
| 2a | 12-colour palette intact (6 saturated + 6 soft) | ✓ | `modePalette` in theme.ts lines 65–78: `haBlue, amber, violet, green, coral, magenta` (saturated row) then `sky, lemon, lavender, mint, peach, slate` (soft row). Twelve. Order matches the desktop guide's swatch grid byte-for-byte. |
| 2b | `colors.haBlue === "#03A9F4"` | ✓ | theme.ts:46 `haBlue: "#03A9F4"`. Matches desktop guide `--ha-blue: #03A9F4`. |
| 2c | `colors.haBlueBg` matching light tint | ✓ | theme.ts:47 `haBlueBg: "rgba(3,169,244,0.08)"`. Matches desktop guide's `rgba(3,169,244,0.08)` used on the ACTIVE tag and LIVE status pill. |
| 2d | `colors.ink === "#18181b"` (canonical) | ✓ | theme.ts:23 `ink: "#18181b"`. Matches brand guide `--ink: #18181b`. Never pure black. |
| 2e | `fontFamily.ui` is system-only | ✓ | theme.ts:124–126: `"-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"`. No Inter, no Geist, no Manrope, no Söhne, no Hanken Grotesk. Exactly the desktop guide's contract. |
| 3a | Puck outer radius = `size * 0.22` | ✓ | Puck.tsx:29 `const radius = Math.round(size * 0.22);`. Matches brand guide's "RADIUS · 22% OF SIDE". |
| 3b | Puck inner circle = `size * 0.35` | ✓ | Puck.tsx:28 `const inner = Math.round(size * 0.35);`. Matches "CIRCLE · 35% OF BODY". |
| 3c | Default colours: ink outer, HA-blue inner | ✓ | Puck.tsx:27 `color = colors.haBlue, bodyColor = colors.ink`. |
| 4 | AppShell chrome has no `haBlue` | ✓ | `grep -nE "haBlue" packages/ui/src/components/AppShell.tsx` → `NO MATCHES`. Sidebar selection uses `colors.sysAccent` (#007AFF) on lines 225, 256 — the desktop guide's "respect the user's OS accent" rule, exactly. The brand colour never touches the chrome. |
| 5 | React 19 cosmetic-drift paper review | ✓ | Shared chrome (AppShell, Puck, Wordmark) is pure declarative render with no `useEffect`/`useLayoutEffect`/`useState`. The only hooks in `@voix/ui` chrome are three `useState` calls in `App.tsx` for section/editing state — synchronous, no timing dependency. No focus-on-mount, no animation kick-off, no autosave timer in these files. React 19's automatic-batching change cannot cause cosmetic drift in code that doesn't depend on render-phase ordering. Implementer's Delta B (PARTIAL — no browser) is a fair limitation; static analysis confirms no risk pattern lives in the moved chrome. |
| 6 | Sidebar copy: "Voices" + "Surfaces" survived | ✓ | `grep -nE "Voices\|Surfaces" packages/ui/src/components/AppShell.tsx`: line 79 `label="Voices"`, line 86 `label="Surfaces"`. No regression to "Modes" or "Devices". |
| 7 | `lib/api.ts` URLs still relative | ✓ | `git diff de00987..HEAD -- …api.ts`: `similarity index 100%`. The only `fetch(` call (line 61) takes `path` as a parameter; every call site uses `"api/voices"`, `` `api/devices/${id}/voice` ``, `"api/surfaces"`, `` `api/history${qs}` `` — all relative, no leading slash, no hard-coded scheme. Comment on line 11–17 explicitly defends this for HA ingress. M18's fix survives intact. |
| 8 | Tone snippet — watching brief | ⚠ | Not in `packages/ui/src/lib/api.ts`'s `Voice` type. The schema has `talkingPrompt`, `donePrompt`, `addendum`, `routingHint` — but no `tone`. Carried forward. Not an M19 finding. |

---

## Findings, by severity

### Brand regressions (must fix this milestone)

*(none)*

### UX drift (fix or document)

*(none)*

The Implementer's own Delta D (explicit `.ts(x)` extensions on internal
imports) is a real concern *for M20 Metro resolution*, but it carries
zero user-visible cosmetic impact in M19 — the byte stream coming out
of Vite is identical. Already filed by the Implementer; nothing to add
here.

### Watching briefs (carry forward)

- **Tone gap (M04 / M13b / M16 deferral chain)**. `Voice` in
  `packages/ui/src/lib/api.ts` still has no `tone` field. M04 and M13b
  rewrote the editor twice without it. M16 documented the gap. M19
  was *not* the right place to land it (a structural milestone is
  exactly the wrong place to slip a schema change), but the next
  touch on the Voice editor or the daemon's Voice schema is the
  moment to either ship it or write a "we're deliberately not
  doing this, here's why" architecture note. The hidden cost of
  perpetual deferral is that the editor accumulates ad-hoc
  workarounds (the `addendum` field has already absorbed some
  tone-shaped strings in practice). **Owner**: whoever picks up
  the next Voice editor delta. **Trigger**: any commit touching
  `VoiceEditor.tsx` or the daemon's Voice type.

- **Delta B paper review only**. The Implementer's screen check for
  React 19 was static (no browser available). Static analysis of the
  moved chrome shows no React-18-render-timing dependencies, so the
  paper review is sufficient *for M19's scope*. But there is one
  thing to put on the M20 list: `VoiceEditor.tsx` and
  `ConversationDetail.tsx` are larger files with their own state
  machines — they should get a real browser pass during M20's first
  smoke, because that's the first time someone *will* be opening a
  real browser at the workspace root. **Owner**: M20 Implementer.

- **Two pucks on screen at once**. The desktop guide's "the puck is
  the protagonist, but it's modest" rule (110 px in a default window)
  isn't reachable from M19 — that's M22-and-after work. But while
  reading AppShell I noticed `Sidebar` renders an 11 px Puck as the
  "Voices" icon (line 79) and `Wordmark` renders a 14 px Puck in the
  titlebar (Wordmark.tsx:26). That's two glyphs visible at once at
  the top-left of the app. Today they're at different sizes and
  different vertical positions, so it reads as wordmark-then-nav-
  icon rather than two-of-the-same-thing. Worth keeping an eye on
  if the sidebar gets a second puck-iconed row — the guide's "never
  put it next to other logos in an as-seen-on row" rule has a
  cousin: never put two pucks in adjacent visual cells of the same
  chrome. Not a finding today. **Trigger**: any future sidebar row
  that uses a Puck as its icon.

---

## The one thing the brief should have mentioned but didn't

**The `voix-backend/ui/package.json` React 19 bump is the actual
brand-risk delta in M19, not the file moves.** Marina's brief framed
the file move as the place a stylesheet or token might silently drop —
but the moves are diffable to similarity-100, so the question answers
itself with one `git diff`. The *interesting* brand-risk question is
"does React 19's render-timing change cause any of the chrome
animations to look different?" — and the chrome has no animations
today, so the answer is no, but that's a useful thing to *prove*, not
assume. The brief could have asked for that explicitly under Task 5
instead of leaving it as "paper review." Tightened version: "list
every `useEffect` / `useLayoutEffect` in the moved chrome and confirm
none of them depend on React 18's render ordering." That gives a
crisper PASS than "I looked and didn't see any." (Result is the same;
the audit trail is better.)

Also worth saying: the Implementer's report flagged the *actually
serious* problem (HA Add-on Docker AC8 = FAIL) at the top. That's
not a brand concern — but Marina-the-persona should note that a
PARTIAL ship which breaks production deploys is not a M19-pass,
even if the brand work is clean. Marina's review is green; the
milestone's overall colour is amber pending Delta C resolution.
