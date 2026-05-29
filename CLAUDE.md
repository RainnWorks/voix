# voix project — Claude session guide

This project ships **three coupled pieces** that have to be debugged
together: the ESPHome firmware on the Voice PE, the Home Assistant
custom integration, and the Tauri desktop app. Most "what just broke"
investigations land somewhere on the device → HA bridge → OpenAI path.
The workflow below is honed from many sessions of chasing that path.

## Hosts and paths

- **HA host (HAOS, Yellow)**: `root@192.168.96.15`. SSH already
  authorised. Integration lives at `/config/custom_components/voix/`.
- **Voice PE device**: `192.168.120.218` (DHCP — may drift; resolve via
  `ssh root@192.168.96.15 "getent hosts home-assistant-voice-095e4e.local"`).
- **Tauri app**: `/Users/tom/Projects/voix/app`. Run with `npm run dev`
  from that dir.
- **ESPHome YAML**: `esphome/home-assistant-voice-095e4e.yaml` (device
  config) imports `esphome/voix-package.yaml` (reusable voix bits).
  Custom component at `esphome/components/voix_realtime_client/`.

## Log capture

### Device-side (ESPHome over native API)

The firmware streams logs to `/tmp/voix-device.log` via a single
backgrounded `esphome logs` process. If you find multiple processes
streaming to the same file, kill them and start ONE:

```
pkill -f "esphome logs esphome/home-assistant-voice-095e4e"
> /tmp/voix-device.log   # truncate stale content
export PATH="$HOME/Library/Python/3.14/bin:$PATH"
esphome logs esphome/home-assistant-voice-095e4e.yaml --device 192.168.120.218 2>&1 | tee /tmp/voix-device.log
```

Run that in the background with `run_in_background: true`. Multiple
concurrent log streams will scramble the file — each writes interleaved
chunks. Check duplicates first:

```
pgrep -fl "esphome logs esphome/home-assistant-voice-095e4e"
```

### HA-side

HA Core uses a small ring buffer for `ha core logs` (~100 lines).
Anything older has rolled off:

```
ssh root@192.168.96.15 'ha core logs --no-progress 2>&1 | grep -iE "voix" | tail -25'
```

Two big quirks to know:
1. **100-line cap** — voix's startup logs may be gone by the time you
   look. Mitigate by filtering aggressively (grep for `voix`) and by
   reading right after a restart.
2. **Default log level is WARN** on this HA install (per
   `/config/configuration.yaml`'s `logger.default`). Use
   `_LOGGER.warning(...)` from voix code so logs survive. INFO and
   DEBUG won't appear without an explicit `logger.logs` entry, which we
   don't want to modify in the user's config.

### Debug visibility when `ha core logs` isn't enough

When the 100-line buffer keeps rolling past what you need, use
`persistent_notification.create` from inside the integration. Notifications
show up in HA's UI immediately and stay until dismissed:

```python
await hass.services.async_call(
    "persistent_notification",
    "create",
    {
        "notification_id": "voix_debug_X",
        "title": "voix debug",
        "message": f"key data: ...",
    },
    blocking=False,
)
```

Used during the adoption refactor to confirm what services were
registered and when — invaluable when the log buffer was too noisy.

## Live monitoring with the Monitor tool

When waiting on a wake-word session or a specific event, use the
Monitor tool (not Bash polling). Each stdout line of the command
becomes a notification you receive while you keep working on other
things.

### When to use Monitor vs Bash run_in_background

- **One notification, exit cleanly** (e.g. "tell me when HA is up"):
  use Bash with `run_in_background: true` and a command that exits
  when the condition is true (`until curl ... ; do sleep 5; done`).
- **Many notifications over a period, until a known end** (e.g.
  "stream wake-word session events"): Monitor with a `tail -f` filter.
- **Indefinite, session-length** (e.g. continuously watch for errors):
  Monitor with `persistent: true`.

### Calling Monitor

The minimum useful invocation:

```
Monitor:
  description: "device: dictation test"      # short, shown in notifications
  timeout_ms: 180000                         # 3 min; max 60 min
  persistent: false                          # one-shot
  command: |
    tail -f /tmp/voix-device.log \
      | grep --line-buffered -E "PATTERN_A|PATTERN_B|PATTERN_C"
```

`grep --line-buffered` is non-negotiable — without it, the pipeline
buffers output and notifications stall for minutes.

### Coverage rule (read this even if you skim the rest)

Every Monitor watching for a "ready" signal also needs to cover
**failure signatures**, otherwise silence looks identical to success.
Example for a wake-word session:

```
tail -f /tmp/voix-device.log | grep --line-buffered -E \
  "ws CONNECTED|TEARDOWN|Memory exhausted|errno=11|first audio.delta"
```

Positive signal (`ws CONNECTED`, `first audio.delta`) AND every
failure mode we've seen so far (`TEARDOWN`, `Memory exhausted`,
`errno=11`). If a new failure surfaces with a signature not in your
regex, you'll see the monitor time out instead of the real error —
widen the regex when in doubt.

