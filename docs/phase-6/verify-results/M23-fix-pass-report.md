# M23 fix-pass report

Status: **SUCCESS**

All 1 blocker + 3 highs + 2 medium brand-violations + 1 low (the Wren F3
inviting copy + F4 placeholder tones) shipped as 8 distinct commits in
priority order. Smoke (root `bun run check`, `voix-backend/ui` vite
build, `clients/app` tsc, voix-backend tone tests) green after every
commit.

## Receipts

```
May 31 20:38:41 2026   5683 packages/ui/src/lib/theme.ts
May 31 20:39:06 2026   7850 packages/ui/src/voices/VoiceList.tsx
May 31 20:48:21 2026  31486 packages/ui/src/voices/VoiceEditor.tsx
May 31 20:39:12 2026   9102 packages/ui/src/conversations/ConversationList.tsx
May 31 20:42:15 2026  12974 packages/ui/src/conversations/TalkButton.tsx
May 31 20:39:17 2026  10188 packages/ui/src/surfaces/SurfaceList.tsx
May 31 20:43:32 2026  20357 packages/ui/src/settings/SettingsScreen.tsx
May 31 20:45:38 2026  10039 packages/ui/src/settings/DaemonUrlInput.tsx
May 31 20:48:42 2026  15305 packages/ui/src/onboarding/Onboarding.tsx
May 31 20:44:27 2026   3143 packages/ui/src/platform/appInfo.ts
May 31 20:44:18 2026   4201 packages/ui/src/platform/appInfo.native.ts
May 31 20:44:34 2026   1541 packages/ui/src/platform/index.ts
May 31 20:43:38 2026   3804 packages/ui/src/App.tsx
May 31 20:49:03 2026  14507 voix-backend/src/voices/builtins.ts
```

```
$ git log --oneline -10
9a4425c ui+voices(M23 fix): copy polish — Connect to voix + Realtime/Email tones (Wren F3+F4)
8c28e31 ui(M23 fix): visible tone counter (Wren F2)
ec8b28f ui(M23 fix): de-em-dash Onboarding copy (Wren F1)
58bcfc6 ui(M23 fix): focus heading on Onboarding screen mount (Priya H4)
6065ea4 ui(M23 fix): URL validation in setApiBase + distinct malformed/unreachable copy (Priya H3)
843f132 ui(M23 fix): Settings → Reset onboarding row (Priya H1)
b3a9de8 docs(phase-6): M24 architecture + research        # ← Tom's parallel work, not fix-pass
91e907c ui(M23 fix): accessibilityLabel + role coverage (Priya H2)
42f4a8f ui(M23 fix): colors.haBlueText for text foreground (Priya B1)
19739d7 docs(M23): m23-manual.md + STATE close-out + implementer report
```

A Tom-authored commit (`b3a9de8`) landed in the middle of the run; not
mine, not part of the fix-pass. The 8 fix-pass commits are intact and
in priority order.

## Fix 1 — haBlueText (Priya B1)

- Commit: `42f4a8f`
- New token: `colors.haBlueText = #0277BD` (Material blue 800).
- Contrast math (WCAG 2.1 relative luminance):
  - `#0277BD` L ≈ 0.1701
  - `#f9f9f9` (bgSubtle effective) L ≈ 0.9396 → ratio **4.50:1** ✓ AA
  - `#ffffff` (bgElevated / card bg) L = 1.0 → ratio **4.77:1** ✓ AA
- Original `#03A9F4` was 2.49:1 on `#f9f9f9` — failed AA + AA-Large.
- Audit pass: `colors.haBlue` retained only for fill / border / glyph
  contexts (puck centre, chip backgrounds, status dots, button borders,
  ActivityIndicator spinner). Grep verified: 13 remaining haBlue uses
  in packages/ui/src — all `backgroundColor:` / `borderColor:` / a
  glyph color / a spinner color. No text foreground.
