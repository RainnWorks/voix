# Inventory vs. target architecture (2026-05-29)

What we have today, mapped to the five-port architecture in
`voix-architecture.md` and the staged plan in `voix-build-plan.md`,
including the **React Native everywhere + TypeScript core** direction
Tom raised in this session.

The aim: make the BIG changes legible. Each existing piece is tagged
**keep**, **trim**, **rewrite**, or **delete**, with a one-line reason.

---

## 1. What we have, line-counted

| Area | Path | LOC | What it is today |
|---|---|---|---|
| Firmware | `esphome/components/voix_realtime_client/` | ~600 (C++ + py) | Custom ESPHome component that streams puck mic/speaker direct to the daemon WS |
| Firmware config | `esphome/voix-package.yaml` + `…095e4e.yaml` | ~300 | Reusable voix bits + per-device YAML |
| Daemon (core + UI server) | `voix-backend/src/` | 3,964 TS | Bun/Elysia process running the realtime brain |
| Daemon UI | `voix-backend/ui/src/` | ~1,500 TSX | React + react-native-web, just-shipped brand redesign |
| HA integration | `ha-integration/custom_components/voix/` | 5,250 Python | Mix of useful connector + dead bridge code from the pre-daemon era |
| Tauri "companion app" | `app/` | 1,425 Rust + minimal JS | **Pre-pivot artefact.** Talks to HA, not the daemon. Clipboard + paste only. |
| Total in repo (excl. tests / vendored) | | **~12,200** | |

---

## 2. Map to the five ports

A port-by-port read of what exists, what needs to change, and what
is just missing.

### Port 1 — Audio I/O  (puck is impl #1)

**What we have**: the Voice PE puck firmware + a single WS protocol
the daemon speaks (`voix-backend/src/puck/protocol.ts`, 52 lines).

| File | Status | Note |
|---|---|---|
| `esphome/components/voix_realtime_client/voix_realtime_client.{cpp,h}` | **keep** | Working, proven. Half-duplex gate via `speaker_->is_running()` + `ready_for_input` ping are non-obvious wins. |
| `esphome/components/voix_realtime_client/__init__.py` | **keep** | ESPHome glue. Fine as-is. |
| `esphome/voix-package.yaml` + device YAML | **keep** | Reusable. |
| `voix-backend/src/puck/protocol.ts` | **rewrite** | Today: puck-specific. Needs: generic Audio I/O port protocol with capability handshake. See §3.1. |
| `voix-backend/src/puck/route.ts` (151 LOC) | **rewrite** | Currently `WS /api/voix/realtime`. Rename to "/api/audio-io" and accept any conforming endpoint, not just pucks. |
| `voix-backend/src/puck/session.ts` (628 LOC — the **biggest single file in the daemon**) | **trim + rewrite** | Mixes audio-IO concerns with pipeline orchestration. Pipeline pieces (realtime OpenAI handoff, watchdog, idle timer, ready_for_input handling) move out to a `pipeline/` module. Pure audio-IO behaviour (recv frames, send frames, hello, decline, error) stays in an `audio-io/` module. |
| `voix-backend/src/audio/resample.ts` | **keep** | 16→24 kHz resample state-threaded for waveform continuity. Move to `pipeline/`. |
| `voix-backend/src/audio/echo_gate.ts` | **delete** | Vestigial. The puck does half-duplex on chip now. Daemon-side energy gating never worked cross-volume. |

**What is missing**: the spec for the generic Audio I/O port (framing,
capability handshake, reconnection, wake-word slot semantics) — the
first follow-on doc the architecture calls for.

### Port 2 — Pipeline / model

**What we have**: a single OpenAI Realtime client.

| File | Status | Note |
|---|---|---|
| `voix-backend/src/realtime/openai.ts` (227 LOC) | **keep, generalise** | This is the realtime provider impl for the **discuss** path. Stays; gets re-shaped behind the provider interface. |
| `voix-backend/src/post_process/index.ts` (129 LOC) | **trim + relabel** | This is *almost* the "done phase" of a voice (per design brief §3): OpenAI/OpenRouter chat completions over a raw transcript. Rename + clean for use as the **done-phase LLM call** that both dictate (always) and discuss (when premium=off uses the traditional pipeline) lean on. |
| **STT provider** | **MISSING** | No streaming STT today; OpenAI Realtime owns audio end-to-end. Build plan item 2: Deepgram or Whisper streaming for the **dictate** path and the cheap discuss path. |
| **TTS provider** | **MISSING** | Same reason. Build plan item 2: Deepgram Aura / ElevenLabs / Piper as swappable providers. |
| **Provider abstraction (3 stages)** | **MISSING** | A `Provider<STT>`, `Provider<LLM>`, `Provider<TTS>` interface so the BYO-model promise is real. |
| **Pipeline orchestrator** | **MISSING in shape, partially present in `puck/session.ts`** | Today the session.ts file does this implicitly for the realtime path only. Needs to become a real orchestrator with two intents (dictate, discuss) and a quality dial (traditional vs realtime). |
| **VAD / auto-stop tuning** | **MISSING — build-plan item 1** | The single biggest feel risk. Per the build plan this comes *first*, alone, before any UI work. We have not started this. |

