# B1 — Empty + error states across packages/ui

**Status:** shipped (6 commits, all pushed to `main`)
**Date:** 2026-06-01
**Scope:** `packages/ui` (shared by web `voix-backend/ui` + native `clients/app` iOS/macOS)

Post M-MobileFit the iPhone is the primary entry point, so the "nothing
loaded / can't reach the daemon / no data yet" surfaces had to read as
intentional, not blank. Each of the six fixes is one commit.

## Commits

| SHA | Fix | File(s) |
|-----|-----|---------|
| `c3d95d5` | 1. Daemon-unreachable banner | `components/DaemonBanner.tsx` (new), `App.tsx` |
| `1b639bc` | 2. Conversations empty state | `conversations/ConversationList.tsx` |
| `e6a2e87` | 3. Voices loading spinner | `voices/VoiceList.tsx` |
| `8cc4b0e` | 4. Surfaces empty state | `surfaces/SurfaceList.tsx` |
| `29fefcd` | 5. Voice-editor save toast | `components/Toast.tsx` (new), `voices/VoiceEditor.tsx` |
| `ccf9efe` | 6. TalkButton missing-key hint | `conversations/TalkButton.tsx`, `conversations/ConversationList.tsx` |

(`adf79d1` is a parallel B2-worker follow-up that swapped one em-dash in
fix 5's toast copy — see "Brand-register note" below. Not authored here.)

## Exact strings shipped (for brand-register spot-check)

1. **Daemon banner** (`DaemonBanner.tsx`): `voix can't reach the daemon. Check it's running at <getApiBase()>.` + action label `Retry` / `Retrying…`. On web `getApiBase()` is `""`, so the " at …" clause folds away → `voix can't reach the daemon. Check it's running.`
2. **Conversations empty** (`ConversationList.tsx`): title `No conversations yet.` / hint `Press the button above to start.` (both sentence case, with the puck hero glyph above).
3. **Voices loading**: no string — `ActivityIndicator size="large"` tinted `colors.sysAccent` (system accent, not HA blue — a spinner is chrome).
4. **Surfaces empty** (`SurfaceList.tsx`): title `No surfaces connected.` / hint `Your phone, browser, and puck appear here when they reach the daemon.` (puck hero above).
5. **Voice-editor save toast** (`Toast.tsx` + `VoiceEditor.tsx`): network drop → `Couldn't save. Check your connection.`; real HTTP error → `Couldn't save. <status statusText: body>` (keeps detail for debugging).
6. **TalkButton missing-key hint** (`TalkButton.tsx`): `voix needs a <Provider> key for this voice. Edit it from the Voices tab.` (`<Provider>` = `Deepgram` / `OpenAI` / `OpenRouter` / `Aura`, else Capitalised verbatim).

## Brand-register notes

- **HA blue is reserved for "voix moments."** The daemon banner is the
  app speaking about its own liveness → it takes the HA-blue tint
  (`haBlueBg`) + `haBlueText` foreground + a voix-blue status dot. Every
  other piece of chrome here uses the **system accent** (the large
  loading spinner, the refresh control) — never HA blue.
- **No user-facing em-dashes** (voix-brand-guide §09 / Wren AI-tell
  list). The task spec quoted fix 5's copy as `Couldn't save — check
  your connection.`, but the freshly-landed B2 lint forbids em-dashes in
  displayed copy. A parallel B2 follow-up (`adf79d1`) swapped it to a
  period: **`Couldn't save. Check your connection.`** — that is what
  ships. Likewise the daemon banner and the missing-key hint use
  sentences, not em-dashes. **This is the one deliberate deviation from
  the verbatim spec string**, taken to keep the brand register
  consistent with what just landed tonight.
- **Sentence case** throughout per the brand guide (`No conversations
  yet.`, `No surfaces connected.`).
- **Puck is the one sanctioned custom glyph** — used as the hero on both
  empty states; the loading spinner stays a plain system indicator.

## Design / behaviour decisions

- **Network vs HTTP distinction.** `lib/api.ts` throws HTTP errors as
  `"<status> <statusText>: <body>"`. The daemon banner and the save
  toast both test `^\d{3}\s` to tell a *reach* failure (fetch reject →
  banner / friendly toast) from a *server* error (status → per-screen
  error box / detailed toast). The banner is specifically the
  "can't reach the daemon at all" case so it doesn't double-surface
  4xx/5xx that the individual screens already own.
- **Missing-key guard is registry-derived, not a new endpoint.** A
  provider is only registered when its key is present
  (`orchestrator.ts`: "Each register only fires if the relevant key is
  present"). So `GET /api/providers?kind=stt` already *is* the
  has-key list. ConversationList adds that lookup to its existing
  `Promise.all` (fault-tolerant: `.catch(() => null)` just skips the
  hint) and warns when the active voice's `sttProvider` isn't in it.
  The warning only fires after the registry loads (`sttProviders !==
  null`) so a slow lookup never flashes a false negative. TalkButton
  gets an optional `providerWarning` prop; MacOverlay (the other caller)
  omits it.
- **Toast is a reusable component** (`components/Toast.tsx`): a dark
  translucent iOS pill pinned bottom-centre, auto-dismiss (4 s),
  tap-to-clear, `pointerEvents="box-none"` so it doesn't block the form.
  VoiceEditor's old inline red banner is replaced; load failures still
  use the full-screen error box (distinct `saveError` vs `error` state).
- **Pre-existing states polished, not duplicated.** A1/M-prior work had
  already added bare empty/error/loading branches to ConversationList,
  VoiceList, and SurfaceList. B1 brings them to spec (puck heroes,
  large system spinner, reworded surfaces copy) rather than adding
  parallel ones.

## Smoke results

| Check | Result |
|-------|--------|
| `bun run check` | ✅ OK (native-siblings, protocol-sync, pin-bounds) |
| `cd voix-backend/ui && bun run build` | ✅ tsc + vite build, 348 modules, 375 kB |
| `bunx tsc -p clients/app/tsconfig.json --noEmit` | ✅ clean |
| `xcodebuild voix Debug iOS` | ✅ `** BUILD SUCCEEDED **` |

iOS build: `xcodebuild -workspace voix.xcworkspace -scheme voix
-configuration Debug -destination 'platform=iOS Simulator,name=iPhone 16
Pro,OS=18.2' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build`
(standing signing bypass). Note: the destination needs `OS=18.2` pinned
— `name=iPhone 16 Pro` alone resolves ambiguously (multiple OS/arch
entries) and xcodebuild exits early printing the destinations list.
Result: `** BUILD SUCCEEDED **`.
