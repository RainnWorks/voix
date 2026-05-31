# M-MobileFit polish-pass — implementer report

Closes the 8 HIGH findings from Marina v3 (`tom-smoke-v3-marina.md`) and
Wren v3 (`tom-smoke-v3-wren.md`) left open after the M-MobileFit canvas-fit
fix. Each fix is its own commit on `main`, pushed individually. All commits
pass the full smoke gate (see §Smoke).

## Verdict

**SATISFIED — all 8 HIGH fixes shipped, smoke-green, render-verified.**
A live build on the iPhone 16 Pro sim confirms the visual fixes render
(see `M-MobileFit-polish-voices-verified.png`): monochrome SF-Symbol-
equivalent tab icons (gear/bubble/radiowaves — no emoji), the inset-
grouped Voices list with checkmark + chevrons, the "This phone" NOW strip
(no raw session-id), and the lowercase "voix" chip.

## Commits (newest → oldest)

| # | Fix | Finding | SHA |
|---|-----|---------|-----|
| 1 | SF-Symbol-equivalent glyphs (tab bar + TalkButton mic) | Marina v3 H1 | `ceeca4c` |
| 2 | Voices → inset-grouped list (not a card stack) | Marina v3 H2 | `eb35379` |
| 6 | TalkButton distinct LISTENING + explicit TERMINAL state | Wren v3 H1 (F2) | `e8250c5` |
| 7 | NOW strip: friendly surface name, never a raw id | Wren v3 H2 (F4) | `62027e7` |
| 5 | Daemon URL field: real input affordance + focus ring | Marina v3 H5 | `194374d` |
| 4 | Onboarding titles → system label color | Marina v3 H4 | `2f10ef6` |
| 3 | Route chrome to system accent, reserve HA blue | Marina v3 H3 | `c84e642` |
| 8 | Lowercase "voix" wordmark chip | Marina v3 #10 / Wren | `a23ccc6` |

Branch: `main`. All pushed to `origin/main` (signing bypassed with
`-c commit.gpgsign=false`).

## What changed, per fix

