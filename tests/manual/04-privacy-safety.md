# 04 — Privacy & Safety Manual Test Scenarios

Behavior-driven tests for voix from the perspective of a privacy- and
cost-conscious power user. Focus areas:

- **Cost containment** — OpenAI Realtime is billed per audio-minute. A leaked
  session is a leaked wallet.
- **Data exfiltration** — what speech (and how much) leaves the LAN, and when?
- **Failure modes** — OpenAI down, unreachable, garbage, key revoked.
- **Auth surface** — `requires_auth=False` on `/api/voix/realtime`
  (`ws_view.py:81`). LAN-only assumption.
- **Tool side effects** — the model can turn on lights and run scripts with
  no confirmation.

Key constants under test (cite when filing bugs):
- `SESSION_HARD_MAX_S = 600.0` — `ws_view.py:53`
- `IDLE_TIMEOUT_S = 30.0` — `ws_view.py:54`
- `_DictationBridge.HARD_MAX_S = 60.0` — `ws_view.py:708`
- `_DictationBridge.SILENCE_HANG_S = 1.2` — `ws_view.py:707`
- `requires_auth = False` — `ws_view.py:81`
- `cfg.disable_auto_reconnect = true` — `voix_realtime_client.cpp:175`

Setup assumptions for every scenario unless overridden:
- One Voice PE flashed with the project firmware, joined to LAN.
- HA is reachable at `http://<ha>:8123`; voix integration installed and
  configured with a valid OpenAI key.
- HA logger configured: `custom_components.voix: info` (so the `voix WS: ...`
  WARNING lines from `ws_view.py` always surface, plus INFO breadcrumbs).
- A second terminal tailing HA logs: `ha core logs -f | grep voix`.
- OpenAI dashboard open on the **Usage → Audio** page, narrowed to the test
  window so you can verify the **bytes/minutes** counter delta.
- Packet capture is available (e.g. `tcpdump -i eth0 host api.openai.com`) on
  the HA host for the few scenarios that need to confirm "nothing left the
  building."

---

## Scenario 1: Silent device — never bills OpenAI

**Given** the device is freshly booted and idle (no wake word triggered),
the WS to HA is closed.
**When** I manually open the WS by invoking the firmware `start` action
(or push the center button to enter Realtime mode and then make absolutely
no sound — fully muted room, mic blocked).
**Then** the firmware connects, sends its `hello`, the server replies
`{"type":"ready"}`, and after ~30 s the watchdog fires the
`"voix WS: no speech in first %.1fs; closing"` branch
(`ws_view.py:309-313`). The session closes with `in=<small> out=0` bytes
and OpenAI's Realtime WS was **never opened** (lazy open in
`_device_to_openai`, `ws_view.py:534-539`).

Cost / safety guarantees:
- [ ] OpenAI dashboard "Audio input minutes" delta over the test window = 0.
- [ ] OpenAI Realtime sessions count in dashboard = unchanged.
- [ ] No outbound TCP traffic to `api.openai.com` during the session
      (verify in `tcpdump`).

How to verify (concrete):
- Log line: `voix WS: no speech in first` (from `ws_view.py:311`).
- Log line: `voix WS: session closed after 3X.Xs (in=*B, out=0B)` — note
  `out=0B`.
- Absent log line: `voix WS: OpenAI Realtime session opened` should
  **not** appear (`ws_view.py:374`).
- HA entity: `select.<device>_voix_mode` still shows `Realtime`, but the WS
  is closed (no `connected` event from `voix_realtime_client`).

---

## Scenario 2: Normal turn, then user walks away

**Given** the device is in Realtime mode, connected.
**When** I say "what time is it", get the spoken reply, and then stand in
silence for 35 s.
**Then** the watchdog's "true idle" branch closes the session (~30 s after
`response.done`'s last `_last_speech_activity` stamp;
`ws_view.py:296-304`). The device sees a clean WS disconnect and does
**not** auto-reconnect (`cfg.disable_auto_reconnect = true`,
`voix_realtime_client.cpp:175`).

Cost / safety guarantees:
- [ ] One bill-relevant minute (the turn) on the OpenAI dashboard, not
      thirty.
- [ ] Device LED returns to the mode's idle color (not stuck "speaking").
- [ ] No reconnect storm — firmware stays disconnected until the next wake
      word / button press.

