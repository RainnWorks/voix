# Marina's M20 product review

M20 is structural — RN-CLI scaffold + macOS target + Tauri archive +
two Hiro carry-forwards + a 30-LOC apiBase shim. No user-visible
feature change. The product lens is **continuity-of-intent**: brand
layer survives, Tom's pre-pivot Tauri work is preserved (not
silently dropped), and the native shell renders the same `<App />`
the web target renders.

Reviewed: SUCCESS. Brand layer is intact, M02e voice rename intent
made it to the legacy branch in all three required files, the native
`index.js` is the plain three-line registration the brief specified,
and the `TODO(M21)` marker for the hardcoded LAN IP is in place.

## Receipts

```
git diff --stat f9c6c92..HEAD -- packages/ui/src/
# 15 files changed, 82 insertions(+), 46 deletions(-)
# Pure extension strips + apiBase.{ts,native.ts} additions +
# 9-line api.ts wrapping (import + getApiBase() prefix + comment).

git log --oneline -3
# 13a4336 docs(M20 step10): close M20 + queue M20a + Tom's manual smoke
# 370bcaa archive: remove Tauri app/ — see legacy/tauri-clipboard
# 49ad1ab archive: snapshot Tauri app/ before removal

git ls-remote origin legacy/tauri-clipboard
# 2ec5eaced2d494f12cee1096b54b6ac4e104a38d
```

## Brand continuity through the scaffold

### 1. Brand layer untouched ✓

```
$ git diff --stat f9c6c92..HEAD -- packages/ui/src/lib/theme.ts \
                                    packages/ui/src/components/
 packages/ui/src/components/AppShell.tsx | 6 +++---
 packages/ui/src/components/Puck.tsx     | 2 +-
 packages/ui/src/components/Wordmark.tsx | 4 ++--
 3 files changed, 6 insertions(+), 6 deletions(-)
```

`theme.ts` is **byte-identical** between `f9c6c92` and HEAD (diff
returns empty). The three component-file edits are exclusively the
Hiro Delta D extension strip — every changed line is `from
"...theme.ts"` → `from "...theme"` or `from "./Puck.tsx"` → `from
"./Puck"`. No layout, no color, no font, no copy was touched. The
puck glyph rendering, the wordmark, and the sidebar / titlebar
chrome match M19 close-out exactly.

### 2. api.ts edit is exactly the apiBase wrap ✓

```
$ git diff f9c6c92..HEAD -- packages/ui/src/lib/api.ts
# +6 doc lines about native targets
# +1 import { getApiBase } from "./apiBase"
# -1 / +1 fetch(path, ...) → fetch(getApiBase() + path, ...)
```

Single fetch site (the `api<T>` helper at line ~58) prefixed with
`getApiBase()`. All concrete API calls go through that helper, so
this single edit covers every endpoint — voices, conversations,
surfaces — without touching their individual call sites. Step 7
shape matches the architecture-m20 Decision 7 spec.

### 3. `clients/app/index.js` is plain `<App />` registration ✓

```js
import { AppRegistry } from "react-native";
import { App } from "@voix/ui";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
```

Three import lines + one register. No SafeAreaProvider, no
NavigationContainer, no top-level wrapper, no native chrome. The
header comment explicitly defers all platform shims to M21. This
is "same App, native bindings" as the brief specified — the native
shell will render the same sidebar (New conversation, Today /
Kitchen quick chat sample, Voices count = 6 with Puck glyph,
Surfaces gear) that the web target renders today.

### 4. `apiBase.native.ts` carries the `TODO(M21)` marker ✓

```ts
// TODO(M21): user-configurable daemon URL in a settings screen.
const DEV_DAEMON_URL = "http://192.168.99.86:8765/";
```

Plus a header docblock that explicitly calls out the M20-vs-M21
boundary. The marker is greppable for the M21 milestone owner.

### 5. M02e voice-rename intent preserved in legacy branch ✓✓✓

All three required files return matches:

```
$ git log legacy/tauri-clipboard -p -- app/src-tauri/src/commands.rs \
    | grep -E "voix\.list_voices|HaVoice|voice_id|cycle_voice"
+    // Prefer the integration's `voix.list_voices` service: it returns the
+    // canonical voice_ids straight from entry.options[modes] (e.g.
+    // The service was renamed from voix.list_modes → voix.list_voices
+    // key is `voice_id` (was `mode_id`).
+        return Err(format!("voix.list_voices failed: {body}"));
+            // Field key renamed mode_id → voice_id in M02b.
+            let mode_id = row.get("voice_id")?.as_str()?.to_string();

$ git log legacy/tauri-clipboard -p -- app/src-tauri/src/tray.rs \
    | grep -E "voix\.list_voices|HaVoice|voice_id|cycle_voice"
+//! The cycle-voice menu item invokes the HA `voix.cycle_voice` service via
+    // voix.cycle_voice (M02b canonical). The old voix.cycle_mode alias
+        "{}/api/services/voix/cycle_voice",
+        return Err(format!("HA cycle_voice failed: {body}"));

$ git log legacy/tauri-clipboard -p -- app/src/settings.js \
    | grep -E "voix\.list_voices|HaVoice|voice_id|cycle_voice"
+  // voix.list_voices (M02b rename of voix.list_modes). Falls back to
+    // Row id key is `voice_id`. The locally-cached row still uses
+    const wantedId = m.mode_id || m.voice_id;
+    full = rows.find((r) => r.voice_id === wantedId) || null;
+    console.warn("voix.list_voices not available", e);
+  // M02b rename: voix.update_voice with voice_id field. Internal JS
+    voice_id: editingModeId,
+    data: { voice_id: editingModeId },
```

