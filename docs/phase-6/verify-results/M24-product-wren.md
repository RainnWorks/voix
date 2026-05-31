# M24 Product verify — Wren

Surface: iOS keyboard extension (`VoixKeyboard`) + host bounce capture.
Lens: voice-first product / brand. The keyboard is voix's most public
surface — every iOS text field becomes a voix entry point.

## Receipts

Files read (`stat -f "%Sm %z %N"`):

```
May 31 21:29 2026 13147 clients/app/ios/VoixKeyboard/KeyboardViewController.swift
May 31 21:18 2026  5835 clients/app/ios/VoixKeyboard/KeyboardRootView.swift
May 31 21:17 2026  1671 clients/app/ios/VoixKeyboard/KeyboardState.swift
May 31 21:17 2026  2033 clients/app/ios/VoixKeyboard/CaptureSession.swift
May 31 21:26 2026 10110 packages/ui/src/conversations/KeyboardCaptureScreen.tsx
            (App.tsx keyboardCapture route + intent grep)
            (packages/ui/src/lib/theme.ts haBlue token)
            voix-brand-guide.html  (HA blue, puck variants, wordmark lockup)
docs/phase-6/architecture-m24.md  (Decisions 4, 5, 10)
docs/phase-6/verify-results/M24-implementer-report.md
```

Method: read every keyboard Swift source, the capture screen, the host
route wiring, the brand guide tokens, and cross-checked the implemented
colors / glyphs / copy against `voix-brand-guide.html` and `theme.ts`.

## Brand continuity

Walked all five surfaces of the flow: **keyboard pill → Full Access
onboarding → bounce → capture screen → return/insert**. The structure
is right and the copy is voix-considered. But the flow is **not color-
continuous**: the keyboard pill and the capture screen render two
*different* blues, and neither matches the puck's brand shape language.

| Surface | Brand expectation | Implemented | Match |
|---|---|---|---|
| Pill fill | HA blue `#03A9F4` (brand guide + `theme.ts`) | `#18BCF2` (hardcoded in `KeyboardRootView`) | ✗ wrong blue |
| Pill label | ink-on-blue (`.btn-primary-blue { color: var(--ink) }`) | white text | ✗ off-convention |
| Puck glyph | ink **squircle** body + HA-blue center dot (`.puck-icon-*`) | white **circle** + blue dot (kbd); elevated **circle** + blue dot (capture) | ✗ shape + body |
| Capture puck blue | HA blue `#03A9F4` | `colors.haBlue` = `#03A9F4` | ✓ |
| Wordmark | glyph + "Voix" + `/vwa/` lockup | bare `Text("voix")`, no glyph, no pronunciation | partial |
| Onboarding path | JetBrains-mono meta styling | `.monospaced` system font | ✓ in spirit |
| Intent | locked `dictate` | `intent: "dictate"` explicit | ✓ |

Net: the *information design* is brand-considered (single-purpose
keyboard, calm copy, honest privacy line), but the *brand marks* — the
hero blue and the hero puck — are reproduced approximately rather than
from the brand source. On voix's most public surface, that's the thing
the brief warned about.

## Findings by severity

### HIGH — Pill uses a non-brand blue (`#18BCF2`), breaking color continuity across the bounce

