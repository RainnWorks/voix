# Voix Architecture

**The abstraction spine.** This is the document every other one references. It defines the stable core and the five ports around it. The goal is that the product is extensible by design: new devices, new models, new context sources, and new clients are *implementations of a port*, not new special cases bolted onto the core.

The test applied to every port: **could a third party implement this without touching the core?** If yes, it is a real port. If no, the boundary is wrong.

---

## The shape in one picture

```
                        +---------------------------+
                        |        VOIX CORE          |
                        |                           |
                        |  voices · entries · the   |
                        |  notebook · context       |
                        |  router · orchestration   |
                        +------------+--------------+
                                     |
        +----------------+----------------+----------------+----------------+
        |                |                |                |                |
   AUDIO I/O        PIPELINE /        CONTEXT /          CLIENT           SHELL
    PORT            MODEL PORT       CONNECTOR PORT       PORT          (wraps core)
        |                |                |                |                |
   puck (1st)       OpenAI realtime   HA integration    desktop         add-on
   BYO ESP32        Whisper+Ollama    host-app reader   web             standalone
   phone-as-sat     +Piper (local)    codebase index    mobile          embedded
   laptop mic       Deepgram          git MCP           keyboard        in app
   conf speaker     ...               editor plugin     ...
```

The core owns the **nouns** (what a voice is, what an entry is, how the notebook syncs). Everything else is a **port**: a contract the core defines and implementations plug into. The core never names a puck, an OpenAI, a Gmail; it names "an audio transport," "a model provider," "a context source."

---

## The core (the stable centre)

The core owns and only owns the things that do not change when you swap a device, a model, a context source, or a client:

- **Voices.** The persistent, colour-coded personas. Their prompts (talking phase, done phase), their provider preferences.
- **Entries and the notebook.** Every capture becomes an entry; the notebook is the synced store; refine is the universal tail.
- **The context router.** Given a capture, decide which context sources to consult and assemble what the model sees. Includes the confidence layer (cheap signals always, expensive fetches only when worth it).
- **Pipeline orchestration.** Run the dictate path or the discuss path; decide traditional vs realtime; sequence STT, model, TTS, or a realtime session. The core decides *what* happens; the pipeline port provides *who* does it.
- **The core API.** The single local interface every client and device talks to.

The core is deliberately ignorant of: what hardware captured the audio, which company's model transcribed it, where the context came from, what the UI looks like, and where its own process is running. Each of those is a port.

---

## Port 1: Audio I/O (nail this first)

**Contract:** capture audio and stream it to the core; receive audio from the core and play it. Bidirectional, low-latency, realtime-capable. Announce identity and capabilities (has a screen? mic only? mic plus speaker? what wake words?).

**Why it is first:** it is real hardware, it is the riskiest interface to get right, and the puck (the Home Assistant Voice PE with the custom firmware) is the first implementation. Hardware interfaces are unforgiving; the protocol, the latency budget, and the auto-stop feel all have to be proven on a real device before anything else is worth building.

**Why it is its own port and not "the puck":** the moment you treat it as a device class rather than a named thing, bring-your-own-device falls out for free. The core sees an audio transport; it does not care what is on the other end. So all of these are the same port, just different implementations:

| Implementation | What it is | Note |
|---|---|---|
| Voice PE puck | The first, the reference | Custom firmware, streams direct to core on wake word two |
| BYO ESP32 / ESPHome device | A satellite the user flashed | Same protocol, community hardware |
| Old phone as a satellite | A spare device left in a room | Phone running in audio-I/O-only mode |
| Laptop / desktop mic | The machine you are at | The client and the audio device on one box |
| Conference speaker, etc | Any mic-plus-speaker endpoint | If it speaks the protocol, it works |

**The key consequence:** a screenless puck and a screenful phone share the *exact same audio path*. The phone is two ports at once (a client with a screen, and an audio I/O implementation); the puck is only this port. Treating audio I/O as its own layer is what lets them share the path instead of each reimplementing capture.

**What the core defines here:** the streaming protocol (WebSocket/WebRTC), the audio format, the capability handshake, the wake-word-to-stream handoff. A third party implementing this port flashes or writes a device that speaks the protocol; they never touch the core. That is the test passing.

---

## Port 2: Pipeline / model

**Contract:** given audio (or text) and a target voice, do one stage of the work. STT: audio to text. LLM/transform: text to text in the voice. TTS: text to audio. Or, for realtime: run a bidirectional speech-to-speech session. Each stage is a swappable provider behind a uniform interface.

**Why it is a port:** this is the bring-your-own-model promise expressed as architecture. The core says "transcribe this," "apply this voice," "speak this," or "run a realtime session." Who does it is configuration:

| Stage | Cloud implementations | Local implementations |
|---|---|---|
| STT | Deepgram, OpenAI Whisper API | local Whisper, whisper.cpp |
| Transform (voice) | any chat LLM API | Ollama, llama.cpp |
| TTS | ElevenLabs, Deepgram Aura | Piper |
| Realtime (discuss) | OpenAI GPT-Realtime-2 | (none yet; cloud-only luxury) |

**Why this matters for the product:** the traditional STT-LLM-TTS path can run *entirely local* (Whisper + Ollama + Piper on your box), which is the purest privacy story and costs nothing per minute. Realtime is a cloud-only premium layer. Because both sit behind the same port, the quality dial (cheap-and-private vs fluid-and-cloud) is a provider swap, not a rewrite. The core orchestrates stages; it does not know or care whose model fills each one.

**The test:** a third party adds a new TTS provider by implementing the TTS interface and registering it. The core, the voices, the clients all keep working unchanged. Passes.

---

## Port 3: Context / connector

