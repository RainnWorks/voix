# custom_components/voix

A small Home Assistant custom integration that bridges a Voice PE satellite to OpenAI Realtime when a configured wake word fires.

## What it does

When the satellite's ESPHome firmware detects the trigger wake word (default `Hey Mycroft`), it:

1. Fires the HA event `voix.realtime_requested` (and `voice_assistant.stop` to prevent Assist from running).
2. This integration receives the event, opens a fresh `aioesphomeapi.APIClient` to the satellite, and calls `subscribe_voice_assistant`. That claim displaces HA's core ESPHome integration's subscription for the duration of the session.
3. The integration opens a WebSocket to `wss://api.openai.com/v1/realtime` and configures the session for PCM16 audio I/O.
4. Mic audio from the satellite is resampled (16 kHz → 24 kHz) and forwarded as `input_audio_buffer.append`.
5. Realtime's audio deltas are resampled (24 kHz → 16 kHz) and sent back via `send_voice_assistant_audio`. The satellite's stock speaker pipeline renders them.
6. On Realtime session end (silence timeout, explicit stop, or `response.done` with no follow-up), the integration disconnects its API client. The core ESPHome integration auto-reconnects and re-claims the subscription, restoring Mode A / Mode C.

## Status

**Skeleton only.** The lifecycle, event wiring, and config flow are in place. The audio bridge (`_RealtimeSession.start`, `_pump_realtime_to_satellite`, and resampling in `_on_satellite_audio`) is `NotImplementedError` pending Phase 3 implementation work.

## Install (when ready)

```
scp -r ha-integration/custom_components/voix root@<ha-host>:/config/custom_components/
# Restart HA Core (or reload integrations).
```

Then **Settings → Devices & services → Add integration → voix** and provide the satellite host, noise PSK, and OpenAI API key.

## Open questions / TODOs

- Audio resampling: pick a dependency or implement linear-interp in pure Python.
- Confirm exact GA model name for `gpt-realtime` (config default currently `gpt-realtime`; was previously `gpt-4o-realtime-preview`).
- Subscription handoff timing: when our integration calls `subscribe_voice_assistant`, the satellite's audio that fired the wake word is already in flight. Whether we lose the first few hundred ms is empirical.
- Session termination UX: probably "Hey Mycroft" again + a "stop" command, or a Realtime-defined silence timeout.
- Add a `switch.voix_realtime_active` for observability.