How to verify (concrete):
- Log line: `voix WS: no OpenAI activity for 3X.Xs > 30s; closing`
  (from `ws_view.py:301-303`).
- Log line: `voix WS: openai pump exited. counts={...}` shows
  `response.done: 1`, `response.created: 1` (`ws_view.py:683`).
- HA dashboard: `text.<device>_voix_dictation` unchanged (Realtime mode
  doesn't write here).
- OpenAI usage delta ≈ length of the turn × 2 (input + output minutes).

---

## Scenario 3: Long reply ≤ 600s does NOT trip idle; 600s hard-max wins

**Given** Realtime mode, connected. Mode prompt edited to "always give an
exhaustive multi-paragraph answer."
**When** I ask "tell me everything you know about photosynthesis." The
model speaks continuously for ~3 minutes.
**Then** during the reply, `audio.delta` events keep firing →
`_last_speech_activity` is refreshed on every delta
(`ws_view.py:618-625`, including `t.endswith("audio.delta")`). The idle
watchdog does **not** fire. If the back-and-forth continues past 10 min
total, the hard-max branch closes the session (`ws_view.py:291-295`).

Cost / safety guarantees:
- [ ] No premature mid-reply cutoff (the 30 s idle does not bite during
      active output).
- [ ] Absolute ceiling at 600 s — no runaway "I forgot a session was
      open all night" outcome.

How to verify (concrete):
- Log line: `voix WS: hitting hard max 600s; closing` if you stage a
  conversation that goes past 10 min (`ws_view.py:293`).
- Log line: `voix WS: session closed after 600.Xs` with a sizeable
  `out=` byte count.
- OpenAI dashboard: output audio minutes for this test = the actual reply
  length, not a truncated chunk.

---

## Scenario 4: Mid-session Wi-Fi cut on the device

**Given** Realtime mode mid-turn (model is speaking).
**When** I yank the device's Wi-Fi (router AP off, or unplug the device).
**Then** the device's WS to HA goes dead. HA's aiohttp WS heartbeat
(`heartbeat=15.0` on `WebSocketResponse`, `ws_view.py:136`) detects no
pong within the configured interval and the `_device_to_openai` async-for
loop receives `WSMsgType.CLOSE`/`CLOSED`/`ERROR` and returns
(`ws_view.py:579-580`). The bridge's `finally` closes the OpenAI WS
(`ws_view.py:268-272`). On the firmware side,
`disable_auto_reconnect = true` ensures the device stays down until
explicit `start` (`voix_realtime_client.cpp:175`).

Cost / safety guarantees:
- [ ] OpenAI Realtime session closes within ~15-30 s of the disconnection,
      not minutes.
- [ ] No "phantom" session lingering on OpenAI's side billed for full
      `SESSION_HARD_MAX_S`.
- [ ] When Wi-Fi returns, the device does **not** auto-reconnect — must
      be wake-word / button triggered.

How to verify (concrete):
- Log line: `voix WS: session closed after <duration>s (in=*B, out=*B)`
  appears within ~30 s of the Wi-Fi cut (`ws_view.py:273-277`).
- OpenAI dashboard: usage stops within seconds of the cut.
- ESPHome serial: `ws DISCONNECTED` (`voix_realtime_client.cpp:30`), then
  state stays `IDLE` — no `ws CONNECTED` until manual start.

---

## Scenario 5: Reload the voix integration mid-session

**Given** Realtime mode, mid-turn.
**When** I call `Developer Tools → YAML → Reload → voix` (or restart the
config entry via the UI).
**Then** `async_unload_entry` (`__init__.py:325-330`) runs, which awaits
`manager.close()` and unloads platforms. The aiohttp app shutdown cancels
the in-flight WS handlers, `_device_to_openai`/`_openai_to_device`/
`_watchdog` get cancelled in the `finally` block (`ws_view.py:264-272`),
and the OpenAI WS is closed. The device sees a WS close, stays idle.

Cost / safety guarantees:
- [ ] Exactly one OpenAI session closed (no orphan still open on the
      OpenAI side).
- [ ] HA log shows the bridge's session-end line before the reload
      completes.

How to verify (concrete):
- Log line: `voix WS: session closed after *s` before
  `Setup of voix took *s` reappears.
- After reload, the device's mode select and text entity are recreated
  (per-device discovery still in `entry.options[CONF_DISCOVERED_DEVICES]`).
- OpenAI dashboard: only one session for the test window.

---

## Scenario 6: HA restart mid-session

**Given** Realtime mode, mid-turn.
**When** I issue `ha core restart` (or hit Settings → System → Restart).
**Then** HA's web server tears down. The aiohttp WS handler exits, the
bridge's `finally` runs (`ws_view.py:264-272`), the OpenAI WS closes.
After HA restarts, the firmware (which now has a dead TCP connection
because the HA process died) eventually notices via WS error/disconnect.
**Auto-reconnect is disabled** so the device stays IDLE — no surprise
session on reboot.

Cost / safety guarantees:
- [ ] No "ghost session" on OpenAI past HA's restart window.
- [ ] Device does not auto-establish a new session post-restart.

How to verify (concrete):
- HA logs (post-restart) contain a final `voix WS: session closed` line in
  the pre-restart log slice.
- ESPHome serial shows `ws DISCONNECTED` and stays IDLE.
- Manually press the button → new session opens cleanly; one new session
  on the OpenAI dashboard.

---

## Scenario 7: OpenAI key removed / invalid

**Given** Realtime mode, OpenAI key field cleared (or set to `sk-invalid`)
via Reconfigure. Integration reloaded.
**When** The device wakes and the WS opens.
**Then** Two paths depending on key state:
- *Empty key*: `_openai_key()` returns `None` → `ws_view.py:160-166`
  closes the WS with a `voix WS: declining mode=... — no OpenAI key
  configured` warning. Device sees a clean close. **OpenAI never
  contacted.**
- *Bad key*: connect proceeds; `_connect_openai` opens the WS and the very
  first frame returns an OpenAI `error` event → forwarded to device
  (`ws_view.py:675-680`). Bridge closes. **One handshake-sized TLS round
  trip to OpenAI but no audio uploaded.**

Cost / safety guarantees:
- [ ] Empty key: zero outbound traffic to OpenAI (`tcpdump` confirms).
- [ ] Invalid key: only a handshake, no audio frames sent.
- [ ] No retry loop / repeated bad-auth hammering.

How to verify (concrete):
- Log line (empty): `voix WS: declining mode=... (type=realtime) — no
  OpenAI key configured` (`ws_view.py:163`).
- Log line (invalid): `voix WS: openai error {'message': 'Incorrect
  API key', ...}` (`ws_view.py:677`).
- OpenAI dashboard: no Realtime session counted (or one zero-byte one for
  the bad-key case).

---

## Scenario 8: OpenAI's WS endpoint unreachable

**Given** Realtime mode. Block outbound to `api.openai.com:443` via a
firewall rule (`pfctl`, `iptables`, or just yank the HA host's default
gateway).
**When** The device wakes and starts streaming audio.
**Then** `_connect_openai` wraps the connect in `asyncio.wait_for(...,
timeout=10.0)` (`ws_view.py:323-331`). On timeout/refusal it logs
`voix WS: OpenAI Realtime connect timed out after 10s` (or `connect
failed: ...`, `ws_view.py:332-337`) and the exception propagates. The
`run()` task ends, the device sees a WS close. No bouncy reconnect.

Cost / safety guarantees:
- [ ] Single 10 s timeout, not a retry storm.
- [ ] Device disconnects gracefully; LED returns to idle color.
- [ ] No mic audio sat in any queue heading nowhere — `_device_to_openai`
      throws on first `await self._openai.send(...)` once `_openai` died.

How to verify (concrete):
- Log line: `voix WS: OpenAI Realtime connect timed out after 10s`
  (`ws_view.py:333`) or `connect failed: ...` (`ws_view.py:336`).
- Log line: `voix WS: task ended with <exception>` (`ws_view.py:263`).
- Firmware serial: `ws DISCONNECTED` within ~10-15 s; state returns to
  `IDLE`.

---

## Scenario 9: Same device reconnects (after crash & reboot)

**Given** Device A is in Realtime mode with a session open (mid-quiet,
just after a turn). HA shows the session active.
**When** I power-cycle the device (or kill its ESPHome process). The
device reboots and sends a new `hello` with the same `device_id`.
**Then** The old WS handler is still running until aiohttp's heartbeat
(15 s) notices the dead TCP. **GAP** — there's no explicit "close the
older session for this device_id" logic in `ws_view.py`. The new session
starts immediately, so for up to ~15 s **two OpenAI sessions can be
billed in parallel for one physical device.**

Cost / safety guarantees:
- [ ] (Aspirational) Old session is closed proactively when a new `hello`
      with the same `device_id` arrives.
- [ ] Total parallel-session window ≤ 5 s in the happy path.

Proposed fix: track `_active_bridges: dict[device_id, _RealtimeBridge]`
on the view; on new hello with a known `device_id`, cancel the old
bridge's tasks before starting the new one.

How to verify (concrete):
- Log lines: two consecutive `voix WS: device <name> connected from
  <ip>` (`ws_view.py:141`) within the heartbeat window — the gap.
- OpenAI dashboard: two sessions for one device-reboot event during the
  overlap window.

---

## Scenario 10: Realtime tool calls respect Assist exposure

**Given** Two lights:
- `light.kitchen` exposed to Assist (Settings → Voice assistants →
  Expose).
- `light.bedroom_private` **not** exposed.
The integration is up, Realtime mode active.
**When** I say "turn on the kitchen lights." Then "turn on the bedroom
private light."
**Then** Kitchen turns on. Bedroom does not — `_ensure_llm_api` builds
the tool catalog from HA's `assist` LLM API (`ws_view.py:470`), which
only returns exposed entities. The model literally has no `entity_id`
for `light.bedroom_private` in its tool schema. Worst case the model
calls a tool with the unexposed `entity_id` as a guess →
`_llm_api.async_call_tool` raises and we feed back
`{"error": "..."}` (`ws_view.py:505-507`).

Cost / safety guarantees:
- [ ] Unexposed entities cannot be activated by voice, regardless of how
      the user phrases the request.
- [ ] If the model hallucinates an unexposed entity_id, the tool runner
      refuses cleanly (no silent fall-through).

How to verify (concrete):
- Log line: `voix: <N> HA LLM tools exposed to OpenAI`
  (`ws_view.py:490`) — manually count tools, sanity check `<N>` matches
  the # of exposed entities × intents.
- Log line: `voix: OpenAI tool call HassTurnOn({"name": "bedroom
  private"})` followed by `voix: tool ... failed: <error>`
  (`ws_view.py:506`) if the model tried.
- HA state: `light.bedroom_private` unchanged after the second utterance.

---

## Scenario 11: LAN attacker connects to `/api/voix/realtime`

**Given** A second machine on the LAN, no HA auth token, no API access.
The voix integration is up with Realtime mode default.
**When** From the attacker box, open a WS connection to
`ws://<ha>:8123/api/voix/realtime` and send a fake hello
`{"type":"hello","device_id":"evil","friendly_name":"x"}` then start
streaming PCM16 16k audio data (or even just a few KB of garbage bytes).
**Then** **GAP** — `requires_auth = False` (`ws_view.py:81`). The
connection is accepted. On first byte of audio, OpenAI Realtime is
opened (`ws_view.py:534-539`) and the attacker has **forced the HA
admin's OpenAI key to be spent on attacker-supplied audio.** The session
is bounded by `SESSION_HARD_MAX_S = 600 s` but that's still ~$0.30+ per
session per attacker, and the attacker can reconnect freely.

Furthermore, the attacker's "device_id" gets persisted as a discovered
device (`__init__.py:220-233`), polluting the integration's device list.

Cost / safety guarantees (today):
- [x] HA does not route `/api/voix/realtime` externally by default (HA's
      reverse-proxy / cloud config doesn't expose `requires_auth=False`
      endpoints over Nabu Casa).
- [ ] **GAP — no LAN auth.** Any LAN-resident process can spend the user's
      OpenAI budget up to `SESSION_HARD_MAX_S` per session, repeatedly.
- [ ] **GAP — device list pollution.** Any attacker `device_id` becomes a
      persisted device with select / text entities.

Proposed fix:
- Flip `requires_auth = True` and have the firmware send the HA long-lived
  access token in an `Authorization` header at WS upgrade time. Or
- A shared-secret token stored in entry options; firmware sends it in the
  `hello`; mismatch → close.
- Until then, the integration README should set the LAN-only assumption
  loud and clear, and IP-allow-list discovery (`__init__.py:220-233`).

How to verify (concrete):
- From attacker: `wscat -c ws://<ha>:8123/api/voix/realtime` succeeds
  with no token.
- Log line: `voix WS: device evil (x) connected from <attacker-ip>`
  (`ws_view.py:140-143`).
- Log line: `voix WS: first audio chunk (<N> bytes); opening OpenAI
  Realtime` if attacker sends any bytes (`ws_view.py:535-538`).
- OpenAI dashboard: bytes/minutes counter increments under the user's
  bill.
- Entity registry: `select.evil_voix_mode`, `text.evil_voix_dictation`
  appear.

---

## Scenario 12: Transcripts in HA logs

**Given** Dictation mode. Dictate "my social security number is 123-45-
6789, password is hunter2."
**When** The Whisper round-trip completes; the transcript lands on the
bus as `EVENT_DICTATION_CAPTURED` and surfaces on
`text.<device>_voix_dictation`.
**Then** Inspect HA's log file (`/config/home-assistant.log` or
`ha core logs`).

