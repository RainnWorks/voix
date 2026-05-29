# Voix Build Plan

**The planning document.** This is the map, not the territory. It lists every piece the product needs, proposes how we break the detail into follow-on documents, and takes a position on the three questions that are still genuinely open: the deployment topology (what the Voix core actually is and where it runs), the voice pipeline economics, and walk-and-talk with full codebase context.

This sits alongside the two brand guides, but it plays a different role. The guides describe the product we want. This describes the product we can build, what it costs, and in what order. Where the two disagree, that disagreement is noted here rather than hidden.

The structural companion to this doc is **voix-architecture.md**, the abstraction spine: the stable core and the five ports around it (audio I/O, pipeline/model, context/connector, client, shell). Read that first if you want the shape; this doc is the plan and the costed decisions. Where this doc talks about shells, connectors, and the puck, the architecture doc is the authority on why they sit where they do.

---

## How this breaks up

I propose six documents after this one. They are ordered by how much they de-risk, not by how the product is laid out.

1. **Deployment topology.** What the Voix core actually is, and the three host shells it runs in: HA add-on, standalone daemon, embedded-in-the-Mac-app. Plus the firmware-to-core audio path and why it bypasses HA. This goes first because it decides what every other piece builds against. This doc takes the position; a follow-on specs the core/shell boundary and the firmware-to-core protocol.
2. **The voice pipeline.** Realtime vs traditional STT-LLM-TTS, when each is used, the cost model, and the latency budget. This doc takes the position too.
3. **The context layer and its connectors.** How a surface knows what you are talking about: the HA integration connector (config, automation, HA tools to the realtime model), the host-app readers, the editor integrations (Claude Code, VS Code, others), the confidence layer that decides what is worth fetching, and the data contracts. This is where the walk-and-talk problem mostly lives.
4. **The clients, per platform.** Desktop, web, iOS app, Android app, the two keyboards, the puck. What each one actually builds, including the iOS keyboard reality (handoff, not in-keyboard capture). This is the build-truth companion to Book 02.
5. **The configuration interfaces.** How users set up voices, surfaces, plugins, providers, and keys. The brand guide shows the voice editor; it does not show onboarding, provider setup, plugin install, or the admin surface as a whole. This is a real gap.
6. **The core and sync.** The portable runtime that owns voices, entries, history, and context routing, plus how clients stay in sync. The most boring and most load-bearing piece.

This document covers enough of 1, 2, and 3 to make the decisions; the rest are stubs here and full docs later.

---

## The component map

Everything the product needs, grouped. Items are tagged **[solid]** (well-understood, low risk), **[hard]** (doable but with real engineering or platform risk), or **[open]** (needs a decision before it can be specced).

### Clients

| Piece | State | Note |
|---|---|---|
| Desktop app (admin + notebook + capture) | [solid] | Widest canvas, reference layout. Tauri or Electron over the daemon's local API. |
| Web client (admin + notebook + press-to-talk) | [solid] | Served through Home Assistant ingress. Same views as desktop, browser chrome. |
| iOS app (notebook + capture + admin) | [solid] | Standard app; the capture pipeline is the only nuance. |
| Android app (notebook + capture + admin) | [solid] | As iOS. |
| iOS keyboard extension | [hard] | Cannot record audio. Must hand off to the app. See "iOS keyboard reality" below. |
| Android IME (keyboard) | [hard] | Can record in-IME, floating panel, live transcript. Genuinely richer than iOS. |
| Puck / Voice PE | [open] | Its own interaction class, not a thin client. No screen, one button, one wake word. |

### Capture and voice pipeline

| Piece | State | Note |
|---|---|---|
| Dictate pipeline (STT then text model) | [solid] | Cheap path. Whisper/Deepgram stream then a text model applies the voice. |
| Discuss pipeline (full realtime agent) | [solid] | Expensive path. GPT-Realtime-2, model talks back, reasoning, tools. |
| Auto-stop on silence (VAD) | [hard] | The single biggest risk to the "feel present" goal. Tuning, not capability. |
| Voice application (the "voice" prompt) | [solid] | A text transform at produce time. The output step, where the persona lives. |
| Reasoning surfacing | [solid for discuss] | Realtime-2 exposes reasoning. For dictate it costs extra; likely off by default. |
| Refine (re-run a produced entry by voice or chip) | [solid] | A text round-trip over the existing entry. |

