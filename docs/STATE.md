# voix — current state & next steps

Living document. Updated at the end of each working session. Mirrors what's
actually deployed on the user's HA + Voice PE (095e4e), not just what's in
the repo.

Last updated: 2026-05-25, end of session 2.

## tl;dr

| Mode | Wake word | Status |
|---|---|---|
| A — HA Assist | Okay Nabu (slot pending) | Works via stock pipeline. Not the active focus. |
| C — Dictation | Hey Jarvis (slot 1) | **Working.** Pipeline-based: `conversation.dictation` writes the helper + flashes the LED + returns empty speech. No fake TTS. |
| B — Realtime | Hey Mycroft (slot 2, **not yet routed** to firmware path) | **WS bridge connects, audio flows device→server, OpenAI never responds.** Active debugging target. |

## What's deployed RIGHT NOW

### Firmware on satellite `home-assistant-voice-095e4e` (Voice PE)

Built and OTA'd from `esphome/home-assistant-voice-095e4e.yaml` via
`scripts/build-local.sh upload`. Compile time ~20-30 s warm. Recent
flash sizes: ~3.24 MB used / 3.93 MB partition (82.5 %), RAM ~22.9 %.

Components added on top of the stock Voice PE chain:

- `globals: voix_mode` + `voix_last_wake_word` — captured in
  `micro_wake_word.on_wake_word_detected` from the wake-word phrase.
- `voice_assistant.on_listening` — mode-discriminated outer ring
  color wash (1=blue assist, 2=amber dictation, 3=magenta realtime).
- `voice_assistant.on_end` — outer ring fade off.
- `voice_assistant.on_error` — outer ring red flash.
- `external_components: local components/voix_realtime_client` —
  our custom C++ component.
- `voix_realtime_client:` — bound to `i2s_mics` + `announcement_resampling_speaker`,
  server `ws://192.168.96.15:8123/api/voix/realtime`. `on_connected`
  → magenta outer ring; `on_disconnected` → off.
- `api.actions: voix_realtime_{start,stop,interrupt}` — exposed as HA
  services `esphome.home_assistant_voice_095e4e_voix_realtime_*`. Manual
  test handles before mWW routing.

### Custom component `esphome/components/voix_realtime_client/`

Three files: `__init__.py` (ESPHome schema + automation registrations),
`voix_realtime_client.h`, `voix_realtime_client.cpp`.

What it does today:

- Subscribes to the configured microphone's `add_data_callback`
  unconditionally at setup. Mic data arrives whenever any other
  consumer (mWW, voice_assistant) has the mic running — we piggyback.
- **De-interleaves stereo → mono** in `on_mic_data_` (keeps even-indexed
  PCM16 samples = channel 0 = the voice_kit AEC-processed signal).
- Queues mono chunks in `outbound_` (mutex-protected deque, capped at
  32 chunks, drops oldest on overflow).
- Main `loop()` drains the outbound queue → `esp_websocket_client_send_bin`
  (non-blocking; drops on full).
- WS binary frames received → queued in `inbound_` (same cap pattern)
  → main loop drains → `speaker->play()` with re-queue-on-partial-accept.
- WS event handler thread defers state changes via atomic flags
  drained on the main loop. Triggers fire main-loop-safe.
- Periodic stats log every 2 s while running: chunk counts + byte
  counters for both directions.

What it does NOT do yet:

- Accept `mode` or `wake_word` arguments to `.start()`. (The unified
  dictation-+-realtime protocol design needs this; see Next Steps.)
- Real JSON parsing on incoming text frames; it does lazy substring
  sniffs for "audio_start"/"audio_end".
- Disconnect/clean state when WS server goes away. (`on_disconnected`
  trigger fires, but the firmware doesn't auto-reconnect, and may
  not unblock if the server-side socket half-closes.)

### HA integration `ha-integration/custom_components/voix/`

Installed at `/config/custom_components/voix/` on the HA host.
Restarted HA picks it up. Single config entry, `unique_id=voix`,
data has `openai_api_key` (extracted server-side from the user's
existing `openai_conversation` entry) + dictation/LED defaults.

Platforms:

- `conversation.dictation` — Mode C agent. Writes the input_text
  helper, flashes the LED via service call, fires
  `voix_dictation_captured` event, returns empty speech.