Cost / safety guarantees:
- [ ] At default log level (WARNING / ERROR), the transcript should not
      appear in `home-assistant.log`. **GAP** — `ws_view.py:777` logs
      the transcript at INFO: `voix dictation (%s): %r`. If a user has
      `custom_components.voix: info` (which the test setup recommends!),
      sensitive transcripts go to disk.
- [ ] Realtime mode: transcripts are NOT logged. Model audio is forwarded
      byte-for-byte; only event-type names and short JSON previews land
      in logs (`ws_view.py:641` — preview elides `audio` / `delta`
      fields explicitly, ).

Proposed fix: drop the transcript-payload INFO log to DEBUG, or hash it,
or log only length: `voix dictation (%s): %d chars`. Document the
recommended log level.

How to verify (concrete):
- Set logger to default (no `custom_components.voix:` override). Capture
  transcript. `grep social.*security /config/home-assistant.log` → should
  be empty.
- Set logger to `info`. Repeat. → transcript appears. File this as the
  gap.
- Realtime mode, even at INFO: `grep <unique phrase you said>
  /config/home-assistant.log` → empty (only event types logged).

---

## Scenario 13: Dictation = batch upload, NOT streaming-to-cloud

**Given** Dictation mode. Speak a 10-second sentence then stay silent for
2 s (past `SILENCE_HANG_S = 1.2`).
**When** Tail `tcpdump -i any -w cap.pcap host api.openai.com` while
dictating.
**Then** The mic audio is buffered in `_DictationBridge._buffer` for the
full speech window (`ws_view.py:738`). No bytes hit `api.openai.com`
until `_transcribe` POSTs a single WAV-wrapped multipart upload to
`https://api.openai.com/v1/audio/transcriptions`
(`ws_view.py:809-815`). This means during the 10 s of speech, OpenAI's
servers literally cannot hear you yet — the audio is local until silence
detection fires.