### Practical recipes

**Wait for a fresh wake-word session and watch its lifecycle**

```
tail -f /tmp/voix-device.log | grep --line-buffered -E \
  "handing off to voix|ws CONNECTED|first audio.delta|TEARDOWN|Memory exhausted|errno=11"
```

**Watch for echo-gate decisions during a realtime session** (HA side)

This needs a different log source — HA logs aren't streaming to a
local file. The pragmatic approach: run a long `tail -f` over SSH
via Monitor:

```
ssh root@192.168.96.15 'tail -f /config/home-assistant.log 2>/dev/null' \
  | grep --line-buffered -E "mic gate forward|TEARDOWN"
```

(That file may not exist depending on HA's `logger:` config. Fall
back to repeated `ha core logs` polls if so.)

**Confirm a deployment landed** (boot banner appears)

```
tail -f /tmp/voix-device.log | grep --line-buffered -E \
  "compiled on YYYY-MM-DD HH:MM|esp_websocket_client_init failed|ws client pre-allocated"
```

### Gotchas

- `tail -f` emits the FILE'S LAST LINE on attach. Treat the first
  event as suspect — verify the timestamp looks recent before
  reacting.
- The 200ms batching means multiline output from a single event
  groups into one notification — that's fine, just don't expect
  precise line-by-line cadence.
- A monitor that produces too many events gets auto-stopped. Narrow
  the regex aggressively. The stats lines (`voix_realtime_client:
  stats: mic=...`) print every 2s during a session and will flood
  if you let them through.

### When the monitor times out without firing

That usually means one of:
1. The event happened but didn't match your regex — re-grep the log
   for the time window directly: `grep -E "17:3[0-9]" /tmp/voix-device.log`
2. The user didn't trigger the action you were waiting for. Ask.
3. The log stream itself died. Check with
   `pgrep -fl "esphome logs esphome/home-assistant-voice-095e4e"`.

### Useful grep patterns for the device log

- **Wake-word activation flow**: `handing off to voix|start: connecting|ws CONNECTED|first audio.delta`
- **WS failures**: `Memory exhausted|errno=11|EAGAIN|TEARDOWN|reasm`
- **Adoption / state push**: `server_url set|state synced|voix:`
- **Audio throughput stats** (every ~2s):
  `voix_realtime_client:.*stats: mic=.*ws_rx=.*spk=`
- **Speaker rate / first play** (catches the 2× speed bug):
  `first play: chunk=|speaker forced|was 24000 Hz|was 48000 Hz`

### Useful grep patterns for HA logs

- **Bridge lifecycle**: `voix dictation|voix WS:|session closed after`
- **OpenAI events** (high volume — narrow):
  `voix WS: openai (response\.done|conversation\.|error)`
- **Echo gate decisions**: `mic gate forward`
- **Adoption pushes**: `voix adoption`

### Coverage rule

Every monitor watching for a "ready" signal also needs to cover
**failure signatures**, otherwise silence looks identical to success.
Example for a wake-word session:

```
grep --line-buffered -E "ws CONNECTED|TEARDOWN|Memory exhausted|errno=11|first audio.delta"
```

Includes the positive signal (`ws CONNECTED`, `first audio.delta`)
AND the failure modes we've seen before.

## Deploying changes

### Firmware (Voice PE)

The local build path bypasses HA's ESPHome dashboard for speed:

```
export PATH="$HOME/Library/Python/3.14/bin:$PATH"
esphome compile esphome/home-assistant-voice-095e4e.yaml
esphome upload esphome/home-assistant-voice-095e4e.yaml --device 192.168.120.218
```

`scripts/build-local.sh upload` wraps these and has an **mtime guard**
that refuses to upload if `firmware.bin` wasn't actually rebuilt — a
guard worth keeping because we hit silent stale-binary uploads multiple
times early on. If the mtime guard trips when you know the source
changed, run `esphome compile` and `esphome upload` directly.

### HA integration

scp the changed files to `/config/custom_components/voix/`, then
restart HA core. `ha core restart` returns immediately while the
actual restart runs in background — wait for HA to come back up
before checking logs:

```
scp ha-integration/custom_components/voix/__init__.py \
    root@192.168.96.15:/config/custom_components/voix/__init__.py
ssh root@192.168.96.15 'ha core restart' &
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
    "http://192.168.96.15:8123/api/voix/realtime" -X POST 2>/dev/null)
  [[ "$code" == "405" ]] && { echo "voix loaded"; break; }
  sleep 5
done
```

