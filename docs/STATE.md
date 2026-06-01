# voix · Current State

_Last updated 2026-06-01. This file is the cold-read entry point — it should
answer "what's the current state of voix?" in under 5 minutes. The full
historical narrative (per-milestone diaries M01–M24, the pre-M01 snapshot,
lessons-learned, the old next-iteration test plan) was pruned out on
2026-06-01 and archived verbatim at
`docs/session-handoff/2026-06-01-overnight.md`._

---

## Current phase status

- **Phases 1–5 — complete on source.** 18 milestones + an adversarial audit
  pass that shipped 9 fixes (`9dc5c0b`). Tags `v0.phase-1`, `v0.phase-2`.
  `v0.phase-3/4/5` untagged — blocked on the **verification cliff**: only
  M01 + M02b/c/d ever ran against real systems; everything M08+ has only run
  against stubs / synthetic audio / a compiled-but-never-flashed binary. Two
  deploy blockers gate it: **#124** puck OTA (firmware compiled `fa58375`,
  never flashed) and **#130** `DEEPGRAM_API_KEY` + real dictate round-trip.
- **Phase 6 (RN end-to-end) — closed on source + verified.** M19–M24 +
  M-Arch Wave A/B all merged to main. See the verdict below. Tag
  `v0.phase-6` pending Tom physical-device acceptance (Architect Decision 7
  + Coordinator Delta B).
- **M-MobileFit + 2026-06-01 overnight polish (A1–A3, B1–B5) — closed on
  source.** See the M-MobileFit closure summary below.
- **Next up:** **M20a** (HA Add-on Docker context shift — still queued;
  until it lands the production *stable-channel* Add-on build is broken,
  only `dev_mode` works) and **Phase 7 / M25** (HA connector trim to
  ~600–800 LOC). Overnight backlog: `/tmp/voix-overnight-backlog.md`.

---

## Phase 6 closed-on-source verdict

Phase 6 shipped end-to-end through M24 + M-MobileFit. voix now ships four
client surfaces off one shared `@voix/ui` component layer:

- **Web** (HA add-on iframe, react-native-web) — the original ingress UI,
  unchanged.
- **macOS shell** — global hotkey ⌃⌥Space → PTT overlay HUD → clipboard +
  (with Accessibility) auto-paste into the focused app; native AVAudioEngine
  capture + playback; menu-bar status item.
- **iOS app** — 3-screen onboarding, Voices / Conversations / Surfaces /
  Settings, press-to-talk via `react-native-audio-api`, background-audio
  mode.
- **iOS keyboard extension** — a zero-key dictation keyboard that bounces to
  the host app for capture (Apple constraint) and returns text via the App
  Group `group.co.rowm.voix`.

After **M-Arch Wave A+B** the LLM/Realtime surface is genuinely
provider-agnostic: a neutral `RealtimeEvent` union owns the boundary, OpenAI
SDK types stop at the `realtime/openai.ts` adapter, `pipeline/realtime.ts`
is a switch on the neutral union, and `realtime` is a registry kind
(`/api/providers?kind=realtime` → `["openai"]`). The next provider swap is a
one-file PR. **140 daemon tests pass.**

Verify reports for every milestone live under
`docs/phase-6/verify-results/` (implementer + tester + adversary + product +
fix-pass across M19–M24 + Wave A/B). Per-milestone architecture briefs at
`docs/phase-6/architecture-m19.md` … `architecture-m24.md`.

---

## M-MobileFit closure summary (2026-06-01)

After Marina/Wren v3+v4 live-smoke passes against the iPhone build, the
mobile-fit polish work closed on source:

- **M-MobileFit polish-pass** — 8 HIGH findings from Marina/Wren v3 shipped,
  each its own commit (`ceeca4c`, `eb35379`, `e8250c5`, `62027e7`,
  `194374d`, `2f10ef6`, `c84e642`, `a23ccc6`): SF-Symbol-equivalent
  monochrome glyphs (new platform-split `Icon.{tsx,native.tsx}` via
  react-native-svg; web keeps a text fallback), inset-grouped Voices list,
  distinct TalkButton LISTENING + terminal states, friendly NOW-strip
  surface name (never a raw session-id), daemon-URL input affordance,
  system-label onboarding titles, chrome routed to system accent (HA blue
  reserved for voix moments), lowercase "voix" wordmark chip.