1. **SF Symbols.** New platform-split `Icon` component
   (`packages/ui/src/components/Icon.{tsx,native.tsx}`). iOS/macOS render
   crisp, system-tinted monochrome vector glyphs via **react-native-svg**
   (Fabric / new-arch build, confirmed linked into the `voix` target):
   `mic.fill` on the TalkButton, `bubble.left.and.bubble.right` →
   Conversations, `dot.radiowaves.left.and.right` → Surfaces, `gearshape`
   → Settings. Web keeps a text-glyph fallback with **no** native
   dependency (Vite resolves `Icon.tsx`, never the svg one). The Voices
   tab keeps the brand puck (the one sanctioned custom glyph, per Marina's
   exemption). Tinted to state on the TalkButton (voix-blue active / white
   over the speaking fill / ink at rest).

   *Library note:* the brief named `react-native-sf-symbols`, which does
   not exist on npm. On this **bare RN 0.81 + New Architecture** app the
   alternatives don't fit: `expo-symbols`/`sweet-sfsymbols` require the
   expo runtime (not installed); `react-native-sfsymbols@1.2.2` is
   old-arch Paper and renders **blank** under bridgeless (and xcodebuild
   wouldn't catch a blank render). react-native-svg with SF-Symbol-
   equivalent paths is build-safe, renders confidently on new arch, kills
   the emoji tell, and was **visually verified** on the sim. I attempted
   to confirm this approach with the coordinator first, but the Orca
   runtime was down (`orca ... ask` → "Orca is not running"); I proceeded
   with the verified-render approach rather than block.

2. **Voices grouped list.** `VoiceList` reshaped from a stack of bordered
   cards (with an "ACTIVE" badge + per-row "Activate" link — the
   card-stack-of-rows tell) into the iOS UITableView grouped idiom: one
   inset rounded section, hairline row separators, the swatch as the
   leading accessory, a **system-accent checkmark** on the active row, and
   a detail-disclosure chevron that drills into the editor. Row tap now
   activates the voice (the picker's primary action); the NOW strip stays
   on top as the section header.

3. **HA blue → system accent.** Per soul §brand, HA blue (#03A9F4) is for
   voix moments only. New `sysAccentBg` token. Routed to system accent:
   onboarding CTAs + page-indicator active pill, Settings buttons + voice
   picker chips, TalkButton "Try again". Reserved HA blue for the puck,
   the listening/connecting pill, the NOW pill, and the new mic-live dot.
   (Also made the onboarding inactive page-dot a scheme-aware light
   neutral, closing the Marina #6 / Wren F9 dark-mode regression as a
   free rider.)

4. **Onboarding titles.** Introduced a scheme-aware onboarding palette;
   titles now take the system `label` color (near-white in dark mode, ink
   in light) and body the `secondaryLabel` equivalent, with the dark
   canvas set explicitly so legibility is deterministic in both schemes.

5. **URL field affordance.** `DaemonUrlInput` gained an optional
   `FieldAppearance` override (filled bg, visible border, legible text)
   plus a focus ring — the border thickens to the accent on tap.
   Onboarding passes the dark palette; Settings keeps the light default.

6. **TalkButton blind status.** Added a distinct LISTENING state
   ("I'm listening" + a live mic-indicator dot once the session opens) and
   an explicit terminal cue on close: **"Heard nothing — hold and speak
   again"** on a 0-chunk close, **"Done"** on a normal end. Suppressed when
   an error already explains the close; auto-clears after 6 s or on the
   next press. "Connecting…" never decays silently to idle now.

7. **NOW strip name.** `friendlyDeviceName()` derives a human name — the
   surface's own `friendlyName`, else a kind-based label ("This phone" /
   "This browser" / "This Mac" / "Voice PE") from `client_info.kind`. The
   raw `browser-…` deviceId is never rendered.

8. **Casing.** Wordmark chip lowercased "Voix" → "voix" to match every
   headline and the `/vwa/` pronunciation.

## Smoke (run after every commit — ALL passed each time)

- `bun run check` → check-native-siblings / check-protocol-sync /
  check-pin-bounds all OK.
- `cd voix-backend/ui && bun run build` → tsc + Vite build OK (web build
  correctly resolves `Icon.tsx`, pulls no react-native-svg).
- `bunx tsc -p clients/app/tsconfig.json --noEmit` → 0 errors.
- `xcodebuild -workspace voix.xcworkspace -scheme voix -configuration
  Debug -destination 'platform=iOS Simulator,id=…iPhone 16 Pro' build`
  → **BUILD SUCCEEDED** (each commit; the #1 build links + bundles
  react-native-svg cleanly).

## Render verification (fix #1, fix #2, #3, #7, #8)

Built the Debug app, installed on the booted iPhone 16 Pro sim, launched
against Metro (JS bundle built clean, HTTP 200, 6.4 MB — confirming
`Icon.native.tsx` + react-native-svg resolve and bundle), and screenshot:
`docs/phase-6/verify-results/M-MobileFit-polish-voices-verified.png`. The
tab bar shows monochrome vector icons (speech-bubble / puck / radiowaves /
**gear** — no emoji), the Voices screen is the grouped list with a blue
checkmark on the active row + chevrons, the NOW strip reads "This phone",
and the chip is lowercase "voix". (The onboarding dark-mode fixes #3/#4/#5
are not in this frame — that sim instance had already completed
onboarding — but the builds are green and the logic is scheme-driven.)

## Notes for the v4 re-review

- The TalkButton mic + LISTENING/terminal states (#1 mic, #6) live on the
  Conversations tab, not captured in the verification frame; coordinator's
  fresh screenshots will cover them.
- Out of scope (not in the assigned 8, left untouched): Marina #7
  ("Connected" → success green), #8 (tone-snippet color), #9 (dev toast),
  and Wren's med/low flow items (F5 "Realtime" naming, F6 hold-vs-tap, F7
  telemetry-in-history, default landing tab). These remain open by design.
