# Setup — Voice PE satellite

Phase 0/1 — bring the Voice PE online and verify it can talk to Home Assistant.

## Prerequisites

- Home Assistant Voice Preview Edition (Voice PE) hardware.
- Home Assistant running on a reachable local instance (any supported install method).
- Same Wi-Fi network for both. Voice PE doesn't currently support wired networking.
- **HA's `internal_url` must be a directly-reachable URL from the satellite's network.** Set under **Settings → System → Network → URLs → Internal URL**. Use the HA Core address, e.g. `http://192.168.96.15:8123` — not a hostname behind a reverse proxy. The satellite uses this URL to fetch TTS audio and other resources; if it can't reach it, the voice_assistant pipeline stays in a degraded state and the wake-word engine may never start. Lives in `/config/.storage/core.config` (`data.internal_url`); not project-level config.

## Steps

### 1. First-time provisioning

Out of the box, the Voice PE runs the official ESPHome firmware and broadcasts a setup network. Follow the on-screen flow in HA: **Settings → Devices & services → Add integration → Home Assistant Voice PE.** HA discovers the device, joins it to Wi-Fi, and adds it as an ESPHome device.

### 2. Confirm it appears in HA

After onboarding:

- **Settings → Devices & services → ESPHome** should show the Voice PE.
- A satellite entity (`assist_satellite.voice_pe_<id>` or similar) should be present.
- The LED ring should respond to taps and the wake word.

### 3. Note the device identity

Record for later:

- The satellite's hostname or local IP.
- The ESPHome native-API encryption key (noise PSK), under **Settings → Devices & services → ESPHome → Voice PE → Edit → Encryption key.** This is what `custom_components/voix` will use in Phase 3.

### 4. (Optional, recommended) Pin the firmware version

The official Voice PE YAML is at <https://github.com/esphome/home-assistant-voice-pe>. Until we apply our own thin override (see [esphome/voice-pe.yaml](../esphome/voice-pe.yaml)), the device is using the stock build. Note the current firmware version in HA so you can roll back if an upstream change breaks something downstream.

## Verification

- The satellite shows **Available** in HA.
- Tapping the device wakes the LED ring.
- The default wake word (`Okay Nabu`) produces an audible response from HA's default Assist pipeline. If you haven't configured Assist yet, expect a "no pipeline configured" error — that's the next step ([setup-ha-assist.md](setup-ha-assist.md)).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Device doesn't appear in HA discovery | Voice PE and HA on different VLANs/Wi-Fi networks |
| Onboarding stalls at "joining Wi-Fi" | Wrong Wi-Fi password, or 5 GHz-only SSID (Voice PE is 2.4 GHz) |
| LED ring never lights | Hardware fault — factory reset via the device's recessed button |
| Wake word never triggers | Mic muted (check the hardware mute switch), or another satellite is consuming the wake word |

## Next

→ [setup-ha-assist.md](setup-ha-assist.md)