Cost / safety guarantees:
- [ ] **Single HTTPS POST** to OpenAI per dictation, occurring AFTER
      speech ends (not during).
- [ ] No streaming mic-to-cloud in this mode.
- [ ] Hard cap: 60 s max via `HARD_MAX_S = 60.0` (`ws_view.py:708`) —
      even a "stuck on" mic can't drain unbounded.
- [ ] If no speech detected (`_heard_voice == False`), `_transcribe` is
      **skipped** (`ws_view.py:769-772`) — zero bytes to OpenAI.

How to verify (concrete):
- `tcpdump` shows zero packets to `api.openai.com` during the 10 s of
  speaking; one bursty TLS upload starts ~1.2 s after speech ends.
- Log line: `voix dictation: 1.Xs silence after speech; transcribing`
  (`ws_view.py:749-750`).
- HA entity: `text.<device>_voix_dictation` updates exactly once per
  utterance.
- Compute: bytes uploaded ≈ `seconds_spoken × 16000 × 2 + ~100 WAV header
  bytes + multipart overhead`. A 10 s utterance ≈ 320 KB. Way smaller
  than a streaming session's network traffic.

---

## Scenario 14: Assist mode declines cleanly — no OpenAI involvement

**Given** The device's mode select is set to a mode with
`type == MODE_TYPE_ASSIST` (`default-assist` out of the box).
**When** I wake the device and speak.
**Then** The firmware connects to `/api/voix/realtime`, sends `hello`.
The view computes `behavior = "assist"` (`ws_view.py:158`) and skips
both the realtime and dictation branches — it sends
`{"type":"decline","reason":"mode is assist"}` to the device and closes
(`ws_view.py:192-196`). The device's logic is to then NOT stream audio
to voix and let upstream's stock `voice_assistant` own the conversation.

