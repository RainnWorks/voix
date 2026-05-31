# M-MobileFit — implementer report

**Task:** fix the canvas-fit BLOCKER both Marina (UI craft) and Wren (UX
flow) flagged on the Phase 6 iOS smoke — a desktop/iPad master-detail
layout rendered on a 393pt iPhone. Spec: `docs/agents/soul.md` §3
(precondition checks), §10.1/§10.2 (the simulated re-run), and the v1
reports `tom-smoke-{marina,wren}.md`.

**Outcome:** done. Single-column phone layout with safe-area-inset
chrome and a bottom tab bar; master-detail preserved for wide canvases.
All five build/type gates pass (iOS + macOS Debug both **BUILD
SUCCEEDED**).

---

## What the BLOCKER was (soul §3 preconditions, both failed)

1. **Canvas-fit (precondition 1).** `AppShell` rendered a fixed 220px
   conversation **sidebar beside** the content pane on every device.
   On a phone that squeezed content to ~60% of canvas and clipped copy
   mid-word (`'Talks back. Knows…'`, `'ACTIV[E]'`, `'puck-1 · Realtime'`).
   A master-detail split is a desktop/iPad idiom, not a phone one.
2. **Safe-area (precondition 2).** The top chrome (`Voix /vwa/` wordmark)
   sat **at the status-bar / Dynamic Island row** — the "22:35" in the
   screenshots was the OS clock bleeding through behind the wordmark.
   No safe-area inset.
3. **Two nav contexts on a one-context surface (Wren F5).** Sidebar
   conversation list + `+New conversation` row + the Voices/Surfaces/
   Settings nav all competed for the same screen.

Plus the front-door defect (Wren F1): the `+New conversation` row had
**no `onPress` at all** — only a `⌘N` visual hint a phone can't press.

---

## What changed (fix targets a–g)

### a + b + c — adaptive layout (`AppShell.tsx`, `lib/useResponsive.ts`)
- New `useResponsive()` hook: `isPhone = width < 768pt`, via
  `useWindowDimensions` so it re-evaluates on rotation / window resize
  (an iPad split-view or a dragged macOS window can cross the line).
- `AppShell` now branches:
  - **Phone (`isPhone`)** → `PhoneShell`: single column, **full-width
    content pane**. The conversation list leaves the sidebar and becomes
    a **bottom tab**: `Conversations · Voices · Surfaces · Settings`.
    One context owns the screen at a time. Chose the **bottom-tab**
    option over a drawer because the sidebar's bottom items
    (Voices/Surfaces/Settings) were already a tab-bar-shaped nav — adding
    Conversations to it is the lowest-surprise mapping, and it keeps the
    M23 glyph vocabulary (Voices→puck, Surfaces→◇, Settings→⚙).
  - **Tablet/desktop (`≥768pt`)** → `DesktopShell`: the existing
    master-detail split, **unchanged and still the default**. The HA
    add-on iframe renders wide, so it keeps the two-column layout.

### d — safe-area chrome (`platform/safeArea[.native].tsx`, `AppShell`, `Onboarding`)
- New `platform/safeArea` shim following the repo's `.native` sibling
  convention: native re-exports `react-native-safe-area-context`
  (pod 5.8.0, already installed for iOS + macOS); web is a zero-inset
  passthrough (an iframe/tab has no status bar). Wired through the
  `platform` barrel; `App` wrapped in `SafeAreaProvider`.
- Phone header wrapped in `SafeAreaView edges={['top']}` → wordmark
  clears the status bar / Dynamic Island. Bottom tab bar in
  `edges={['bottom']}` → clears the home indicator. Desktop titlebar
  gets a no-op `edges={['top']}` (zero inset on macOS/web, correct under
  an iPad status bar).
- Onboarding header/dots inset via `useSafeAreaInsets` on the scroll
  padding.