- **A2 macOS polish parity** + **A3 Marina/Wren low/med cleanups** shipped.
- **B1 empty + error states** (6 commits, `c3d95d5`…`ccf9efe`) —
  daemon-unreachable banner, Conversations + Surfaces empty states, Voices
  loading spinner, non-modal voice-editor save toast, TalkButton missing-key
  hint.
- **B2 tone-snippet copy polish** — user-facing em-dashes purged from
  microcopy; tone snippets confirmed on-brand.

Reports: `docs/phase-6/verify-results/{M-MobileFit-*,A2-*,A3-*,B1-*,
tom-smoke-v3-*,tom-smoke-v4-*}.md`.

---

## Tom-pending hands-on list (live-device behaviour, M19–M24)

These are the only items requiring Tom's physical hands — physical hardware,
Accessibility/App-Group grants, or sim taps the sandbox can't drive.
Code-side shipped + verified clean otherwise. Recovery one-liners,
screenshots, and per-step expectations are consolidated in
**`docs/phase-6/tom-manual.md`**.

1. **macOS visual confirm with live Metro** — run `scripts/macos-screenshot.sh`
   after `bun run start` is live (M20's prior screenshot caught the
   no-Metro-stalled state).
2. **iOS PTT hold-button round-trip** — sim visually confirmed rendering
   `@voix/ui` via daemon-fetch; hold-to-talk is mechanically wired through
   `react-native-audio-api` but never end-to-end-tested.
3. **macOS hotkey + paste smoke** — ⌃⌥Space → overlay → release → paste in
   TextEdit. First run needs Accessibility grant (System Settings → Privacy
   & Security → Accessibility → voix). Pre-explanation banner ships in the
   M22 fix-pass.
4. **iOS onboarding + tone + intent + settings + PTT** — wipe AsyncStorage,
   walk the 3-screen onboarding, tone-snippet visual on every card, intent
   dial switching with active voice, PTT on both Realtime and Dictation,
   Settings smoke (daemon URL edit + recovery), macOS regression.
5. **iOS background-audio survival** — hold PTT, background, speak 30s,
   return. Either session alive or cleanly captured. If neither: M23.5
   follow-up sets `AVAudioSession.setCategory(.playAndRecord, .voiceChat,
   [.allowBluetooth, .duckOthers])` at PTT start.
6. **iOS keyboard bounce loop on physical iPhone** — requires Apple
   Developer Program enrolment (Architect Decision 7 + Coordinator Delta B).
   The sim covers compile + URL handler + keyboard UI; only a physical
   device verifies the App Group entitlement and real
   Notes/Mail/Messages/Reminders/Safari insertion. Three sub-items:
   - Enable voix keyboard in Settings → Keyboards → voix → Allow Full Access.
   - End-to-end bounce (tap pill → record → return → text inserts) in ≥4
     host apps.
   - Memory profile: keyboard RSS < 30 MB during idle.

---

## See also

- **`CLAUDE.md`** — operational guide for AI agents (hosts/paths, log
  streams, deployment patterns, HA gotchas, common failure modes).
- **`docs/session-handoff/2026-06-01-overnight.md`** — archived prior
  STATE.md: full per-milestone narrative, pre-M01 snapshot, lessons-learned,
  old test plan. Read for *why*, not *what's current*.
- **`docs/build-workflow.md`** — milestone roadmap + operating rules (Phase
  6 marked closed).
- **`docs/agent-team-workflow.md`** — the team-of-agents workflow voix runs
  under.
- **`docs/audits/niggly-bits.md`** + **`docs/audits/goal-vs-reality.md`** —
  what's broken / milestone-by-milestone scorecard.
- **`voix-brand-guide.html`** (marketing) / **`voix-desktop-guide.html`**
  (sober desktop app) — the visual system.
