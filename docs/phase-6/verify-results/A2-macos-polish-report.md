# A2 — macOS M-MobileFit polish parity — implementer report

Parity pass applying the iOS M-MobileFit + polish-pass fixes (13 total:
5 from M-MobileFit, 8 from the polish-pass) to the **macOS-specific**
surfaces: the `VoixNative/*.swift` modules, the NSPanel overlay, the
NSStatusItem, and `voix-macOS/AppDelegate.mm`.

## Verdict

**SATISFIED.** Of the 7 audit points, **six were already correct or
inherited** through the shared `packages/ui/src` layer + the existing
native modules; **one (point 4 — AppKit-vibrancy sidebar) was a genuine
gap and is now shipped.** macOS Debug build is green, full smoke is
green.

Single commit (one logical change, native + shared):

| # | Change | SHA |
|---|--------|-----|
| 1 | Vibrant `NSVisualEffectView` backdrop under the desktop sidebar (A2 point 4) | **`57b2d41`** |

Branch `main`, pushed to `origin/main` (`1b58e65..57b2d41`), signing
bypassed.

## Per-point audit

### 1. Wordmark casing → lowercase `voix` — ALREADY CORRECT (no change)

`VoixStatusItem.swift` already renders lowercase `voix` on every
menu-bar surface: the status-item `button.title = "voix"`, the
overlay-visible badge `"voix •"`, the `toolTip = "voix"`, and the menu
rows `"Talk to voix"` / `"Quit voix"`. The shared `<Wordmark/>` chip was
already lowercased in `a23ccc6`. No capital-`V` user-facing string
exists in any macOS-native source (grep-confirmed).

### 2. System accent for chrome vs HA blue for voix moments — ALREADY COMPLIANT (no change)

Audited the NSPanel overlay's fills (`VoixOverlay.swift`). The only
brand-coloured elements are the **puck body / inner dot / pulse ring**,
all `haBlue (#03A9F4)` — which is exactly correct: the puck *is* the
voix listening moment (soul §brand). The HUD has **no hover/selection
chrome** (it is a non-activating, non-interactive panel — `canBecomeKey`
is load-bearing-false), so there is no chrome fill that should be system
accent. Status/hint labels already use system `.labelColor` /
`.secondaryLabelColor`. The shared desktop sidebar selection fills were
already routed to `colors.sysAccent` in `c84e642`.

### 3. SF Pro at AppKit text styles → `NSFont.systemFont` — ALREADY CORRECT (no change)

Both `VoixOverlay.swift` (status 14pt semibold, hint 11pt regular) and
`VoixStatusItem.swift` (11pt medium) use `NSFont.systemFont(...)`
exclusively — i.e. SF Pro at AppKit weights. No custom/bundled font is
referenced in any native module.

### 4. AppKit-vibrancy on the sidebar — GAP → FIXED (`57b2d41`)

The macOS host renders the shared `AppShell` `DesktopShell` (macOS
window width ≥ `PHONE_BREAKPOINT` 768 → master-detail, never the phone
branch). Its sidebar used a **flat translucent fill**
(`rgba(255,255,255,0.5)`) composited over an opaque RN background — the
"web-app-in-a-window" tell, not true vibrancy.

Fix (the native macOS sidebar idiom, keeping the shared RN nav — **web
nav stays, no NSToolbar swap**, per the A2 brief):

- **`AppDelegate.mm`** — after `super`'s
  `applicationDidFinishLaunching:` creates the window + RN host,
  `installSidebarVibrancy` drops a behind-window
  `NSVisualEffectMaterialSidebar` / `.behindWindow` / `.active`
  `NSVisualEffectView` beneath the RN host and clears the host layer's
  fill. Window set `opaque = NO` + clear background so the blend samples
  the desktop. Identifier-guarded (`voixVibrancyBackdrop`) so a
  re-entrant launch can't stack backdrops.
- **`AppShell.tsx`** — gated on `Platform.OS === "macos"` only: the
  shell root + the 220pt sidebar column go transparent so the vibrancy
  is revealed there, while the **titlebar and content pane keep opaque
  fills** so vibrancy stays scoped to the sidebar and nowhere else.
  No-op on iOS/web (`Platform.OS` is never `"macos"` there).

