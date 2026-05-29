# Audio I/O port — wire protocol (v1)

Status: **draft 1** · M06 deliverable
Owners: voix daemon team
Scope: every endpoint that delivers mic audio to (and accepts speaker
audio from) the voix daemon — pucks, phone Auto Mic, Mac hotkey,
iOS keyboard, browser client, embedded sat panels, third-party
endpoints.

This is one of three ports the daemon exposes; the other two
(Pipeline / model, Context / connector) are specified elsewhere
and not covered here.

---

## 1 · Goals + non-goals

### Goals

- **Endpoint-agnostic.** A puck, a phone, and a browser tab all
  speak the same protocol. Devices declare what they can do at
  handshake; the daemon adapts. BYO-device falls out for free.
- **Tiny on the small side.** A microcontroller must be able to
  speak this protocol from C++ with a static JSON buffer + a raw
  WS client. No version negotiation matrix, no schema fetch.
- **Forward-compatible.** Capability list + protocol_version are
  the only knobs the daemon needs to support new device classes.
- **One transport per session.** WebSocket — text frames for JSON
  envelopes, binary frames for PCM. No multiplexing, no separate
  audio channel, no out-of-band signalling. Reconnect = new
  session.

### Non-goals

- **Not a TURN/STUN substitute.** Audio is straight WS-over-TCP.
  Endpoints behind NAT use the daemon's public URL; daemon never
  initiates an outbound connection to an endpoint.
- **Not a transcript protocol.** Transcripts are pipeline output;
  Pipeline port owns them. The Audio I/O port carries the events
  the endpoint *renders* (delta tokens for live captions on the
  puck LED, end-of-turn markers), but the canonical transcript
  store lives behind the Pipeline port.
- **Not a tool-call protocol.** Tools are pipeline-side. The
  endpoint sees their *effects* (audio output, `end_session`
  closing the WS) but doesn't see the tool call shapes.

---

## 2 · Wire framing

Transport: WebSocket over TCP. TLS optional — the daemon listens on
ws:// in the HA Add-on container (HA's ingress terminates TLS in front).

Two frame types, no others:

| Frame type | Direction | Contents |
|---|---|---|
| **Text** | both | JSON envelope, one message per frame, UTF-8 |
| **Binary** | both | Raw PCM16 little-endian, no header, no padding |