### Context gathering and connectors

Connectors bridge the core to an external system to gather context or expose control. The HA integration is one of these, not a shell.

| Piece | State | Note |
|---|---|---|
| HA integration connector (Python) | [hard] | Config devices, automation, HA state/areas, and exposing HA's MCP tools to the realtime model. Runs in HA, talks to the core. Not a shell, not in the audio path. |
| Host-app reader (which app, which thread) | [hard] | Strong on Android/desktop, weak and limited on iOS keyboard. Platform-divergent. |
| Location/room signal (puck) | [solid] | Comes via the HA connector (HA knows device area). |
| Time/calendar signal | [solid] | Cheap, always available. |
| Recent-entries signal | [solid] | The core has the history. |
| Codebase context (repo index, git MCP, editor plugins) | [open] | The walk-and-talk problem. See below. |
| Confidence layer (decide what to fetch) | [hard] | Real system. Cheap signals always on; expensive sources fetched only when worth it. |
| Context receipt (show what was known) | [solid] | A view over whatever the layer gathered. |

### Configuration interfaces

| Piece | State | Note |
|---|---|---|
| Voice editor (two-phase prompts, colour) | [solid] | Shown in Book 02. The only config surface the guide covers. |
| Onboarding / first run | [open] | Not designed anywhere yet. |
| Provider + key setup (BYO model) | [open] | Which STT, which LLM, which TTS, which keys. Central to the self-hosted story. |
| Plugin install + per-plugin config | [open] | How a user connects Claude Code, a git repo, an editor. |
| Surface management (assign voice, defaults) | [partial] | Surfaces view exists in Book 02; the puck assignment flow does not. |
| Privacy controls (what context may be gathered) | [open] | Implied by the receipt; never designed. |

### Core and infrastructure

The core is the portable runtime; see the topology decision for how it is shelled (add-on, integration, standalone, embedded-in-app).

| Piece | State | Note |
|---|---|---|
| Entry store + sync | [solid] | Standard. Websocket subscription, last-write-wins or CRDT for offline. |
| Voice store | [solid] | Small config objects. |
| Context router | [hard] | Routes a capture to the right context sources based on surface + confidence. |
| Provider abstraction (swap STT/LLM/TTS) | [hard] | The BYO-model promise needs a clean internal interface per stage. |
| Embeddable core build | [open] | Core must compile to both standalone binary and in-app library. Drives language choice. |
| Auth between clients and core | [solid] | HA provides an auth model to lean on when present; standalone needs its own. |

---

## Decision: deployment topology (what the core is, and where it runs)

This is the most structural decision in the whole build, and the earlier drafts hand-waved it by saying "the daemon on your host." There is no single "the daemon." There is a **Voix core**, and several **host shells** it can run inside. Getting this right is what lets one product serve a homelab-with-pucks user and a just-give-me-a-Mac-app user from the same codebase.

### The core is portable; the shell varies

The **Voix core** is the runtime that owns: the voice store, the entry store, the context router, the pipeline orchestration (dictate/discuss, STT/LLM/TTS or realtime), and the local API that clients talk to. It is deliberately host-agnostic. It does not assume Home Assistant, does not assume a particular OS, does not assume a daemon process even exists as a separate thing.

The **host shell** is what wraps the core and decides how it is deployed: where it executes and how it is updated. There are **three** shells, and the product should support more than one. (The HA integration is *not* a shell, it never runs the core; it is a connector, covered separately below. Conflating the two was an earlier mistake.)

### The three shells (where the core runs)