`KeyboardRootView.swift:32` hardcodes the pill fill as
`Color(red: 0x18/255, green: 0xBC/255, blue: 0xF2/255)` = **`#18BCF2`**.
voix's HA blue — in `voix-brand-guide.html` (`--ha-blue: #03A9F4`) and
in `packages/ui/src/lib/theme.ts` (`haBlue: "#03A9F4"`) — is
**`#03A9F4`**. `#18BCF2` is the *Home Assistant company* blue; `#03A9F4`
is the blue voix's brand guide actually adopted. They are visibly
different (the keyboard's is lighter and more cyan).

Why it matters on this surface specifically: the user taps a `#18BCF2`
pill, bounces to the host, and immediately sees the capture screen's
puck core rendered in `#03A9F4` (`KeyboardCaptureScreen.tsx` →
`colors.haBlue`). The single most important brand color changes shade
*mid-interaction*, and the pill disagrees with every web/app surface
voix ships. "HA blue carrying state — when you see it, voix is doing
something" (brand guide §colour) only reads as one consistent signal if
it's one consistent hex.

Fix: replace the hardcoded `haBlue` in `KeyboardRootView` with
`#03A9F4` (and ideally source it from a shared constant so it can't
drift again). One-line change; high brand payoff.

### MEDIUM — No keyboard-adoption hint in the host app, and "Open Settings" lands nowhere useful

Two coupled gaps:

1. **Adoption (brief task 7).** There is no in-app hint, first-launch
   note, or Settings row pointing the user to *System Settings →
   General → Keyboard → Keyboards → add voix*. I grepped
   `packages/ui/src/settings/` and the host — `SettingsScreen.tsx` has
   no "Set up voix keyboard" row. A user who installs voix has no
   in-product path to discover that a keyboard exists. The keyboard is
   the most public surface and currently has zero on-ramp.

2. **Broken guidance chain.** The Full Access onboarding's "Open
   Settings" button calls `UIApplication.openSettingsURLString`
   (`KeyboardViewController.swift:330`), which — as the code's own
   comment and Architecture Decision 5 acknowledge — drops the user on
   the *host app's* settings pane, not the keyboard pane. Decision 5
   says this is "acceptable because the host app's Settings → 'Set up
   voix keyboard' row walks the user to the right pane." **That row was
   never built.** So tapping "Open Settings" lands the user on a host
   settings screen with no onward guidance to the Keyboard pane. The
   onboarding's one actionable CTA dead-ends.

Fix: add a "Set up voix keyboard" row to `SettingsScreen.tsx` with the
exact tap-path (mirroring the keyboard's own mono path string), and
surface it as a first-launch hint. This closes both the adoption gap
and the onboarding dead-end with one component.

### MEDIUM — The brand puck is reproduced as a plain circle, not the ink squircle mark; no vector assets imported

The puck is voix's hero mark ("The puck deserved better", brand guide
§system). Every brand puck variant (`.puck-icon-sm/md/lg`,
`.anatomy-puck`, `.puck-hero`) is an **ink rounded-square (squircle)
body with a centered HA-blue dot** — the squircle is the shape
language. The implementation renders:

- Keyboard pill: `Circle().fill(white).overlay(Circle().fill(haBlue))`
  (`KeyboardRootView.swift:101`) — a white circle, blue dot.
- Capture screen: `borderRadius: 48` on a 96×96 view = a circle, blue
  core (`KeyboardCaptureScreen.tsx` styles).

Both drop the squircle for a circle and (on the pill) invert the body
to white. Architecture Decision 4 explicitly called for importing the
wordmark + puck **PDF vectors** from the brand guide into
`Assets.xcassets`; the directory listing shows **no `Assets.xcassets`**
in `VoixKeyboard/`, and the implementer receipts list none. So the
brand mark is being approximated programmatically rather than rendered
from the source artwork.

This is defensible as an MVP (the programmatic puck is small and
on-budget), but on the marquee surface the hero mark should be the real
mark. Fix: import the puck PDF, render the squircle body (corner radius
≈ body×0.23 to match `.puck-icon-lg`), keep the blue dot. The "circle"
shortcut reads as generic; the squircle is what makes it *voix*.

### LOW — Pill label is white-on-blue; brand convention is ink-on-blue

`.btn-primary-blue { background: var(--ha-blue); color: var(--ink); }`
(brand guide:147) — voix's primary blue button uses **ink** text. The
pill uses white (`KeyboardRootView.swift:74`). Beyond the convention
miss, `theme.ts` notes haBlue "fails WCAG AA" as a text-adjacent color;
white on `#03A9F4` is ~2.8:1 (sub-AA), whereas ink-on-blue is the
contrast-safe pairing the brand already chose. Switching the label to
ink both matches the brand and fixes contrast. (Lower priority than the
fill hex — fix alongside the HIGH.)

### LOW — Keyboard wordmark is bare "voix", missing the glyph + `/vwa/` lockup

The brand wordmark is a lockup: `glyph + "Voix" + /vwa/`
(`voix-brand-guide.html:554`). The keyboard renders just
`Text("voix")` (`KeyboardRootView.swift:57`) — no leading glyph, no
pronunciation. Architecture Decision 4 only specced a 16pt "voix"
wordmark, so this is *spec-compliant*, but on the most public surface
the wordmark is the one place to plant the full lockup. The brief
asked for it explicitly. Not blocking; worth a glyph at minimum (it's
the same squircle asset as the puck fix above).

### NIT — "voix is listening…" pill copy during the bounce

While `phase == .bounced` the pill reads "voix is listening…"
(`KeyboardRootView.swift:117`). Technically it's the *host app* that's
listening; the keyboard is waiting for the return. Users won't be
confused (voix-as-a-whole is listening), but "voix is listening…" on a
surface that isn't the one with the mic is a small honesty wobble. "One
sec…" or "Listening in voix…" would be marginally truer. Cosmetic.

## What's genuinely good (not findings)

- **Intent semantics (brief task 5) — correct.** `KeyboardCaptureScreen`
  passes `intent: "dictate"` explicitly to `BrowserAudioIoClient`; it
  is not silently defaulting. Keyboard = dictate is honored end-to-end.
- **Capture surface (task 3) — right call.** A dedicated, chrome-free
  `KeyboardCaptureScreen` (puck + "Listening" + "Returning to keyboard
  when you stop speaking. 30s max.") rather than the M21 PTT screen.
  No AppShell, no nav — single-purpose, dismisses itself.
- **Return UX (task 4) — complete and calm.** "voix is listening…"
  working state → instant `insertText` → friendly per-error toasts
  (`mic_denied` → "Mic permission denied", `no_speech` → "Didn't catch
  anything", timeout → "voix couldn't record"). Failure copy is
  product-considered, not boilerplate.
- **Full Access onboarding (task 2) — kindly, not a dead view.** Clear
  explanation, tappable "Open Settings" CTA, mono path string, and the
  reassurance line "Your text stays on your devices." (the privacy
  promise stated plainly). The *copy* is excellent — only the CTA
  destination (Medium finding above) lets it down.
- **Globe-key UX (task 6) — clean.** voix is one-tap (tap pill); the
  globe is bottom-right at a 44pt target with tap=advance,
  long-press=switcher. Not confused.

## Watching briefs forward

- **Tone gap (CLOSED M23) — N/A by design, confirmed.** The keyboard
  never picks a voice; capture is locked to `dictate` with the user's
  default-dictation voice. There is no "active voice tone" to preserve
  through this bounce — the keyboard is deliberately voice-agnostic.
  Nothing regressed; the M23 closure holds.
- **macOS hotkey rebind UI — still M23.5 deferred.** Untouched by M24.
- **Apple Developer Program seat — Tom dependency, live.** Physical-
  device acceptance (Full Access toggle, ≥4 host apps, memory profile,
  background re-entry) cannot be sim-driven and remains Tom-pending per
  the implementer's Tom-pending list. All four brand findings above are
  source-side and do **not** need a device to fix — they should land
  before the physical acceptance pass so Tom isn't profiling an
  off-brand build.

## Verdict

Logic and information design: solid, brand-considered, ship-shaped.
Brand *marks*: the hero blue is the wrong hex (`#18BCF2` vs `#03A9F4`)
and the hero puck is a generic circle, both on voix's most public
surface — exactly the "get this right or the brand promise breaks"
risk the brief named. None block function; all are small, localized
fixes. Recommend the HIGH (pill blue) and both MEDIUMs (adoption row /
Settings dead-end, puck mark) land before tagging the surface done.
Empty-findings was not warranted — but nothing here is structural.