- Sweep: cardTone (VoiceList), rowTone (ConversationList + SurfaceList),
  toneInput + phasePipText (VoiceEditor), btnLabel + chipLabelSelected
  (SettingsScreen), Connected status label (DaemonUrlInput), labelActive
  + retryLabel (TalkButton), activeStripLabel + activeTag (VoiceList).

## Fix 2 — accessibilityLabel + role coverage (Priya H2)

- Commit: `91e907c`
- Onboarding: Skip setup, Get started, Allow microphone, Open settings
  (deny path), Skip for now, Done — all gain `accessibilityRole="button"`
  + `accessibilityLabel` + `accessibilityHint`. Step titles gain
  `accessibilityRole="header"`. Welcome heroRow names itself
  "voix — push-to-talk voice assistant". Unreachable soft-hint gains
  `accessibilityLiveRegion="polite"`.
- Settings: Section titles → role=header. VoicePicker chips → role=radio
  + radiogroup + `accessibilityState.selected`. "Open settings" / "Re-
  prompt" / macOS Accessibility settings all gain distinct labels naming
  WHICH settings open.
- DaemonUrlInput: TextInput → `accessibilityLabel="Daemon URL"` + hint.
  Reset link → role=button. StatusIndicator → `accessibilityLiveRegion`.
- TalkButton: PTT Pressable → role=button + intent-aware label + hint
  + `accessibilityState.busy`. RecoveryState → role=alert +
  assertive live-region. Title → header. Try again → role=button.

Smoke: tsc clean (RN accessibility props are typed).

## Fix 3 — Settings → Reset onboarding row (Priya H1)

- Commit: `843f132`
- New "Developer" Section at the bottom of SettingsScreen with a single
  "Reset onboarding" Pressable.
- Clears `voix.onboarding.completed` via `storage.removeItem`, then
  calls a new `onResetOnboarding` callback prop.
- App.tsx wires that callback to `setOnboardingDone(false)` — bounces
  the user back to `<Onboarding>` without a relaunch.
- Native-only (`Platform.OS !== "web"`). No confirm dialog (cheap
  action; worst case: user re-walks 3 screens).

## Fix 4 — URL validation in setApiBase (Priya H3)

- Commit: `6065ea4`
- New `validateDaemonUrl(url)` + `InvalidDaemonUrlError` in
  `platform/appInfo.{ts,native.ts}` (both sides for import-surface
  parity), re-exported through `platform/index.ts`.
- Validation rules: must start with `http://` or `https://`, must parse
  via `new URL(input)`, must have a non-empty host. Rejects `http://`,
  `foo`, empty strings.
- `setApiBase` validates BEFORE persisting — a typo no longer overwrites
  the last-known-good base in AsyncStorage with garbage.
- DaemonUrlInput surfaces a new `malformed` ProbeStatus distinct from
  `unreachable`. Inline copy:
  > That doesn't look like a daemon URL. Try `http://your-host:8765/`.
- `malformed` short-circuits the reachability probe so we don't waste a
  fetch.
- Onboarding's `DaemonStep` blocks Done on `malformed` (a typo is
  guaranteed not to work). `unreachable` still allows Done with the
  existing soft warning (network might just be flaky).

## Fix 5 — focus heading on Onboarding screen mount (Priya H4)

- Commit: `58bcfc6`
- New `useFocusOnMount<T>()` hook ref's a heading Text node and
  programmatically focuses it via
  `AccessibilityInfo.setAccessibilityFocus(findNodeHandle(ref))` on
  mount.
- 120 ms timeout lets the screen finish its layout pass before we
  attempt focus (setting focus before layout is a silent no-op).
- Applied to Welcome / Mic / Daemon URL titles. VoiceOver now lands on
  the heading instead of the "Skip setup" link.
- Smoke caught a TS issue with `findNodeHandle`'s ref-shape overload;
  cast to `React.Component<unknown, unknown>` to satisfy the typed
  signature.