### e — onboarding page indicator (`Onboarding.tsx`)
- `StepDots` already drew 3 dots, but the inactive ones used
  `colors.rule` (`rgba(0,0,0,0.08)`) — near-invisible, so it read as one
  orphaned dot (Marina #12 / Wren F9). Now: current step is a wider
  **haBlue pill**, the other two are visible neutral dots
  (`rgba(0,0,0,0.2)`); the group carries `accessibilityRole=progressbar`
  + `"Step X of 3"`.

### f — `+New conversation` front door (`AppShell`, `App.tsx`)
- New `onNewConversation` prop. The desktop sidebar row and a phone
  header `＋` action both call it; it lands on the **Conversations**
  surface with `openEntryId === null`, which renders the `TalkButton` at
  the top — i.e. "create + navigate into a new conversation." Previously
  dead on every platform (no handler).

### g — touch-target audit (HIG ≥44pt)
- Bottom tab items: `minHeight 49`. Phone `＋` button: `44×44` + hitSlop.
- Onboarding primary/secondary CTAs: `minHeight 44` + centered (were
  ~41pt from padding alone). `Skip setup` link: hitSlop.
- Voices `Activate` chip: hitSlop to ~44pt + `Activate <voice>` AX label
  (compact visual kept on desktop). Detail/editor sub-views already have
  their own "Back to …" links, so phone users aren't trapped.

---

## Scope notes (deliberately not done)
These were in the v1 reports but are **not** canvas-fit and were left to
avoid scope creep / desktop regressions:
- Marina #1 (HA blue as chrome), #2 (disabled-looking onboarding
  titles), #3 (URL field affordance), #4 (Connected in brand blue), #6
  (coloured tone snippets), #11 (Voix/voix casing).
- Wren F2 (listening/terminal state), F4 (per-surface active mode / NOW
  strip), F6 (`Realtime` voice name), F7 (latency badges), F8 (hold-vs-tap
  per `voice.type`).

The active-tab tint uses `colors.sysAccent` (#007AFF), the theme's
designated **chrome** accent — not `haBlue`, which stays reserved for
voix moments (consistent with Marina #1's thesis even though that fix
isn't in this pass).

---

## Verification (all green)

| Gate | Command | Result |
|---|---|---|
| Repo checks | `bun run check` | OK (native-siblings, protocol-sync, pin-bounds) |
| Web build | `cd voix-backend/ui && bun run build` | ✓ built (343 modules) |
| iOS+macOS types | `bunx tsc -p clients/app/tsconfig.json --noEmit` | exit 0 |
| iOS Debug | `xcodebuild -workspace ios/voix.xcworkspace -scheme voix -configuration Debug -destination 'generic/platform=iOS Simulator'` | **BUILD SUCCEEDED** |
| macOS Debug | `xcodebuild -workspace macos/voix.xcworkspace -scheme voix-macOS -configuration Debug -destination 'platform=macOS'` | **BUILD SUCCEEDED** |

## Commits (all pushed to `main`)
1. `5b47b17` feat(ui/mobile-fit): safe-area shim + useResponsive form-factor hook
2. `fda40b7` feat(ui/mobile-fit): single-column phone layout + safe-area chrome
3. `4ffc616` fix(ui/mobile-fit): onboarding safe-area inset + real 3-of-N page dots
4. `3ce002b` fix(ui/mobile-fit): touch-target audit on onboarding + Voices (HIG ≥44pt)

## Files modified
- `packages/ui/src/platform/safeArea.tsx` (new)
- `packages/ui/src/platform/safeArea.native.tsx` (new)
- `packages/ui/src/lib/useResponsive.ts` (new)
- `packages/ui/src/platform/index.ts`
- `packages/ui/src/components/AppShell.tsx`
- `packages/ui/src/App.tsx`
- `packages/ui/src/onboarding/Onboarding.tsx`
- `packages/ui/src/voices/VoiceList.tsx`