Cost / safety guarantees:
- [ ] OpenAI is never contacted in Assist mode (zero bytes to
      `api.openai.com`; Realtime WS is gated behind realtime/dictation
      branches above).
- [ ] No `_RealtimeBridge` or `_DictationBridge` is instantiated.

How to verify (concrete):
- Log line: `voix WS: dispatching mode_id=default-assist (type=assist)
  for device=<name>` (`ws_view.py:167-170`).
- **Absence** of `voix WS: OpenAI Realtime session opened`.
- Firmware receives `{"type":"decline", ...}` text frame. (Worth
  confirming the firmware actually handles this — `on_ws_text_from_isr`
  currently only sniffs `audio_start`/`audio_end`/`user_speech_*`
  (`voix_realtime_client.cpp:285-296`), and the server-side immediately
  closes the WS after the decline. **Minor GAP**: device sees the close
  but doesn't know it was politely declined.)
- `tcpdump`: zero packets to `api.openai.com`.

---

## Scenario 15: Concurrent independent sessions (Device A Realtime, Device B Dictation)

**Given** Two flashed Voice PE devices on the LAN, both discovered by
voix. Device A's mode select set to `default-realtime`; Device B set to
`default-dictation`. Both have separate `select.<device>_voix_mode` and
`text.<device>_voix_dictation` entities.
**When** I speak a question to Device A ("what's the weather?") and a
dictation to Device B ("note to self: buy milk") at roughly the same
moment.
**Then** Each WS handler runs an independent `_RealtimeBridge` or
`_DictationBridge` instance (one per `get()` invocation —
`ws_view.py:135-202`). The bridges share no state. Logs are interleaved
but each line carries enough context (device IP, `voix WS:` prefix) to
disambiguate.

Cost / safety guarantees:
- [ ] Two distinct OpenAI sessions on the dashboard for the test window
      (one Realtime, one Whisper).
- [ ] No cross-talk: Device B's transcript does not appear on Device A's
      `text` entity, and vice versa.
- [ ] One device's `_last_speech_activity` does not extend the other's
      timeout window.

How to verify (concrete):
- Log lines (interleaved):
  - `voix WS: device A connected from <ip-A>`
    (`ws_view.py:141`).
  - `voix WS: device B connected from <ip-B>` (same line).
  - `voix WS: dispatching mode_id=default-realtime (type=realtime) for
    device=A` and `... dispatching mode_id=default-dictation
    (type=dictation) for device=B` (`ws_view.py:168-170`).
- HA entities: `text.A_voix_dictation` empty after the test (Realtime
  mode doesn't write here); `text.B_voix_dictation` shows "note to self:
  buy milk".
- OpenAI dashboard: exactly two sessions for the window — one Realtime
  audio session and one Whisper transcription request.

---

## Summary of GAPs identified

| # | Gap | Severity | Proposed fix |
|---|-----|----------|--------------|
| 11 | `requires_auth=False` on the WS endpoint — any LAN host can spend the user's OpenAI budget | **HIGH** | Add a shared-secret token in `entry.options`, sent by firmware in `hello`; mismatch → close. Or flip to `requires_auth=True` and send HA long-lived token in WS `Authorization` header. |
| 12 | Dictation transcripts logged at INFO (`ws_view.py:777`) — sensitive content on disk at `custom_components.voix: info` | MEDIUM | Drop to DEBUG, or log `len(transcript)` only. |
| 9 | No "kick old session for same device_id" on reconnect — up to ~15 s of parallel-billed OpenAI sessions per physical device | MEDIUM | Track `_active_bridges[device_id]` on the view; cancel old on new hello. |
| 14 | Firmware doesn't act on server's `decline` text frame — it just sees a WS close | LOW | Sniff `"decline"` in `on_ws_text_from_isr` and emit a distinct trigger / log line for diagnostics. |
| 11b | Attacker-controlled `device_id` is persisted into `entry.options[CONF_DISCOVERED_DEVICES]` permanently | LOW | Gate discovery behind the auth check from gap #11. |