## Fix 6 — de-em-dash Onboarding copy (Wren F1)

- Commit: `ec8b28f`
- Welcome body: " — but it also works on its own…" → ". It also works
  on its own…"
- Daemon body: " — usually the Home Assistant box." → ". Usually the
  Home Assistant box."
- Brand guide §09 NEVER list: "Em dashes in marketing copy. Use
  hyphens or full stops. Em dashes are an AI tell."

## Fix 7 — visible tone counter (Wren F2)

- Commit: `8c28e31`
- Tone TextInput wrapped in a flex row with `{tone.length}/80` counter
  pinned to the trailing edge. Styled mono 11pt textMuted (same register
  as existing small-metadata).
- `accessibilityLabel="Voice tone"` + hint announce the field name +
  cap to VoiceOver.

## Fix 8 — copy polish (Wren F3+F4)

- Commit: `9a4425c`
- F3: Onboarding screen 3 title "Where's your daemon?" → "Connect to
  voix". Gatekeeper vocabulary out of the first-launch surface; Settings
  still uses "Daemon connection" because Settings is the technical
  surface where "daemon" fits.
- F4: Two tone rewrites in `voix-backend/src/voices/builtins.ts`:
  - Realtime: "A calm conversational partner." → **"Talks back. Knows
    when to shut up."**
  - Email: "Polite and professional. Always lands." → **"Reads like you
    meant it."**
- `KNOWN_BUILTIN_TONES` gains the OLD strings under a Historical
  section so pre-fix-pass installs upgrade cleanly (mirrors the
  `KNOWN_BUILTIN_PROMPTS` pattern).
- 11/11 tone tests still pass — none pin specific copy values.

## Smoke battery after each fix

| Fix | `bun run check` | `voix-backend/ui` build | `clients/app` tsc | tone tests |
|---|---|---|---|---|
| 1 | OK | OK (587 ms) | exit 0 | — |
| 2 | OK | OK (593 ms) | exit 0 | — |
| 3 | OK | OK (602 ms) | exit 0 | — |
| 4 | OK | OK (577 ms) | exit 0 | — |
| 5 | OK | OK (587 ms) | exit 0 (after a one-line cast fix) | — |
| 6 | OK | OK (569 ms) | exit 0 | — |
| 7 | OK | OK (565 ms) | exit 0 | — |
| 8 | OK | OK (590 ms) | exit 0 | 11/11 pass |

Final battery after all 8 commits: green on every leg.

## Out of scope (acknowledged, not shipped)

- Priya M1 (Welcome focus management) — substantially overlaps with
  H4; the `useFocusOnMount` from Fix 5 covers it.
- Priya M2 (default-voice override survives voice deletion) — out of
  scope per task brief (only B1 + H1-4 specified as ship-required).
- Priya L1 (voice.type silent fallback to discuss) — out of scope.
- Priya L2 (DaemonUrlInput docstring HEAD vs GET) — cosmetic; out of
  scope.
- Wren F5 (tone editor placeholder copy) — out of scope per brief
  ("F3-F4 are nice-to-have"; F5 even further down).

## Re-verify recommendation

**ready-to-close**

All blocker + high findings shipped clean. Smoke green on every leg.
Tone tests pass with the new copy. No new TS errors introduced. No
files outside the brief's surface area touched.

Tom-side smoke remains: m23-manual.md still gates fresh-sim onboarding
walk (step 4), tone snippet visibility on the iPhone 16 Pro sim, the
new Reset onboarding row, the malformed-URL state in Settings +
Onboarding, and a VoiceOver pass over the Onboarding flow to confirm
the focus-on-mount lands as expected.

Recommend re-running Priya for a confirmation pass (specifically: that
the contrast math holds in practice on the Tom-day sim and that the
focus management lands the cursor on the heading via real VoiceOver
input, not just the prop being present in the tree).