Tom's M02e on-disk rename (which never made it into a commit on
`main` because `app/` was entirely untracked) is now durably
preserved on `origin/legacy/tauri-clipboard` at SHA `2ec5eac`.
Risk #5 in the architecture's risk register is closed.

### 6. Relic-vs-new naming convergence ✓ (with one nit)

The relic's user-visible framing was **"Voix companion app —
receives transcripts from HA, puts them on the clipboard,
optionally pastes"** (legacy `app/package.json` description). That
framing does NOT appear in the new shell:

- `clients/app/package.json` → `"name": "voix-app"`, no `description` field.
- `clients/app/app.json` → `"name": "voix"`, `"displayName": "voix"`.
- No string `"Companion"`, `"companion"`, or transcript-clipboard
  framing anywhere under `clients/` or `packages/`.

The npm package name `voix-app` is a coincidence of monorepo
conventions, not a relic carry-over — it's a leaf-internal id, not
user-facing. The user-visible string is `displayName: "voix"`, which
matches the brand guide's lowercase wordmark.

Nit: `voix-app` as a leaf-npm name is slightly confusing now that
the relic also called itself `voix-app`. Consider renaming the
package to `@voix/app` in M22 or M23 to match the `@voix/ui` /
`@voix/protocol` convention. Not blocking; not user-visible.

## Findings, by severity

### Brand or intent regressions
None.

### UX drift
None at the M20 surface — nothing user-visible changed. Two
watching-brief items for M21 (below) describe drift that's only
latent until native runs.

### Watching briefs

1. **Tone gap (M04, M13b, M16, M19, M20 all deferred).** Voice
   schema still has no `tone` field. The brand guide allocates
   space for "voice tone" affordances, the desktop guide doesn't
   surface it, and we've now deferred it five milestones running.
   At some point this stops being "deferred" and starts being
   "decided against by attrition" — flag for the M21 / M22
   architect to either schedule or formally close.

2. **"Daemon unreachable" UX state.** When Tom takes the iPhone
   off-LAN, `getApiBase()` will still return the LAN IP
   `192.168.99.86:8765`, the fetches will fail with a connection
   refused, and the current `api.ts` error banner will say "fetch
   failed" — indistinguishable from the empty-list case. M21
   should add an explicit "daemon unreachable" state distinct from
   "no data yet." Acceptable for hello-world on Tom's LAN; not
   acceptable for a first iPhone demo at a coffee shop.

3. **LAN IP is hardcoded for one machine.** `192.168.99.86` is
   Tom's Mac. When the daemon eventually moves (HA-host runtime,
   second dev machine, a teammate's laptop), every developer will
   have to edit `apiBase.native.ts` before they can run native.
   The `TODO(M21)` marker is in place, but verify that M21's
   settings screen is ALSO a developer onboarding affordance, not
   just a Tom-runtime affordance.

4. **`14.0` macOS floor vs M19's brief `11.0`.** The Implementer
   surfaced this; product-side the implication is zero (Tom's Mac
   is 26.3, no real user runs voix on a 2020 Intel MacBook). But
   if voix ever ships to non-Tom users on older Macs, the floor
   needs to come down to 12.0 or 11.0. Not an M20 blocker;
   acceptance criterion 9 is a ⚠ that the verifier should
   downgrade to ✓ now that we know the upstream template defaults
   to 14.0.

## The one thing the brief should have anticipated but didn't

**The legacy branch's `description` field carries the old framing.**
The pre-pivot Tauri tree's `app/package.json` describes itself as
"Voix companion app — receives transcripts from HA, puts them on
the clipboard, optionally pastes." That description is now durably
preserved on `origin/legacy/tauri-clipboard` — which is correct
(it's a historical artefact) — but it's a footgun:

- If anyone in M22+ greps the org-wide repo for "voix" looking for
  product framing, they'll get hits on the legacy branch first
  (alphabetical, and the relic has more package.json entries than
  the new shell does).
- If we ever publish this repo, the legacy branch will surface in
  GitHub's branch dropdown as a tempting "alternative" history.

Mitigation: add a `LEGACY.md` to the root of the legacy branch
explaining the pivot and pointing to `main`. Cheap, durable,
sets expectations. Not blocking M20; file as M20.1 or carry into
M21's docs sweep. The architecture-m20 doc's Decision 1 anticipated
the *secrets* sweep but not the *narrative* sweep.