**1. Home Assistant Add-on (now officially called an "App" as of HA 2026.2).**
The core runs as a Docker container managed by the HA Supervisor. This is the natural home for a Home Assistant OS user: install from a repository, it runs alongside HA, the Supervisor keeps it updated.
The hard constraint: **add-ons only run on Home Assistant OS or Supervised installs.** A user on HA Container or HA Core (bare Docker, or pip) cannot run add-ons at all. So this is the best experience for HAOS users but cannot be the only option, or a large slice of the HA community is excluded.

**2. Standalone daemon.**
The core as its own process or container on any box (the homelab, a NAS, a VPS), with no dependency on Home Assistant. It talks to HA over the HA connector *when HA is present*, and works perfectly well when it is not. This is the most portable shell and the right answer for someone who has a homelab but does not run HAOS, or who wants Voix independent of their home automation entirely.

**3. Embedded in the Mac app (no daemon at all).**
The case the earlier drafts missed, and it matters. A user who just wants voice-to-polished-text on their Mac, with no homelab, no Home Assistant, no puck, should be able to download **one app** and have the whole product. In this shell the core is **compiled into the Mac app and runs in-process.** There is no separate daemon to install, no container, no HA. The app is the core plus the UI.
The same is true in principle for a Windows app or a fully standalone mobile app, but the Mac app is the obvious first target given the audience.

### The HA integration is a connector, not a shell

The Home Assistant integration is a custom component (Python, in `custom_components`) that runs inside the HA process. It does **not** run the Voix core, and it is **not in the audio path.** It is a bridge between a core running *elsewhere* (in any of the three shells) and Home Assistant. That makes it the same category of thing as the host-app readers, the editor plugins, and the git MCP: a context-and-control connector, not a runtime. It belongs in the context layer, not the shell list.

A standalone-daemon user who also runs HA uses this connector. A Mac-app-only user uses no integration at all and the core runs perfectly. That orthogonality is the proof it is not a shell.

What the connector does:
- **Configuration.** Registers Voix config devices and entities so voices, surfaces, and settings appear in the HA UI, fully synced with the core.
- **Automation.** Voix events (an entry produced, a discuss session started) are available to HA automations, and HA can drive Voix in turn. Two-way.
- **MCP tools for the realtime model.** The important one. It exposes Home Assistant's tools (device control, state reads, automations) to the Voix core, so the **realtime model can call them mid-conversation**: turn off the lights, check a sensor, fire a scene, while you are still talking. The "wired into everything you already run" story from Book 01 made concrete.
- **Context.** Bridges HA state, areas, and entities to the core so a capture knows the room and the home's state.

What it explicitly does **not** do: register Voix as an HA assist pipeline, or carry audio. The next section is why that separation is the whole point.

### Why Voix bypasses the HA assist pipeline (the firmware story)

Home Assistant's assist pipeline is fundamentally **turn-based**: wake word, then STT, then intent or LLM, then TTS, then done. It is a request-response loop with discrete stages. **Realtime speech-to-speech does not fit that shape.** There is no stage in a turn-based pipeline for a bidirectional streaming audio session where the model listens while it talks, handles interruptions, and reasons mid-stream. If Voix registered as a conversation agent inside HA's pipeline, it would be locked into turn-based interaction forever and could never deliver the fluid realtime discuss experience. That is the entire reason for the firmware rewrite.

So the custom Voice PE firmware (already built) works like this:

- The firmware **claims the second wake word slot at the firmware level.** Wake word one stays the stock HA assistant (Okay Nabu, local control, lights and timers) and flows through HA's normal pipeline, untouched.
- On the **second wake word**, the firmware does **not** hand the audio to HA's assist pipeline. It opens its **own WebSocket/WebRTC stream directly to the Voix core endpoint**, wherever the core is running. Bidirectional audio, so realtime speech-to-speech works fully.
- HA never sees the Voix audio. Two planes, cleanly separated:
  - **Audio plane:** firmware to core, direct, bidirectional, realtime-capable. No HA, no integration.
  - **Context and control plane:** core to HA, via the integration connector, for tools, state, config, and automation.