### Port 3 — Context / connector

**What we have**: the MCP-based context registry + HA source + a
builtin source.

| File | Status | Note |
|---|---|---|
| `voix-backend/src/context/registry.ts` (128 LOC) | **keep** | Clean. The registry pattern is exactly right for connectors. |
| `voix-backend/src/context/types.ts` (95 LOC) | **keep** | Shape is fine. |
| `voix-backend/src/context/sources/ha.ts` (220 LOC) | **keep** | The HA *MCP client*. Daemon-side connector implementation. |
| `voix-backend/src/context/sources/voix.ts` (110 LOC) | **keep** | Builtin source for session-control tools (`voix.end_session`). |
| `voix-backend/src/api/ha_sync.ts` (77 LOC) | **keep** | The "daemon mirrors mutations into HA" rule. |
| **Confidence layer** | **MISSING** | Today every registered source is consulted equally. Build plan item 8 is "context layer and confidence routing." Defer. |
| **Codebase / repo index source** | **MISSING — build-plan item 7** | Walk-and-talk plan calls for an on-box index + retrieval tool. Not started. Defer. |
| **Host-app reader sources (Mac, iOS, Android)** | **MISSING** | Per-platform, build-plan item 8. Defer. |
| **HA integration as Python connector** | **trim heavily — see §2.5** | The current 5,250 LOC integration is the thing in the worst shape relative to the target. |

### Port 4 — Client

**What we have**: one client and a half.