**Contract:** given a capture (and its surface), provide relevant context, and optionally expose tools the model can call. "Here is the thread you are replying to." "Here is the room you are in." "Here are three relevant code chunks." "Here are the HA devices you can control."

**Why it is a port:** context sources are wildly heterogeneous and must be addable without core changes. The HA integration is the first implementation, and it is explicitly a connector, not a shell: it runs inside Home Assistant, talks to a core running elsewhere, and feeds the context/control plane. The others slot in beside it:

| Implementation | Provides | Tools? |
|---|---|---|
| HA integration | room, home state, areas | yes: device control, scenes, automations |
| Host-app reader | the app and thread you are in | no |
| Codebase index | relevant code chunks (retrieval) | yes: search the repo |
| Git MCP | history, diffs, blame | yes: git operations |
| Editor plugin (VS Code, Claude Code) | active file, cursor, selection | maybe |
| Calendar / time | what is on, what time it is | no |

**The confidence layer sits above this port, in the core.** Connectors advertise what they *can* provide and how expensive it is; the core's confidence layer decides which to actually consult for a given capture. A connector never decides it is relevant; it just offers, and the core chooses. That keeps connectors dumb and swappable and the routing logic central.

**The test:** someone writes a Notion connector that feeds meeting notes as context and exposes a "create page" tool. They implement the connector interface; the core's router picks it up. No core change. Passes.

---

## Port 4: Client

**Contract:** render the notebook, let the user capture (dictate/discuss) and refine, manage admin (voices, surfaces, connectors). Consume the core API; contain no core logic.

**Why it is a port:** the clients are native and divergent (desktop sidebar, iOS tab bar, Android nav, web ingress, the cramped keyboards), but they are all *views over the same core*. A client is a renderer plus an input surface, nothing more. The notebook it shows, the voices it offers, the entries it lists all come from the core.

| Implementation | Note |
|---|---|
| Desktop app | widest canvas, reference layout |
| Web client | served via HA ingress; also the no-install front door |
| iOS app | full client; contains an audio I/O implementation too |
| Android app | as iOS |
| iOS keyboard | capture-only, handoff to app (Apple constraint) |
| Android IME | capture-only, in-keyboard (richer) |

**The overlap worth seeing:** a phone app is a client (port 4) that *also* implements audio I/O (port 1). The keyboard is a capture-only client that, on iOS, cannot implement audio I/O itself and must hand off. Keeping client and audio-I/O as separate ports is what makes these combinations expressible instead of tangled.

**The test:** a third party builds a CLI client or a watch app against the core API. The core does not change. Passes.

---

## Port 5: Shell (where the core runs)

**Contract:** host the core process and manage its lifecycle and updates. This is not a port the core calls *out* to; it is the wrapper *around* the core. Included in the five because "where does the core execute" is a real, separate axis from everything above.

| Shell | Core runs as | Needs HA? |
|---|---|---|
| HA Add-on / App | Supervisor-managed container | Yes (HAOS/Supervised only) |
| Standalone daemon | own process / container | No |
| Embedded in app (Mac first) | in-process library | No |

**The constraint this puts on the core:** to support the embedded shell, the core must compile to both a standalone binary and an embeddable library. That pushes toward a Rust or Go core. The HA *connector* (port 3) is Python because HA components are Python, but it talks to the core over the protocol, so the languages can differ cleanly. Shell choice and connector language are independent.

---

## Why the layering is the point

Three payoffs, each a direct consequence of the ports being real:

1. **The puck stops being special.** It is implementation one of the audio I/O port. Bring-your-own-device is not a feature to build later; it is what the port already allows. A flashed ESP32 or a spare phone is the same contract.
2. **Bring-your-own-model is not a setting bolted on; it is a port.** Local-only, cloud, or mixed is provider configuration behind one interface. The privacy story (fully local pipeline) and the premium story (realtime) are the same architecture with different implementations plugged in.
3. **The core stays small and stable.** Every "can it also do X" question becomes "which port does X implement," not "how do we change the core." That is the difference between a product that extends and one that accretes special cases.

---

## Ordering (what to build, in what order)

Driven by the abstraction spine and the rule that the riskiest real interface goes first.

1. **Core nouns, minimal.** Voices, entries, the notebook store, the core API. Enough to have something for a port to plug into.
2. **Audio I/O port + the puck, first.** Real hardware, riskiest interface. Prove the streaming protocol, the latency budget, and the auto-stop feel on the actual Voice PE firmware before anything else. This is the make-or-break interface.
3. **Pipeline/model port, traditional path.** STT to transform to entry, on the cheapest providers, so the puck can actually produce something. Realtime added behind the same port afterwards.
4. **One client.** A single notebook view over the core, to make entries visible and refinable.
5. **Context/connector port + the HA connector.** Context and the realtime model's tools, proving the control plane.
6. **Generalise the ports.** BYO audio devices, more model providers, more connectors, more clients. By now each is "implement the interface," not new core work.
7. **Shells.** Standalone first (it is how the core already runs), then add-on (wraps it), then embedded-in-app (links it).

The first three items are the whole risk. If the audio I/O port and the traditional pipeline produce a good entry from the puck, with the right feel, the rest is plugging implementations into proven ports.

---

## Open questions this raises

- The exact audio I/O protocol (framing, capability handshake, reconnection, the wake-word-to-stream handoff). This is the first spec to write.
- Whether the pipeline port treats realtime as a single combined provider or as a distinct mode that bypasses the staged STT/LLM/TTS interface (it does not fit the three-stage shape, so probably its own provider type).
- How connectors advertise cost to the confidence layer (a static tier, or a live estimate?).
- The core API surface itself: one protocol for clients and audio devices, or two (they have very different needs, a client lists entries, a device streams audio)?
- Core language: Rust vs Go, settled by the embedded-shell requirement and the team's comfort.