The `405 Method Not Allowed` response from POST'ing to
`/api/voix/realtime` is a reliable "voix integration loaded" signal
(the endpoint exists, it just rejects non-WS-upgrade requests).

**Important**: when scp'ing into `/config/custom_components/voix/`,
note that `translations/en.json` lives in a subdirectory. A bulk scp
that mixes top-level and translations files in one call will collapse
the latter to the wrong path. Use two scp commands or a recursive
rsync.

### Tauri app

`npm run dev` starts the watcher; Rust source changes auto-rebuild
and relaunch. **JS/HTML changes do NOT auto-reload the webview** —
either close+reopen the window or hard-reload from devtools.

If the dev process exited (look for the `task-notification` saying
the background command completed), restart it.

## Validating that the right firmware is running

ESPHome OTA uses local cache. If the source changed but `esphome
compile` was a no-op (cached), `upload` will flash the previous binary.
After deploy:

```
# Confirm the OTA actually shipped what you compiled
strings /Users/tom/Projects/voix/esphome/.esphome/build/home-assistant-voice-095e4e/.pioenvs/home-assistant-voice-095e4e/firmware.bin \
  | grep "your new log message"

# Confirm device booted onto it (check the version banner timestamp)
grep "compiled on" /tmp/voix-device.log | tail -3
```

The build banner format is `ESPHome version X.Y.Z compiled on
YYYY-MM-DD HH:MM:SS +TZ` — compare to the build time printed by
`esphome compile`'s final `INFO Build Info` line.

## Common failure modes we've hit

- **`esp_websocket_client_init(893): Memory exhausted`** at wake-word
  time. Internal SRAM is fragmented (~31 KB largest contiguous). Fix:
  pre-allocate ws client at boot, drop recv buffer to 4 KB, re-assemble
  fragmented frames in PSRAM. See `voix_realtime_client::init_ws_client_`.
- **`errno=11` (EAGAIN) on `esp_transport_write`** mid-session,
  followed by WS DISCONNECTED. The WS task is too busy reading inbound
  to drain outbound mic. Fix: batch mic chunks to ~2 KB before send;
  pre-allocate the reassembly buffer so the WS task doesn't malloc per
  frame.
- **First response of a session plays at 2× speed**. The chime
  re-configures `announcement_resampling_speaker` to 48 kHz right as
  voix starts playing 24 kHz audio. Fix: defer-rate-set until
  `is_running() == false`, plus speaker.stop in the wake-word
  dispatch handler.
- **`Conversation already has an active response`** (OpenAI). Echo
  loop: model audio bleeds back to mic, semantic_vad fires, creates a
  new turn while the previous one is in progress. Fix: energy-based
  echo gate on HA side (drops mic chunks whose RMS is consistent with
  predicted echo level).
- **`unknown mode default_realtime`** when calling `voix.update_mode`.
  HA slugifies entity_ids (hyphens → underscores) but mode_ids in
  `entry.options[modes]` keep hyphens. The Mac app was deriving
  mode_ids from light entity slugs. Fix: use the
  `voix.list_modes` service (returns canonical mode_ids).

## Architectural notes worth knowing

- **Audio sample rates**: device mic = 16 kHz mono PCM16. OpenAI
  realtime API requires ≥ 24 kHz, so the STT backend upsamples
  16 → 24 kHz with audioop.ratecv (state threaded across send_audio
  calls for waveform continuity).
- **HA → device adoption**: WS URL + token + mode/wake-word state push
  via ESPHome `api.actions` (`voix_set_server`, `voix_set_state`). HA
  finds devices by scanning `hass.services.async_services()["esphome"]`
  for `<slug>_voix_set_server` entries. **Important**: at integration
  setup, ESPHome services may not be registered yet (different load
  order). The fallback is to also push from `EVENT_MODE_CHANGED` —
  Tom's mode-cycle press triggers it.
- **Transcripts go to files**, not entity attributes. HA's 16 KB
  attribute cap broke dictation > a few hundred words. Layout:
  `/config/voix/transcripts/<device_slug>/<session_id>-<role>.txt`.
  Read via the `voix.get_transcript` service.

## Don't do

- Don't add `_LOGGER.info(...)` for important diagnostics — use
  `.warning(...)` because of HA's default WARN log level here.
- Don't trust `esphome upload` if `esphome compile` printed
  "Successfully compiled" without any "Compiling" lines — it cached.
  Look at the build_time_str on the OTA'd device to confirm.
- Don't scrape HA's `/config/.storage/auth` for tokens. The classifier
  catches this and it's the right call — request access if you need
  authenticated REST access.
- Don't pkill broadly. We've accumulated stale log streams; kill
  by specific pattern (`pkill -f "esphome logs esphome/home-assistant-voice-095e4e"`)
  not by command name.