These planes never cross, and that is what makes the architecture work. Realtime gets a clean low-latency audio path it controls end to end; HA still provides all the context and all the tools, through a separate connector that does not constrain the audio. The puck loses nothing (wake word one is exactly as before) and gains a completely separate, realtime-capable Voix channel on wake word two.

### The position

**Ship the core as a portable library with multiple shells, and treat "embedded in the app" and "standalone/add-on" as first-class peers, not one as a degraded version of the other.**

- **Build the core as a standalone process first** (shell 2). It is the cleanest to develop and test, and it is the substrate the add-on shell wraps with almost no change (an add-on is essentially the standalone core in a Supervisor-managed container).
- **The HA integration is a separate connector,** not a shell, that any server shell pairs with when HA is present. It bridges config, automation, and HA's MCP tools to the core. It is small and HA-specific and contains no core logic. Covered in the context layer, not here.
- **The embedded-in-Mac-app shell links the same core as a library.** This is the strongest argument for writing the core in a language that compiles to both a standalone binary and an embeddable library (Rust and Go both qualify; a Python core makes the embedded case much harder, which is a real consideration given HA integrations are Python).

### The tension this surfaces: core language

There is a genuine fork here worth naming now rather than discovering later. The HA **integration** must be Python (that is what HA components are). But the **core**, if it is to embed cleanly in a Mac app and run as a tight standalone daemon, is much happier in Rust or Go. These can coexist: a Rust/Go core with a thin Python integration that talks to it over a local socket. But it means the core and the integration are different languages, and that boundary needs to be clean. The alternative (a Python core) makes the add-on and integration trivial but the embedded-Mac-app and the "tight single binary" stories painful. This is a real decision for the topology follow-on doc; my lean is **Rust/Go core + Python integration shim**, because the embedded-app case is too valuable to sacrifice and the integration shim is small.

### What this means for the puck firmware

The custom Voice PE firmware is already built and works as described above: it does **not** rip out the Home Assistant voice stack, and it does **not** route Voix through HA's assist pipeline. The first wake word stays the stock HA assistant. The second wake word is claimed at the firmware level and streams audio **directly to the Voix core**, bypassing HA entirely on the audio plane so realtime speech-to-speech is possible. The HA integration runs in parallel on the context/control plane, giving the realtime model HA's tools and state and surfacing Voix config in the HA UI. The puck is purely additive: it keeps everything it did and gains a separate realtime Voix channel.

### Shell summary

| Shell | Core runs as | Needs HA? | Best for | Constraint |
|---|---|---|---|---|
| HA Add-on / App | Supervisor-managed container | Yes (HAOS/Supervised) | HAOS users with pucks | Only on HAOS or Supervised |
| Standalone daemon | Own process/container | No (uses HA connector if present) | Homelab without HAOS, or HA-independent use | You manage updates |
| Embedded in Mac app | In-process library | No | Just-want-the-app users, no homelab | Core must be embeddable (language choice) |

The HA integration is not in this table; it is a connector (see the context layer) that any of these shells uses when HA is present.

The through-line: **one core, three shells, plus connectors.** The audio plane is firmware-to-core direct (so realtime works), and the HA integration sits on a separate context/control plane as a connector, bridging tools, state, config, and automation without ever touching the audio. The Mac-app-only user gets the entire product with none of the HA machinery, and that is a supported first-class shape, not a fallback.

---

## Decision: the voice pipeline (realtime vs traditional)

This is the most important call in the build, because it sets the cost ceiling and decides whether walk-and-talk is even affordable.

### The two pipelines

**Traditional STT then LLM then TTS.** Stream the user's speech to a transcription model, send the text to a language model, stream the reply text to a speech model. Three stages, three bills, but each is cheap and you control every piece.

**Realtime speech-to-speech.** One model (GPT-Realtime-2) takes audio in and gives audio out, reasoning and calling tools along the way. Fewer moving parts, lower latency, far more natural turn-taking and interruption handling, but materially more expensive.

### What each actually costs (current, mid-2026)

Rough per-minute of conversation, from current provider pricing:

| Stage | Traditional | Realtime (GPT-Realtime-2) |
|---|---|---|
| STT | approx $0.01 to $0.02 / min (Deepgram Nova-3 ~$0.0077/min, streaming sub-300ms) | included |
| LLM | approx $0.01 to $0.04 / min | included |
| TTS | approx $0.03 to $0.10 / min (Deepgram Aura cheap, ElevenLabs premium) | included |
| **Total** | **approx $0.05 to $0.15 / min** | **several times higher; audio tokens at $32 in / $64 out per 1M** |

The realtime number is harder to pin to a clean per-minute figure because it bills on audio tokens, but every comparison puts a full speech-to-speech agent well above a tuned traditional pipeline, often 3 to 6 times the cost for sustained conversation. The gap widens the longer the session.

### The position

**Use both, mapped to intent. This is not a compromise; the two intents genuinely want different pipelines.**

- **Dictate does not need realtime at all.** Dictate is: capture speech, turn it into text, apply the voice at produce time. That is STT (streaming, cheap) plus one text-model call. Running a full speech-to-speech agent to transcribe a shopping list is burning money for nothing. So **dictate = traditional, always.**
- **Discuss is where realtime earns its price,** because the value is the back-and-forth: the model interjecting, asking a clarifying question, handling you talking over it. That natural turn-taking is exactly what realtime is built for and what a traditional pipeline does badly (every turn is a full STT-LLM-TTS round trip with audible seams). So **discuss = realtime, when the user wants the richest experience.**
- **But discuss should also have a cheap mode.** A discuss conversation can run on the traditional pipeline too: STT your turn, LLM replies as text, TTS speaks it. It feels more turn-based and less fluid, but it costs a fifth as much. This is the **"great enabler for our customer"** path you flagged. For most users, on most conversations, a tuned traditional discuss is more than good enough, and it keeps the self-hosted, bring-your-own-model promise honest because every stage is swappable.

So the real model is two pipelines and a quality dial:

```
DICTATE  ->  always traditional (STT + text transform)        cheap
DISCUSS  ->  traditional pipeline (STT/LLM/TTS) by default     cheap, slightly seam-y
         ->  realtime speech-to-speech when premium is on      pricey, fluid
```

The daemon's provider abstraction has to support both wirings cleanly, which is why "provider abstraction" is tagged [hard] above. But this is the design that keeps costs sane and the self-hosted promise real, while still letting someone who wants the magical fluid version pay for it.

### Why this matters beyond cost

The traditional pipeline is the one that lets a user bring their own everything: their own local Whisper, their own Ollama model, their own Piper TTS, entirely on their box, zero cloud, zero per-minute cost. That is the purest expression of the privacy story from Book 01. Realtime is a cloud-only luxury layer on top. Framing it this way means the cheap path is also the most private path, which is a happy alignment, not a tension.

---

## Decision: walk-and-talk with full codebase context

This is the most interesting unsolved problem you raised, and it is worth doing properly because it is a real unmet need: you are on a walk, you want to talk through your codebase with something that actually knows the code, and you do not want it to cost a fortune.

### Why the naive version breaks the bank

The naive approach is: stuff the whole codebase into the context window and run a realtime voice session over it. This fails on two axes at once.

1. **Realtime audio is expensive per minute** (above), and a walk is long. Thirty minutes of fluid speech-to-speech is not a few cents.
2. **A whole codebase is a huge amount of input tokens,** and if you are re-sending it on every turn of a long conversation, the input-token bill dwarfs even the audio. This is the real killer. Codebases are big; conversations are many-turn; multiplying the two is ruinous.

So the problem is not really "voice is expensive." It is "voice plus large persistent context, re-paid every turn, is expensive." Solve the context cost and the voice cost becomes manageable on the cheap pipeline.

### The approach: retrieval, not stuffing, plus an indexed codebase

The codebase should not live in the context window. It should live in an **index the daemon builds once and updates on change**, and the conversation pulls only the relevant slices on demand. This is the same confidence-layer idea from Book 01 applied to code: cheap signals always available, expensive retrieval only when a turn actually needs it.