**Why no Opus / no codec field.** Pucks send 16 kHz mono PCM16
(640 bytes per 20 ms frame); daemon sends 24 kHz mono PCM16 (960
bytes per 20 ms frame). Browser endpoints will need encoded audio
later — when that lands, the codec is declared in the hello
`capabilities.mic.codec` field and the daemon transcodes inbound.
Outbound to speaker stays uncompressed (the puck's I2S DAC can't
decode Opus on chip; codecs cost SRAM we don't have).

**Frame size budget.** Endpoints SHOULD send mic frames of 20 ms
(320 samples @ 16 kHz). Endpoints MAY batch up to 100 ms (~1600
samples, 3.2 KB) if their network stack needs it. The daemon
accepts anything from 1 sample up to the WS implementation's max
frame; it does its own re-chunking before forwarding to the
pipeline.

**No partial frames.** A binary WS frame is one PCM block. Don't
split a sample across two frames.

---

## 3 · Connection lifecycle

```
endpoint                         daemon
   │                                │
   │  WS upgrade /api/audio-io      │
   │ ─────────────────────────────► │
   │                                │
   │  hello { capabilities … }      │
   │ ─────────────────────────────► │
   │                                │
   │           ready { intent }     │
   │ ◄───────────────────────────── │
   │                                │
   │  binary mic frames →           │
   │  ◄ binary speaker frames       │
   │  ←→ text events                │
   │                                │
   │           (session ends —      │
   │            either side closes  │
   │            the WS)             │
```

### 3.1 Hello

The endpoint sends `hello` as the **first text frame**. The daemon
will not accept any binary frames before the hello arrives. The
hello shape:

```ts
type AudioIoHello = {
  type: "hello";
  protocol_version: 1;

  // Auth: shared secret. Mismatched → daemon sends decline + closes WS.
  token: string;

  // Stable per-endpoint identifier. For pucks: ESPHome device name.
  // For phones / laptops: a UUID written to local storage on first
  // launch. Used for logging + per-device state (active voice, last-seen).
  device_id: string;

  // Why is this capture happening? See §4.
  intent: "dictate" | "discuss";

  // Which voice to apply. Optional — daemon falls back to the
  // device's currently-active voice if absent.
  voice_id?: string;

  // What this endpoint can do. See §5.
  capabilities: Capabilities;

  // Human-readable hint for logs + UI. Optional.
  client_info?: {
    kind: "puck" | "phone-sat" | "laptop-mic" | "browser-tab" | "external";
    version?: string;
    friendly_name?: string;
  };
};
```

### 3.2 Ready / decline

After the hello, the daemon responds with exactly one of:

```ts
type Ready = {
  type: "ready";
  intent: "dictate" | "discuss";
  session_id: string;          // for log correlation
  voice_id: string;            // the voice the daemon resolved to
};

type Decline = {
  type: "decline";
  reason: "auth" | "unknown_voice" | "unsupported_protocol_version"
        | "capacity" | "rate_limit" | "internal";
  detail?: string;
};
```

`decline` is immediately followed by a WS close (code 4000).

### 3.3 Session in progress

Once `ready` lands:

- The endpoint MAY start streaming binary mic frames at any time.
- The daemon MAY start streaming binary speaker frames when
  pipeline output is available.
- Either side MAY send text events from §6.

There is **no mid-session re-handshake**. A change of intent
(starting a new capture, switching voice) closes this session and
opens a new one. This is intentional — the daemon's session
bookkeeping is cheaper than dynamically reconfiguring an in-flight
pipeline.

### 3.4 Reconnection

If the WS drops mid-session, the daemon discards in-flight audio
and closes any upstream provider session (OpenAI Realtime, STT
stream, etc.). There is no resume — the endpoint reconnects with a
fresh hello.

Rationale: voice work is naturally short. The longest legitimate
session in practice is ~3 minutes (the daemon's hard ceiling). Resume
semantics add per-session state on both sides for vanishingly small
win.

### 3.5 Close codes

Standard WS close codes plus voix-specific 4xxx codes:

| Code | Sender | Meaning |
|---|---|---|
| 1000 | either | Normal close |
| 1001 | either | Going away (reconnect or shutdown) |
| 4000 | daemon | Decline (auth, version, capacity) |
| 4001 | daemon | Idle timeout |
| 4002 | daemon | Hard ceiling (3 min) |
| 4003 | daemon | Pipeline error |

---

## 4 · Intent

Two values; pick one at capture-start time.

### `discuss`

The user wants a real-time back-and-forth. The daemon opens a
realtime model session, streams mic up, streams model audio + text
down. The session ends when the model calls `end_session`, the
user signals done, or the watchdog fires.

Voice resolution: the voice's `talkingPrompt` is used as the
realtime instructions. If the voice has both `talkingPrompt` and
`donePrompt`, the killer-flow handoff is in scope (design-brief §3)
— the discuss session can transition into producing a `done`
artifact without re-handshaking.

### `dictate`

The user wants a one-shot capture transformed into an artifact. The
daemon streams mic up to STT, no model output goes back. When the
mic stream ends (push-to-talk release, VAD silence, explicit
`done` event), the daemon runs the voice's `donePrompt` over the
raw transcript and emits the final artifact as a `transcript`
event.

Voice resolution: voice's `donePrompt` produces the artifact;
`talkingPrompt` is ignored.

### What about ambient capture?

Out of scope for v1. A future ambient capture intent would be a
third value here (`listen`?); the protocol is forward-compatible
with new intents as long as the daemon understands them.

---

## 5 · Capabilities

Every hello declares what its endpoint can physically do. The daemon
adapts to the lowest common denominator without renegotiating —
e.g., a browser tab that can only do 48 kHz speaker output gets the
24 kHz pipeline output downsampled in the daemon.

```ts
type Capabilities = {
  // Mic: required for every audio-io endpoint. (Even pure-output
  // surfaces would use a different port, not this one.)
  mic: {
    sample_rate_hz: number;        // 16000 for pucks, 48000 for browsers
    channels: 1 | 2;
    codec?: "pcm16" | "opus";      // omitted = pcm16
  };

  // Speaker: optional. Pure dictation endpoints (a CLI, a keyboard
  // extension) omit this; daemon won't try to play audio back.
  speaker?: {
    sample_rate_hz: number;        // 24000 for pucks, 48000 for browsers
    codec?: "pcm16";
  };

  // Hardware echo cancellation done by the endpoint? Pucks: yes
  // (the XMOS chip does AEC + AGC + a hardware echo gate). Browser
  // tabs that use getUserMedia with echoCancellation: true also
  // count. When true, daemon skips its own echo gate; when false,
  // daemon's energy-based gate runs in front of the pipeline.
  half_duplex_on_chip?: boolean;

  // Wake-word slots claimed by this endpoint, if any. Pucks
  // typically claim ["voix"] or ["voix", "ok_voix"]; phones don't
  // claim any (they use push-to-talk). Used for slot-routing in a
  // multi-puck household — daemon makes sure two endpoints don't
  // both fire on the same wake word.
  wake_words?: string[];

  // Endpoint can stream screen content alongside audio (future).
  // Not implemented in v1; flag exists so endpoints can declare it
  // without forcing a protocol bump.
  screen?: boolean;
};
```

### Daemon-side adaptation rules

- **Mic resampling.** If `mic.sample_rate_hz != 24000`, daemon
  resamples to 24 kHz before handing to the pipeline. (OpenAI
  Realtime requires ≥24 kHz; provider-internal rates are
  pipeline-side.)
- **Speaker resampling.** Pipeline emits at the provider's native
  rate (24 kHz for OpenAI Realtime). Daemon resamples to
  `speaker.sample_rate_hz` before forwarding binary frames.
- **No speaker → no speaker frames.** Daemon never sends binary
  output frames if `speaker` is absent.
- **Half-duplex pucks → no echo gate.** Daemon skips its energy
  gate when `half_duplex_on_chip: true`.

---

## 6 · Text events

Every text frame is a JSON object with a `type` field.

### 6.1 Endpoint → daemon

```ts
type EndpointEvent =
  | { type: "hello"; … }            // §3.1
  | { type: "done" }                // dictate only: end of capture
  | { type: "barge_in" }            // discuss only: user wants to interrupt
  | { type: "metrics"; … };         // optional telemetry (battery, RSSI, jitter)
```

`done` is the explicit end-of-capture signal for dictate sessions.
Endpoints with no VAD send it on push-release; endpoints with VAD
may send it on detected silence. After `done`, the endpoint SHOULD
stop sending binary frames; the daemon discards any that arrive
during the post-done flush.

`barge_in` is the user's "stop talking" signal in a discuss
session. Daemon cancels the in-flight model response. Endpoints
without a barge-in affordance (no button, no detected speech-over)
never send this.

### 6.2 Daemon → endpoint

```ts
type DaemonEvent =
  | { type: "ready"; … }                                // §3.2
  | { type: "decline"; … }                              // §3.2
  | { type: "error"; message: string }                  // soft error, session continues
  | { type: "user_speech_start" }                       // VAD-detected, optional
  | { type: "user_speech_end" }                         // VAD-detected, optional
  | { type: "transcript_delta"; text: string }          // streaming partial transcript
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "audio_start" }                             // model began a turn
  | { type: "audio_end" };                              // model finished a turn
```

Endpoints SHOULD render `transcript_delta` for live captions and
ignore them in their final transcript history (use `transcript`
events). The deltas are not guaranteed to concatenate to the
canonical transcript — providers occasionally rewrite a partial.

---

## 7 · Auth

Single shared secret in `hello.token`. Set by the daemon operator
via the `VOIX_WS_TOKEN` env var (or `ws_token` HA Add-on option).
Endpoints store it locally — pucks in NVS, phones in keychain,
browser in `localStorage` after a one-time pairing flow (deferred).

Mismatched token → daemon sends `decline { reason: "auth" }` and
closes 4000.

**Not in scope:** per-endpoint tokens, token rotation, mTLS. If/when
multi-user comes up, that's a separate protocol bump (v2). For now
the model is "one household, one secret, one daemon."

---

## 8 · Versioning

`protocol_version: 1` is the current and only version. The daemon
will accept (with a warning log) hellos missing the field for one
release cycle after this lands, treating them as v1.

**Bumping the version**: any breaking change to envelopes,
capabilities, or framing requires `protocol_version: 2`. The daemon
will run both versions side-by-side for one release; old endpoints
get logged. After the deprecation window, missing-version hellos
get a decline.

Adding a new optional field to `capabilities` is **not** a version
bump. New endpoint-event types are not a version bump *if* the
daemon ignores unknown types (the contract is: daemon MUST ignore
unknown text-frame types and MUST close on unknown binary framing).

---

## 9 · Examples

### 9.1 A puck wakes to "voix"

Endpoint sends:

```json
{
  "type": "hello",
  "protocol_version": 1,
  "token": "…",
  "device_id": "home-assistant-voice-095e4e",
  "intent": "discuss",
  "voice_id": "default-realtime",
  "capabilities": {
    "mic": { "sample_rate_hz": 16000, "channels": 1 },
    "speaker": { "sample_rate_hz": 24000 },
    "half_duplex_on_chip": true,
    "wake_words": ["voix"]
  },
  "client_info": { "kind": "puck", "version": "2026.5.0" }
}
```

Daemon responds:

```json
{
  "type": "ready",
  "intent": "discuss",
  "session_id": "5a4f9e8b",
  "voice_id": "default-realtime"
}
```

…then binary frames flow in both directions until the session ends.

### 9.2 A phone push-to-talk dictation

Endpoint sends:

```json
{
  "type": "hello",
  "protocol_version": 1,
  "token": "…",
  "device_id": "ios-keyboard-c4b59e1a",
  "intent": "dictate",
  "voice_id": "default-email",
  "capabilities": {
    "mic": { "sample_rate_hz": 48000, "channels": 1 },
    "half_duplex_on_chip": true
  },
  "client_info": { "kind": "phone-sat", "version": "1.0.0" }
}
```

Note: no `speaker` capability — the keyboard extension doesn't play
audio back. Daemon picks an STT-only pipeline; emits one final
`transcript` event with role: "assistant" carrying the polished
output, then closes.

---

## 10 · Out of scope (post-v1)

- **Opus / encoded mic.** Browser tabs will want this.
- **Multi-channel mic.** Beam-formed arrays (e.g. a future
  conference-room endpoint).
- **Screen sharing.** The capability flag exists, the protocol
  doesn't yet.
- **Per-endpoint auth.** When voix grows multi-user.
- **Push notifications back to the endpoint.** Today everything is
  pull (the endpoint connects when it wants audio); push is a v2
  question.
- **The pipeline + provider abstraction.** Sibling document.

---

*See also*: `voix-backend/src/audio_io/protocol.ts` (TS types for
the above), `docs/voix-architecture.md` (the three-port system),
`docs/inventory-vs-architecture.md` §3.1 (the source of this spec).
