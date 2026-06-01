# B8 — Settings "Daemon URL" edit affordance (post-onboarding)

**Date:** 2026-06-01
**Item:** B8 (Phase 6 overnight backlog) — "Friendly daemon-URL editor (post-onboarding)" / Marina v3 H5.
**Outcome:** ✅ Verified — affordance already present; one spec-alignment fix applied.

---

## TL;DR

The friendly daemon-URL editor B8 asks for **already exists in Settings**.
It is the *same* `DaemonUrlInput` component used by onboarding step 3 —
the real input affordance shipped to that shared component in
`194374d` (*"fix(ui/onboarding): give the daemon URL field a real input
affordance"*, the M-MobileFit polish-pass cited in the task), and
`SettingsScreen.tsx` renders the identical component. So Settings
inherited every affordance automatically.

Verification found **5 of 6 requirements fully met** and **one genuine
spec gap** (placeholder copy), which has been fixed.

---

## Requirement-by-requirement verification

Source of truth:
- `packages/ui/src/settings/SettingsScreen.tsx` — "Daemon connection" Section, lines ~202-210.
- `packages/ui/src/settings/DaemonUrlInput.tsx` — the shared component.
- `packages/ui/src/onboarding/Onboarding.tsx` — step 3 renders the same component (`import { DaemonUrlInput } from "../settings/DaemonUrlInput"`).

| # | B8 requirement | Status | Evidence |
|---|----------------|--------|----------|
| 1 | Daemon URL row exists in Settings | ✅ Met | `SettingsScreen.tsx` "Daemon connection" Section → `<Row label="URL" … control={<DaemonUrlInput />} />` (gated `Platform.OS !== "web"`). |
| 2 | Renders as editable `TextInput` with iOS native treatment (rounded border, focus ring, placeholder) | ✅ Met | `DaemonUrlInput` renders a `<TextInput>` with `borderRadius: radius.sm` (rounded), a **focus ring** (`borderColor: focused ? accent : border`, `borderWidth: focused ? 1.5 : hairline*2`), `keyboardType="url"`, `autoCapitalize="none"`, `autoCorrect={false}`, and a placeholder. |
| 3 | Uses the SAME shared affordance as onboarding step 3 | ✅ Met | Both Settings and `Onboarding.tsx` import the one `DaemonUrlInput`. Onboarding passes a dark-canvas `appearance` override; Settings uses the light default. One component, one behaviour. |
| 4 | On change persist via `appInfo.setApiBase`; on blur verify reachability + update Connected/Unreachable indicator | ✅ Met | Debounced (600 ms) probe `fetch(${base}api/voices_count)` → `StatusIndicator` shows **Probing… / Connected / Unreachable** (+ a distinct **Malformed** state, Priya H3). `handleBlur` persists via `appInfo.setApiBase(url)`. `onChange?.(url, status)` mirrors to callers. |
| 5 | "Reset to default" link below the field — same as onboarding | ✅ Met | `showResetLink` defaults `true`; renders a "Reset to default" `Pressable` below the input (hidden on web). Onboarding passes `showResetLink` too — same affordance. |
| 6 | "Re-run onboarding" link at the bottom of Settings → Developer (Priya H1 carry-forward) | ✅ Met | `SettingsScreen.tsx` "Developer" Section (last section, native-only) → **"Reset onboarding"** row. Clears `ONBOARDING_COMPLETED_KEY` and fires `onResetOnboarding?.()` so `App.tsx` swaps `<Onboarding>` back in. Shipped in `843f132` (*"Settings → Reset onboarding row (Priya H1)"*). Label reads "Reset onboarding" rather than "Re-run onboarding"; functionally identical (clears flag → replays the three screens). Left as-is to avoid churning the existing accessibilityLabel; flagged here for naming consistency if the coordinator prefers the spec wording. |

---

## The one fix applied

**Gap:** the placeholder was the *concrete* dev default
(`http://192.168.99.86:8765/`) — identical to the value the
"Reset to default" link writes. An empty field therefore looked
**pre-filled** and was visually indistinguishable from a populated one.
The B8 spec calls for a generic pattern placeholder
(`http://192.168.x.x:8765/`).

**Fix (commit `c6747d8`):**
- Placeholder → generic `http://192.168.x.x:8765/` (new
  `DAEMON_URL_PLACEHOLDER` constant in `DaemonUrlInput.tsx`).
- "Reset to default" target now sourced from a single exported
  `DEFAULT_DAEMON_URL` on the `appInfo` platform shim
  (`appInfo.native.ts` = `http://192.168.99.86:8765/`, `appInfo.ts`
  web = `""`), re-exported through `platform/index.ts` — removing the
  duplicated literal that previously lived inside the component.
- Web parity preserved: reset link is `!isWeb`-gated, so web's empty
  `DEFAULT_DAEMON_URL` is never used as a reset target; the export
  exists purely for import symmetry.

Files modified:
- `packages/ui/src/settings/DaemonUrlInput.tsx`
- `packages/ui/src/platform/appInfo.native.ts`
- `packages/ui/src/platform/appInfo.ts`
- `packages/ui/src/platform/index.ts`

---

## Smoke results

| Check | Command | Result |
|-------|---------|--------|
| Repo guards | `bun run check` | ✅ OK (native-siblings / protocol-sync / pin-bounds) |
| Web UI typecheck + build | `cd voix-backend/ui && bun run build` | ✅ `tsc --noEmit` clean + `vite build` 348 modules, 375 kB |
| App typecheck | `bunx tsc -p clients/app/tsconfig.json --noEmit` | ✅ exit 0, no errors |
| iOS Debug | `xcodebuild -workspace clients/app/ios/voix.xcworkspace -scheme voix -configuration Debug -sdk iphonesimulator -destination id=<iPhone 16 Pro sim> build CODE_SIGNING_ALLOWED=NO` | ✅ **BUILD SUCCEEDED** |

---

## Notes / carry-forward

- **#6 label**: "Reset onboarding" vs spec's "Re-run onboarding" — cosmetic;
  left unchanged. Coordinator may rename if exact spec wording matters.
- No behavioural change to the probe, persistence, or indicator — those
  were already correct from M23 + the `194374d` polish-pass. B8 was
  fundamentally a **verification** item; the placeholder was the only
  real defect.