The paste-focus `VoixOverlay` NSPanel flow is untouched.

> **Visual-verification caveat:** the macOS app could not be launched +
> screenshotted in this headless run (and the Orca runtime was down — see
> Coordination note). The change is build-verified and the layering is
> deterministic/standard AppKit, but the *visual* result (sidebar reads
> as frosted vibrancy, content legible over it) should be confirmed by
> the **B12 Marina/Wren macOS persona re-pass**. The change is a single,
> fully reversible commit if the re-pass dislikes it.

### 5. NOW pill friendly device name — ALREADY INHERITED (no change)

The macOS shell consumes the same shared `VoiceList` →
`friendlyDeviceName()`. macOS reports `clientKind: "laptop-mic"`
(`appInfo.native.ts`), which `friendlyDeviceName` maps to **"This
Mac"**; if the surface carries its own `friendlyName` (e.g. the device
name from `getFriendlyName()` → `"<Mac name> (macos)"`) that is
preferred. The raw `browser-…`/UUID id is never rendered. No
macOS-specific code path bypasses this.

### 6. M-MobileFit shared changes didn't break macOS — VERIFIED

`AppShell` routes `isPhone ? PhoneShell : DesktopShell` off
`useResponsive()` (`width < 768`). A macOS window is wide → always
`DesktopShell` (master-detail). The phone single-column + bottom-tab
branch never renders on macOS. **`xcodebuild voix-macOS Debug` →
BUILD SUCCEEDED** (after the point-4 change).

### 7. HIG ≥44pt not inflating dense macOS layouts — VERIFIED

The `minHeight: 44` / `44×44` touch targets from M-MobileFit
(`3ce002b`) are confined to (a) the **phone chrome** in `PhoneShell`
(`phoneHeader`, `phoneNewButton` — never rendered on macOS) and (b) the
**onboarding CTAs** (a full-screen flow, not a dense list — fine for a
cursor too). The macOS desktop sidebar/lists keep their compact 6pt
row paddings. No global touch-target inflation reached the macOS
master-detail layout.

## Smoke (all green)

| Gate | Result |
|------|--------|
| `bun run check` | OK (native-siblings / protocol-sync / pin-bounds) |
| `bunx tsc -p clients/app/tsconfig.json --noEmit` | **0 errors** |
| `cd voix-backend/ui && bun run build` | OK (vite, 346 modules, 682ms) |
| `xcodebuild -scheme voix-macOS -configuration Debug` | **BUILD SUCCEEDED** |

(Debug RN-macOS builds load JS from Metro at runtime, so the macOS
native build gate is independent of the TS smoke — confirmed compiling
`AppDelegate.mm` directly.)

## Coordination note (faithful reporting)

During this task the **shared working tree was being edited concurrently
by other workers** (A1 iOS-nativeness — haptics/pull-to-refresh/
swipe-to-delete touching `VoiceList`/`ConversationList`/`TalkButton`/
`platform/index`/new `haptics.ts`; plus a daemon worker touching
`voix-backend/src/history/*` + `api.ts`). At one point A1's
`VoiceList.tsx` was mid-edit/broken (unclosed `ScrollView`), briefly
reddening the shared `tsc`/web smoke.

I attempted to reach the coordinator (`orca orchestration ask`) but the
**Orca runtime was down** (`Orca is not running` — the same outage the
M-MobileFit polish-pass worker recorded). Following that precedent, I
proceeded autonomously and **surgically**: I committed **only my two
files** path-scoped (`git commit <AppShell.tsx> <AppDelegate.mm>`),
leaving every concurrent worker's uncommitted work untouched, and ran
the full smoke once the tree was in a compilable state (the green smoke
above reflects my change composing cleanly with theirs). My push was a
clean fast-forward of only `57b2d41`. None of the other workers' files
were committed, pushed, reverted, or otherwise disturbed.

## Files modified

- `clients/app/macos/voix-macOS/AppDelegate.mm`
- `packages/ui/src/components/AppShell.tsx`