| Surface | Status | Note |
|---|---|---|
| HA web client (the daemon's UI served via ingress) | **keep, reshape** | Just-shipped brand-correct UI. Components and theme are right. Information architecture has to change per design brief: modes→voices, dictate/discuss intents, two-phase voice editor, surfaces screen, conversations screen. |
| `voix-backend/ui/src/App.tsx` + `AppShell.tsx` + `Puck.tsx` + `Wordmark.tsx` + `theme.ts` | **keep** | Brand-correct, working, reusable in RN proper (RN-Web aliasing already in vite config). |
| `voix-backend/ui/src/modes/ModeList.tsx` + `ModeEditor.tsx` | **rewrite** | Need voice-shaped editor (talking + done panels), not mode-shaped. Activate button is the broken symptom of the single-surface assumption. |
| `voix-backend/ui/src/lib/api.ts` | **rewrite** | Today: `modesApi`, `devicesApi`. After: `voicesApi`, `surfacesApi`, `entriesApi`. |
| **Desktop app (Mac native)** | **MAJOR REWORK — see §2.4** | Today `app/` is a Tauri/Rust companion that talks to HA, clipboards transcripts. Pre-pivot artefact. Architectural shape is wrong. |
| **iOS app** | **MISSING** | Not started. |
| **Android app** | **MISSING** | Not started. |
| **iOS keyboard** | **MISSING** | Per build plan: dictate-only launcher (Apple constraint), not in-keyboard capture. |
| **Android IME** | **MISSING** | Per build plan: real capture surface, richer than iOS. |

### Port 5 — Shell  (where the core runs)

**What we have**: HA Add-on shell (working) + a runnable standalone
(implicit; the daemon runs fine outside the add-on, just no installer).

| File | Status | Note |
|---|---|---|
| `voix-backend/config.yaml` + `Dockerfile` + `run.sh` | **keep** | HA Add-on shell. Working. Has `dev_mode` auto-pull on push. |
| `voix-backend/src/index.ts` (86 LOC) | **keep, factor** | Today: boots everything. Will need a shell-aware split (the core boot is the same; what differs is how the embed-shell wires the in-process client). |
| **Standalone shell installer** | **MISSING (low priority)** | The daemon already runs standalone — `bun src/index.ts`. What's missing is a one-shot install script + systemd unit + docker-compose. Easy when needed. |
| **Embedded-in-Mac-app shell** | **MISSING — see §2.4** | The shell architecture says the core compiles to an embeddable library. Under the TS-core direction (§3), this becomes: bundle the Bun runtime + core into the Mac app and child-process it. Different work shape from the Rust/Go suggestion. |

---

## 2.4 The Tauri Mac app — bigger problem than it looks

`app/` exists, is 1,425 LOC of Rust + a tiny `package.json` (no JS
frontend has been added yet). The description in `app/package.json`
reads:

> "voix companion app — receives transcripts from HA, puts them on the
> clipboard, optionally pastes."

This is **pre-pivot**. It was built when voix lived inside HA and the
Mac side was a thin paste-helper. It does not:

- Talk to the daemon (it has `ha_client.rs` — 597 LOC of HA WS/REST)
- Embed the core
- Capture audio
- Show a notebook
- Have any UI to speak of (no React/RN scaffold in `app/`)

What it does have that's reusable:
- Menu bar / tray UI scaffolding (`tray.rs`, `menu.rs`)
- Paste integration (`paste.rs` — 34 LOC, uses macOS APIs)
- Settings persistence (`settings.rs`)
- A working Tauri shell

What it should become depends on the **§3 RN-everywhere decision**.
Two paths:

**Path A — keep Tauri as the desktop shell.** The Tauri app becomes
the desktop *client* (port 4) AND the embedded *shell* (port 5):
spawn the Bun core as a child process, expose paste/tray APIs to a
React-native-web UI loaded into a Tauri WebView. Rust stays for the
native bits. UI is RN-Web (same code as HA ingress). The downside:
RN-proper (for iOS/Android) cannot share runtime with Tauri; the
mobile client is a *separate* RN codebase that imports the same
components via a shared package.

**Path B — drop Tauri, go React Native everywhere.** Replace
`app/` with a React Native macOS app (RN-macOS is real, shipped by
Microsoft/Meta). The same RN tree powers iOS and Android. Native
modules in Swift do the Mac paste/tray; bundled Bun core is
child-processed from Swift. Desktop, iOS, Android all share one
client codebase. Web client stays separate (RN-Web in vite, as
today). The downside: RN-macOS is a smaller ecosystem with rougher
edges than Tauri for menu-bar apps, and the build chain is heavier.

Recommendation: **Path A is the lower-risk default**, Path B is the
better long-term outcome but a bigger rewrite. Path A keeps every
Mac-specific Rust bit we already wrote and only adds "bundle Bun
+ load RN-Web UI." Path B is a full client rewrite for one platform
we already half-have.

A hybrid worth considering: **Path A for desktop, RN for mobile**.
Components live in a shared package; the desktop renders them via
RN-Web (Tauri WebView), mobile renders them via RN proper. The
shared package is `clients/shared/` with the brand tokens, the
puck glyph, the voice editor primitives. This is the path the
current voix-backend/ui already sets up — RN-Web aliasing is in
vite.config.ts. Mobile becomes a parallel RN consumer of the same
components.

---

## 2.5 The HA integration — most overgrown thing in the repo

`ha-integration/custom_components/voix/` is **5,250 LOC of Python**
across 14 files. Most of it is pre-pivot.

| File | LOC | Verdict |
|---|---|---|
| `__init__.py` | 1,094 | **trim hard.** Today it does config-entry setup, mode catalog state, websocket bridge plumbing. Keep: discovery, service registration, listeners. Drop: anything audio-related, anything mode-catalog-related. |
| `ws_view.py` | 1,853 | **DELETE.** This is the old WS bridge from when HA hosted the realtime path. The daemon owns that now. Audio plane bypasses HA entirely. This file is the single biggest pre-pivot artefact in the repo. |
| `config_flow.py` | 334 | **trim.** Keep what configures URL + token; drop the catalog/mode-flow UI (the daemon owns that). |
| `const.py` | 431 | **trim.** Mostly mode-catalog defaults (now in `voix-backend/src/modes/builtins.ts`). Strip to just the discovery / service constants. |
| `select.py` | 446 | **rewrite.** The mode-select entity per device. After voices+intents, this becomes per-device-voice. |
| `stt/` (`__init__.py` + `openai_realtime.py`) | ~200 | **DELETE.** Pre-pivot STT entity wiring. Daemon owns STT now. |
| `post_process.py` | 151 | **DELETE.** Daemon owns post-processing. |
| `modes.py` | 145 | **DELETE.** Daemon owns the mode catalog. |
| `light.py` | 185 | **keep (the LED ring entity)** | Useful; the connector exposes the puck's LED as an HA light. |
| `binary_sensor.py` | 96 | **keep** | Active/idle status per device. Useful for automations. |
| `button.py` | 102 | **keep** | "End session" button + similar. |
| `sensor.py` | 190 | **keep** | Mode/voice + last-session metadata as sensor entities. |
| `number.py` | 72 | **keep** | LED brightness slider. |
| `text.py` | 114 | **trim** | Was the dictation field. Useful pattern for surfaces that want to push text via HA. |
| `util.py` | 37 | **keep** | Helpers. |
| `services.yaml` | — | **trim** | Drop service definitions that the daemon now owns; keep the HA-side ones (LED control, session push). |

**Estimated end state**: ~600-800 LOC, down from 5,250. Roughly the
"~300 LOC" the design brief estimated, plus a bit for the light/sensor
entities that genuinely add value.

The connector should be **a context source + a control surface for HA
automations**, nothing more. No audio. No model orchestration. No
mode catalog. The daemon is the brain; HA gets to participate.

---

## 3. The BIG changes

In rough order of how much they reshape the architecture.

### 3.1 Audio I/O port: generalise the protocol

Today's protocol is in `voix-backend/src/puck/protocol.ts`. It's
puck-specific:

```ts
export type PuckHello = {
  type: "hello";
  token: string;
  device_id: string;
  mode: "realtime" | "dictation";   // ← wrong axis (this is intent)
  mode_id?: string;                  // ← wrong noun (this is voice)
  fw_version?: string;
};
```

The target shape per the architecture doc:

```ts
type AudioIoHello = {
  type: "hello";
  protocol_version: 1;
  token: string;
  device_id: string;            // stable per-endpoint id
  intent: "dictate" | "discuss";
  voice_id?: string;            // optional voice override
  capabilities: {
    mic: { sample_rate_hz: number; channels: 1 | 2 };
    speaker?: { sample_rate_hz: number };
    screen?: boolean;
    wake_words?: string[];      // which slots claimed
    half_duplex_on_chip?: boolean;
  };
  client_info?: { kind: "puck" | "phone-sat" | "laptop-mic" | …; version: string };
};
```

This single change makes BYO-device fall out for free, and it makes
the puck's behaviour a special case (half-duplex on chip) the daemon
can detect rather than assume. The firmware change is small (extend
the hello JSON). The daemon side rewires `puck/session.ts` to drop
the "this is a puck" assumption.

### 3.2 Mode → voice + two-phase prompt + intent

Three coupled schema changes:

1. **Rename `Mode` → `Voice`** everywhere. The user-facing word in
   the brand guides + architecture is "voices."
2. **Replace `prompt` + `postProcessPrompt` with `talkingPrompt` +
   `donePrompt`** (both optional). Pure dictate = `{ donePrompt }`.
   Pure realtime/discuss = `{ talkingPrompt }`. Killer flow = both.
3. **Move `type: "realtime" | "dictation"` off the voice** and onto
   the *capture call* as an intent (dictate vs discuss). A voice is
   capable of either depending on which prompts it has filled in.

Affected files:

- `voix-backend/src/modes/types.ts` → `src/voices/types.ts`
- `voix-backend/src/modes/store.ts` → `src/voices/store.ts`
- `voix-backend/src/modes/builtins.ts` → `src/voices/builtins.ts`
  (the six built-in voices need new shape — the brand guides have
  the canonical six)
- `voix-backend/src/api/modes.ts` → `src/api/voices.ts`
- All UI: `ui/src/modes/*` → `ui/src/voices/*`, `ui/src/lib/api.ts`
- HA integration: the per-device `select` entity becomes "voice
  picker," the underlying ids change
- Persistence: `modes.json` → `voices.json` (one-shot migration
  on boot if old file present)

This is the most invasive single change — it touches storage, API,
UI, the protocol, and the connector simultaneously. It can be staged
behind a fold: add the new shape, write both, read both, then drop
the old shape after a session.

### 3.3 Pipeline orchestrator + provider abstractions

Today's `puck/session.ts` (628 LOC) hard-codes the OpenAI Realtime
realtime path. To support dictate-via-traditional and
discuss-via-traditional and discuss-via-realtime, we need:

- `pipeline/orchestrator.ts` — given (intent, voice, audio source,
  context bundle), drive the right shape of pipeline.
- `pipeline/providers/stt/*.ts` — Deepgram, OpenAI Whisper, local
  Whisper, behind a `STTProvider` interface.
- `pipeline/providers/llm/*.ts` — OpenAI chat, OpenRouter chat,
  Ollama, behind an `LLMProvider` interface (already half-present
  in `post_process/`).
- `pipeline/providers/tts/*.ts` — Aura, ElevenLabs, Piper, behind a
  `TTSProvider` interface.
- `pipeline/providers/realtime/openai.ts` — the existing realtime
  client, behind a `RealtimeProvider` interface.

The pipeline module owns auto-stop / VAD, the watchdog, the
ready_for_input handling, the "produce_output tool" pattern from
design-brief §3. The session.ts file becomes thin: receive audio,
fan to orchestrator, send back.

**This is build-plan item 1+2** and should be the first real code
change after the schema migration.

### 3.4 RN-everywhere client direction (Tom's session call)

If we commit to the React Native direction:

- **Shared UI package**: extract `voix-backend/ui/src/components/`
  + `lib/theme.ts` + the brand primitives (`Puck`, `Wordmark`,
  `AppShell`) into `clients/shared/` consumable by RN-Web (current
  HA-ingress build) and RN proper (mobile / RN-macOS).
- **Repo move**: `voix-backend/ui/` → `clients/web/` (RN-Web served
  via vite, no behavior change). `clients/desktop/` is new (Path A:
  Tauri shell wrapping the same RN-Web build + child-processed Bun
  core; Path B: RN-macOS).
- **Mobile clients**: `clients/mobile/` (single RN tree for iOS +
  Android), `clients/mobile-keyboard-ios/` (Swift launcher),
  `clients/mobile-keyboard-android/` (Java IME).
- **Embedded shell**: how the Bun core lives inside the Mac app.
  Easiest answer is "bundle the `bun` binary, spawn it as a child
  process at app start, talk to it on localhost." This means the
  core is always a process even in embedded mode, but the user sees
  one app. Hidden complexity; acceptable.

The fork that needs your call: **Path A vs Path B in §2.4 above**.
My read: Path A is right today (keep Tauri, share components via
RN-Web), Path B is right when mobile is real and we want one client
tree end to end. Don't force Path B until the mobile work is funded.

### 3.5 HA integration trim

Per §2.5. ~4,500 LOC of dead bridge code in `ha-integration/`
needs to go. This is mostly mechanical — the daemon already does
everything `ws_view.py`, `stt/`, `post_process.py`, `modes.py` do.

This is also the cleanest "low-risk PR you could ship today" — the
deleted code is provably unused by the daemon path, and it makes
the integration legible.

### 3.6 Repo restructure (small, but enabling)

Top-level layout proposal:

```
voix/
├── core/                      ← was voix-backend/src/
├── shells/
│   ├── ha-addon/              ← Dockerfile + run.sh + config.yaml
│   └── standalone/            ← installer + systemd unit (new, low-pri)
├── clients/
│   ├── shared/                ← brand primitives, theme, api shape
│   ├── web/                   ← was voix-backend/ui/
│   ├── desktop/               ← was app/ (Path A: Tauri shell)
│   ├── mobile/                ← new (RN iOS + Android)
│   ├── mobile-keyboard-ios/   ← new (Swift launcher)
│   └── mobile-keyboard-android/ ← new (Java IME)
├── firmware/
│   └── voice-pe/              ← was esphome/
├── connectors/
│   └── ha/                    ← was ha-integration/, trimmed
├── protocol/
│   └── audio-io/              ← new: shared protocol type + spec
└── docs/
```

Defer until after the schema/pipeline changes — restructuring an
in-flight architecture refactor is asking for pain.

---

## 4. What survives intact

The brand work + the core daemon scaffold + the firmware are in
good shape. Specifically:

- The whole firmware tree (`esphome/`). Half-duplex gate +
  ready_for_input ping are not obvious but they're right.
- `voix-backend/src/context/` (registry + sources). Already the
  shape the architecture calls for.
- `voix-backend/src/storage/atomic.ts` (the crypto-suffix fix is
  load-bearing).
- `voix-backend/src/recordings/` (per-session WAVs + browser).
- `voix-backend/src/history/` (entry storage in JSONL).
- `voix-backend/src/transcripts/` (file-backed transcripts).
- The HA Add-on shell (`config.yaml`, `Dockerfile`, `run.sh`).
- The brand: `Puck.tsx`, `Wordmark.tsx`, `AppShell.tsx`, `theme.ts`,
  the 12-colour palette, the system-fonts rule. Per the design
  brief, **the look is right; the IA is wrong.** None of it gets
  thrown away in the IA redesign.

---

## 5. What dies outright

Hard deletes that have no analogue in the target:

- `voix-backend/src/audio/echo_gate.ts` — vestigial, the puck does
  half-duplex on chip.
- `ha-integration/custom_components/voix/ws_view.py` — the old WS
  bridge. ~1,853 LOC.
- `ha-integration/custom_components/voix/stt/` — pre-pivot STT.
- `ha-integration/custom_components/voix/post_process.py` — daemon
  owns it.
- `ha-integration/custom_components/voix/modes.py` — daemon owns it.
- Parts of `__init__.py`, `const.py`, `config_flow.py` per §2.5.

Estimated **~4,500 LOC of Python and ~120 LOC of TS gone**.

---

## 6. What's flat-out missing

Per the build plan, in order of priority:

1. **VAD / auto-stop tuning** — build-plan item 1, hasn't started.
2. **Streaming STT provider + TTS provider + LLM provider abstractions** — build-plan item 2.
3. **Pipeline orchestrator** (dictate path, then discuss path,
   then realtime as the upgrade) — build-plan item 2.
4. **Voice schema migration + two-phase editor UI + intent on the
   capture call** — design-brief §3.
5. **Surfaces screen** in the web client.
6. **Conversations screen** + entry detail with context receipt.
7. **Press-to-talk in the web client itself** (browser as a Audio I/O
   impl).
8. **Embedded Mac shell** (bundled Bun + RN-Web in Tauri WebView,
   Path A from §2.4).
9. **iOS app + iOS keyboard launcher** — build plan item 11.
10. **Android app + IME** — build plan item 11.
11. **Codebase index + retrieval tool** — build plan item 7.
12. **Confidence layer for context routing** — build plan item 8.

---

## 7. Sequencing — what to do this week vs. this quarter

The build plan's ordering applies; what changes is that some of
the schema work is cheap-and-now even if the corresponding pipeline
work is later.

**This week, no risk:**

- Delete the dead Python in `ha-integration/` per §2.5. Provably
  unused. Frees ~4,500 LOC of mental tax. Ship-able as a single PR.
- Rename `Mode` → `Voice` in the daemon + UI, even before changing
  the shape. Pure refactor. Keeps the catalog working but matches
  the brand vocabulary.

**This week, real:**

- Voice schema migration: add `talkingPrompt` + `donePrompt`, keep
  old `prompt`/`postProcessPrompt` as legacy read-only fallbacks
  populated on migration. Update built-ins to the new shape using
  the brand guides' canonical six. Update the voice editor to show
  both panels.

**Next two weeks:**

- Generalise the puck protocol to the Audio I/O port protocol
  (§3.1). Land the capability handshake. Firmware change is
  small; daemon side is the bulk.
- VAD / auto-stop tuning on the traditional dictate pipeline. This
  is the build plan's day-zero risk and it has to be retired before
  more UI work compounds on it.

**This month:**

- Build the STT/LLM/TTS provider abstractions and the pipeline
  orchestrator. Wire dictate-via-traditional end-to-end. Then
  discuss-via-traditional. Realtime stays as an upgrade behind the
  same orchestrator.
- Surfaces screen + Conversations screen in the web client. These
  are mostly UI work over existing daemon state.

**This quarter:**

- The desktop client: Path A (Tauri shell + bundled Bun + RN-Web
  UI). Validates the embedded shell with the least surface area.
- The repo restructure (§3.6). Defer until in-flight refactors
  settle.
- First mobile client (probably iOS, including the keyboard
  launcher), then Android.

---

## 8. The RN-everywhere question, summarised

Tom's call: if the core stays TypeScript (Bun), going React Native
across desktop + mobile means **one runtime family for everything**.
The Rust/Go-core option from `voix-build-plan.md` falls away; the
"embed the core in the Mac app" case becomes "bundle Bun + spawn it"
instead of "link a Rust/Go library."

The win: one language, one component library, smaller team surface.

The cost: bundling Bun adds ~50 MB to the Mac app; spawning a child
process is less elegant than linking; RN-macOS is rougher than
Tauri for menu-bar apps. None of these are blockers; they're
trade-offs Tom should choose with eyes open.

My take: **stay TS-everywhere**, do Path A first (Tauri shell + Bun
child + RN-Web UI), let Path B (RN-macOS proper) be a possible
later refactor if Tauri starts limiting us. The components are
RN-shaped already; the rewriting cost between Path A and Path B is
mostly the shell, not the app.