- `conversation.realtime` — pipeline-mode B agent (legacy path).
  Returns `continue_conversation=true` + transcript-as-speech so HA
  doesn't skip the TTS stage. Currently NOT used by the WS-bridge
  Mode B path.
- `stt.realtime` / `tts.realtime` — pipeline-mode B engines. Bridges
  STT audio to OpenAI Realtime in a turn-based way. Worked for one
  turn, but UX is turn-based with no interruption — the reason we
  built the WS-bridge path.
- `text.dictation` — surfaces the latest dictation transcript as a
  HA-owned TEXT entity (replaces the user-created `input_text.*`
  helper). Per-device entity creation is a TODO (see Next Steps).

WebSocket endpoint:

- `ws_view.py` registers `/api/voix/realtime`. `requires_auth=False`
  for now (LAN-only assumption). Per device connection:
  - Holds the device WS, waits for first binary chunk before opening
    OpenAI Realtime (lazy — zero cost if device never speaks).
  - OpenAI connect: `wss://api.openai.com/v1/realtime?model=<model>`,
    `Authorization: Bearer <key>`, 10 s connect timeout. Session.update
    uses the new "GA" shape (`session.type=realtime`, audio nested
    under `audio.input`/`audio.output`).
  - Pump device→openai: upsamples 16 → 24 kHz with `audioop.ratecv`,
    base64-encodes, sends `input_audio_buffer.append`.
  - Pump openai→device: forwards 24 kHz PCM straight from `audio.delta`
    events. (Device's `announcement_resampling_speaker` does 24→48 kHz.)
  - Watchdog task: closes the bridge on `IDLE_TIMEOUT_S = 30` (no
    audio in for 30 s) or `SESSION_HARD_MAX_S = 120` ceiling.
  - Logs session duration + total bytes both directions at WARNING
    on close (so it surfaces in `system_log/list`).

### HA config (live state on user's HA)

- `internal_url` set to `http://192.168.96.15:8123` (direct to HA Core
  — bypasses reverse proxy, reachable from the satellite's VLAN).
- Voice PE `095e4e`:
  - wake_word slot 1 = "Hey Jarvis" → `select.…assistant` = voix-dictation
  - wake_word slot 2 = "Hey Mycroft" → `select.…assistant_2` = voix-realtime
    (the **pipeline-based** Mode B; firmware-WS-bridge Mode B isn't
    routed from mWW yet, only callable via `voix_realtime_start` service)
  - wake_word_sensitivity = Very sensitive
  - mute = off
- Pipelines: Home Assistant (default), V1 (legacy, broken Wyoming), voix-assist,
  voix-dictation, voix-realtime
- OpenAI Conversation integration STT/TTS use `en-US` (NOT `en` — that
  bit us hard; HA's STT resolver does exact language tag match)

## What we proved this session

1. **Local build pipeline works** (`scripts/build-local.sh`). Cold compile
   ~3 min, warm compile ~20-30 s. ~5× faster iteration than the HA
   dashboard. Toolchain cached at `esphome/.esphome/`.
2. **Custom firmware component compiles + runs.** `voix_realtime_client`
   adds ~6 KB Flash, ~300 B RAM.
3. **End-to-end WS bridge works at the connection level**: device opens
   WS to `/api/voix/realtime`, HA's aiohttp view accepts, `on_connected`
   trigger fires, LED turns magenta.
4. **Mic audio reaches the server.** A 70-s session sent 8.67 MB —
   confirmed audio is flowing. (Subsequently identified as stereo
   interleaved — fixed by de-interleaving channel 0 in firmware.)
5. **Cost safeguards in place** in `ws_view.py`: lazy OpenAI open,
   30 s idle timeout, 120 s hard max, byte counters logged on close.

## What's NOT working

**OpenAI doesn't respond.** After 70 s of mic audio (both stereo and
mono variants), server logged 0 bytes out. Suspects in priority order:

1. **`session.update` shape may be silently rejected.** Production
   Realtime API has changed. The current `audio.input.format` /
   `audio.output.format` nested-dict shape may still be wrong. The
   beta header is gone but session config could be off. **Action: log
   ALL OpenAI WS frames at WARNING for one test cycle to see what
   OpenAI is sending us (errors, session.created, etc.).**
2. **No explicit `input_audio_buffer.commit`.** With default `turn_detection`
   (server_vad), commit is auto. But if turn_detection got set wrong
   or rejected, server_vad might not fire. **Action: try both
   `turn_detection: null` with explicit commits AND default server_vad.**
3. **API key scope.** The key works for `openai_conversation` (HTTPS API)
   but may not have Realtime entitlement on the account. **Action:
   curl the model list with the key, confirm Realtime models present.**
4. **Audio format mismatch.** Even after the mono fix, sample-rate
   conversion math could be off. **Action: dump a sample of the
   pcm24k we're sending and verify it's playable.**

Also broken / annoying:

- After a Mode B session, the device's LED **stays magenta** until
  watchdog closes the server side (≤120 s) — the firmware's
  `on_disconnected` doesn't appear to fire reliably. Likely the device
  doesn't see the server-side close (TCP half-open). **Action: have
  firmware send a `{"type": "stop"}` and wait briefly before teardown,
  or rely on a server-initiated WS close frame the device reacts to.**

## Architecture state

- Mode A: stock HA pipeline. Untouched.
- Mode C: HA pipeline + our conversation agent. Untouched in this session.
- Mode B: TWO architectures coexist —
  - **Pipeline-based** (single-turn, turn-based, no interrupt): `stt.realtime`
    + `conversation.realtime` + `tts.realtime`. Bound to voix-realtime
    pipeline, bound to slot 2 wake word "Hey Mycroft". This is what
    fires today when the user says "Hey Mycroft" via the standard
    Assist pipeline.
  - **Firmware WS bridge** (full duplex, multi-turn, interruptible):
    `voix_realtime_client` + `ws_view.py`. Only fires when the
    `voix_realtime_start` service is called. mWW does NOT route to it yet.

Plan is to retire the pipeline-based Mode B once the firmware WS path
is solid AND we can route dictation through the same bridge.

## Next steps (priority order)

1. **Get OpenAI responding.** Verify session.update shape + dump OpenAI
   frames at WARN level. This unblocks every other Mode B work item.
2. **Fix the LED-stays-magenta-after-stop bug.** Two-step shutdown in
   firmware: send `{"type":"stop"}`, sleep 200 ms, then close socket.
   Server reacts to the close and the round-trip happens cleanly.
3. **Pass `mode` + `wake_word` to `.start()`.** Update the action
   schema (Python) + C++ action class to accept templated parameters;
   forward in the WS hello message:
   ```json
   {"type":"hello","mode":"realtime","wake_word":"Hey Mycroft","device":"<name>"}
   ```
4. **Server-side dispatch on `mode`** in `ws_view.py`. realtime branch
   = current logic; dictation branch = buffer audio until device sends
   `audio_end`, then POST OpenAI Whisper, write `text.voix_dictation`,
   send `transcript` text frame back, close.
5. **Route Hey Mycroft → `voix_realtime_client.start: { mode: realtime }`**
   in `mWW.on_wake_word_detected`. Route Hey Jarvis → same start with
   `mode: dictation`. Retire `voix-dictation` pipeline + the
   `stt.realtime`/`tts.realtime` engines once verified.
6. **Per-device entities.** WS view dispatches a "device discovered"
   signal on first hello message; `text.py` listens and calls
   `async_add_entities` per device. Devices registered in HA's
   device registry by MAC.
7. **Token-based auth on the WS endpoint.** Generate a per-device
   token at integration setup; store in the device's secrets.yaml;
   firmware sends it in a header or query param; `ws_view.py` validates.
8. **Test on the second Voice PE** (`096013`, currently offline,
   firmware 25.1.0 — needs an upgrade). Confirms hardware-portability
   of the build.

## Gotchas / lessons (for future-me)

- **HA pipeline requires non-empty speech to run TTS.** Returning
  empty speech from the conversation agent makes the pipeline skip
  TTS entirely — that's why our Mode B-pipeline first attempt didn't
  play the audio our STT had stashed. Fixed by returning the
  transcript (or any non-empty string) as the "speech".
- **OpenAI STT/TTS language is BCP-47 (en-US), not `en`.** HA's
  resolver does exact match.
- **Upstream Voice PE 26.4.0 silently pulls `esphome@ff8ce89…` for
  http_request**, which conflicts with newer ESPHome's `micro_wake_word`
  registration and silently breaks wake-word detection. Fixed in 26.5.0
  which removed the pin. We require ESPHome dashboard ≥ 2026.5.0.
  Issue: <https://github.com/esphome/home-assistant-voice-pe/issues/582>.
- **Upstream Voice PE 8 MB build chains 3 YAMLs**: `home-assistant-voice.8mb.yaml`
  → `home-assistant-voice.factory.yaml` → `home-assistant-voice.yaml`.
  Including only the bottom one gives you wrong partition table +
  no BLE-wait wrapper on `on_client_connected`, which silently breaks
  micro_wake_word startup.
- **HA's `internal_url` MUST be reachable from the satellite's VLAN.**
  When set to the external hostname, the satellite can't fetch TTS
  audio and pipelines stay degraded (sometimes silently blocking
  mWW startup). Set it to `http://<ha-ip>:8123` directly.
- **ESPHome restricts `homeassistant.event:` names to `esphome.*` prefix.**
  Our `voix.realtime_requested` was rejected; we ended up going the
  custom-firmware-component path which sidesteps this entirely.
- **`voice_assistant.stop:` only stops satellite-side audio capture.**
  HA's pipeline runs server-side and ignores it. To prevent HA from
  speaking after dictation, the conversation agent has to return empty
  speech OR we have to short-circuit at the server.
- **i2s_mics on Voice PE is stereo interleaved PCM16** (2 channels
  per frame). To get mono for OpenAI, de-interleave keeping even-
  indexed bytes (channel 0 = AEC-processed). Upstream's mWW config
  uses `channels: 1` for this — we did it in C++.
- **Don't open OpenAI Realtime until you have user audio.** Charges
  start the moment the WS is open. `ws_view.py` does this lazily.
- **`add_data_callback` on the mic fires continuously** while ANY
  consumer has the mic running (mWW always does, once `mww.start`
  has fired in `on_client_connected`). Our component gates inside
  the callback on `state_ == RUNNING` so we only forward during a
  session.

## Useful one-liners

```bash
# fast iteration cycle
./scripts/build-local.sh compile          # ~20 s warm
./scripts/build-local.sh upload           # compile + OTA
./scripts/build-local.sh logs             # stream device logs (often flaky)

# deploy HA integration
scp -rq ha-integration/custom_components/voix root@192.168.96.15:/config/custom_components/
ssh root@192.168.96.15 'ha core restart'

# manual Mode B test (WS-bridge path)
curl -X POST -H "Authorization: Bearer $HA_TOKEN" \
  https://home.thenairn.com/api/services/esphome/home_assistant_voice_095e4e_voix_realtime_start \
  -d '{}'
# ...speak...
curl -X POST -H "Authorization: Bearer $HA_TOKEN" \
  https://home.thenairn.com/api/services/esphome/home_assistant_voice_095e4e_voix_realtime_stop \
  -d '{}'

# pull voix-related HA logs
python3 scripts/ha-ws.py '{"type":"system_log/list"}' | jq '.result[] | select(.source[0]|contains("voix"))'

# force-close any leaked WS sessions (cost safety)
curl -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  https://home.thenairn.com/api/services/homeassistant/reload_config_entry \
  -d "{\"entry_id\":\"<voix_entry_id>\"}"
```

## Open files of interest

- `esphome/components/voix_realtime_client/{__init__.py,voix_realtime_client.h,voix_realtime_client.cpp}`
  — custom firmware component
- `esphome/home-assistant-voice-095e4e.yaml` — Tom's specific consumer YAML
- `ha-integration/custom_components/voix/ws_view.py` — server-side WS bridge
- `ha-integration/custom_components/voix/realtime.py` — pipeline-mode B session manager (legacy path; will retire)
- `ha-integration/custom_components/voix/{stt,tts,conversation,text}.py` — pipeline platforms + dictation conv agent + text entity
- `scripts/build-local.sh` — local compile/upload/logs wrapper
- `scripts/ha-ws.py` — HA WebSocket helper for pipeline-debug + service calls