Concretely:

1. **Index the repo ahead of time.** A background job (running on the homelab box, where the code already is) chunks the codebase, embeds it, and stores vectors plus a symbol map (files, functions, call graph). This is a one-time cost per change, not per conversation turn. It runs on your hardware, so it is effectively free after compute.
2. **The voice session carries almost no code by default.** It carries a compact project summary (architecture, key modules, recent changes) that fits in a small, cacheable system prompt. Most conversational turns ("remind me how auth flows", "what did we change in the trip importer") are answered from this summary plus a couple of retrieved chunks, not the whole repo.
3. **Retrieve on demand, per turn.** When a turn needs specifics, the model calls a retrieval tool: semantic search over the index returns the three or four relevant chunks, those go into that turn only, and they are dropped after. You pay for a few hundred tokens of code per turn that needs it, not the whole repo every turn.
4. **Cache the stable part.** The project summary and any repeatedly-referenced chunks sit in prompt cache (cached input tokens are roughly an order of magnitude cheaper). A long conversation about the same module re-reads the cached summary for almost nothing.

This is retrieval-augmented voice. The codebase is a tool the conversation queries, not a payload it carries.

### The pipeline for walk-and-talk specifically

Walk-and-talk is a **discuss** interaction, but it is exactly the case where the **cheap traditional pipeline** shines, and where realtime is a tax you do not want on a long session:

```
your speech
  -> streaming STT (cheap, on-box or Deepgram)
  -> text turn
  -> LLM with: small cached project summary
              + retrieval tool over the codebase index
              + the conversation so far (also cacheable)
  -> reply text
  -> streaming TTS (cheap, on-box Piper or Deepgram Aura)
  -> spoken back to you
```

Every expensive thing is avoided: no realtime audio premium, no whole-codebase payload, no re-paying for context that did not change. A thirty-minute walk costs cents, not dollars, and because the index is on your box, the code never leaves your control, which keeps the privacy story intact even for the codebase case.

The one thing you trade is fluidity: this is turn-based, not interrupt-and-overlap fluid. On a walk, talking to your codebase, turn-based is completely fine. You are thinking, not sparring. Realtime fluidity is wasted here.

### Where the codebase index comes from (the plugin question)

This is where your Claude Code / VS Code / "all sorts" question lands. The codebase context can be sourced several ways, and they are not mutually exclusive:

- **Direct repo access on the box.** The daemon has filesystem access to the repo (it is your homelab). It indexes directly. Simplest, most private, no third-party plugin needed. This should be the default for self-hosters.
- **Git MCP server.** A git MCP server exposes the repo (history, diffs, blame) as tools the conversation can call. This is the cleanest way to answer "what changed", "who touched this", "what was the last commit on X". Worth adding regardless.
- **Editor integrations (Claude Code, VS Code, etc).** These matter less for walk-and-talk (you are not at the editor on a walk) and more for the **at-desk** case: when you are in the editor, the active file, cursor, and selection are the highest-value context signals, and an editor plugin is how you read them. So editor plugins feed the *desk* context, the repo index feeds the *walk* context. Different sources for different situations, both flowing into the same confidence layer.

So the plugin story splits cleanly:

| Context source | Best for | How |
|---|---|---|
| Repo index on box | Walk-and-talk, "knows the whole codebase" | Daemon indexes filesystem directly |
| Git MCP | History, diffs, "what changed" | MCP server, conversation calls it as a tool |
| Editor plugin (VS Code, Claude Code, etc) | At-desk, "what I'm looking at right now" | Plugin reports active file/selection to daemon |
| Host-app reader | In-app capture (email, messages) | Per-platform, reads surrounding app |

The walk-and-talk case is served almost entirely by the first two. The editor plugins are a separate, later effort aimed at the desk.

---

## The iOS keyboard reality (the one place the guides are aspirational)

Confirmed against Apple's own developer forums and shipping products (Superwhisper): **iOS keyboard extensions cannot record audio.** Full Access and microphone permission are not enough; the extension lacks the entitlement to start a recording. Every shipping voice keyboard on iOS uses the same workaround: the keyboard button triggers the **main app** to open, the app records and transcribes, stashes the result in a shared App Group container, and the text is injected back into the field, with a return-to-app step that Apple keeps changing (Superwhisper's own notes flag manual switch-back on recent iOS).

What this means for the build:

- **iOS keyboard = a launcher, not a capture surface.** It is dictate-only, app-mediated, with a visible app bounce. No in-keyboard live capture, no in-keyboard discuss.
- **Android IME = a real capture surface.** It can record in-IME, show a floating panel, stream a transcript. Genuinely richer.
- The Book 02 iOS keyboard frame (in-keyboard live capture with a voice chip) describes a desired state Apple does not currently allow. That is fine for a vision doc, but the build doc for clients must show the handoff flow instead. Flagged here so it is a deliberate gap, not a surprise in a sprint.

---

## The puck is its own interaction class

The guides treat the puck as a constrained sibling of the app. The build should treat it as a third thing, because two assumptions the app model makes do not hold on the puck:

1. **No screen.** The whole entry/refine model assumes a display to show the transcript, the chips, the produced text. On the puck, everything is spoken. Refine-by-voice on a screenless device is a different interaction that has not been designed.
2. **One button, one wake word.** It cannot offer dictate-vs-discuss as two doors without custom on-device wake-word models (microWakeWord), which are real but are genuine effort and imperfect. Until then, a puck is assigned one voice with a defaulted intent, and the LED colour announces it. The puck effectively does one preset thing well, rather than the full matrix.

This is not a problem to solve now, but the build plan should not pretend the puck is a small phone. It is a different product surface with its own (smaller) interaction design, owed its own short doc when it is prioritised.

---

## Suggested build order (by risk retired, not by feature)

1. **Auto-stop / VAD feel, on the traditional pipeline.** Prototype capture-talk-stop until it feels present. Everything rests on this and it is pure tuning risk. Build it first, alone, before any UI.
2. **The portable core as a standalone process,** with the traditional dictate pipeline end to end: STT then voice-transform then entry. Cheapest, simplest, proves the core loop and establishes the shell that the add-on later wraps.
3. **The entry store and one client's notebook.** The sync spine, talking to the standalone core.
4. **Discuss on the traditional pipeline,** then realtime as an upgrade path behind the quality dial.
5. **The firmware-to-core audio path:** the puck (firmware already built) streaming directly to the core on wake word two, realtime end to end. Proves the bypass and the realtime discuss experience on real hardware.
6. **The HA integration shim:** config devices, automation, and exposing HA's MCP tools to the realtime model. Proves the context/control plane and the additive-to-HA story.
7. **The codebase index and retrieval tool** (unlocks walk-and-talk on the cheap pipeline).
8. **Context layer and confidence routing,** host-app readers per platform.
9. **The embedded-in-Mac-app shell,** once the core is proven standalone. Validates the no-daemon path.
10. **Config interfaces** (onboarding, providers, plugins), which can lag because early users can be hand-configured.
11. **Keyboards and puck UI,** the platform-divergent surfaces, last because they are the most constrained.

---

## Open questions this plan does not yet answer

- The core language decision (Rust/Go core + Python integration shim vs Python everywhere), driven by whether the embedded-in-app shell is worth the cross-language boundary. My lean is Rust/Go core; the topology doc settles it.
- The core/shell interface: what the standalone core exposes so an add-on container, an embedded library, and the Python integration can all drive it identically.
- The exact provider-abstraction interface (what a "STT provider" or "TTS provider" must implement to be swappable).
- Whether the index is per-repo or a single multi-repo index, and how it handles private vs work code.
- How the confidence layer is actually trained or ruled: heuristics first, learned later?
- The full config/onboarding design (its own doc, item 4 above).
- Puck refine-by-voice interaction (its own doc when prioritised).
- Sync conflict model: last-write-wins is probably fine, but offline edits on multiple clients need a real answer.

These are the things the follow-on docs exist to close.
