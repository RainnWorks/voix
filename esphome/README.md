# esphome/

A reusable ESPHome package that adds the voix project's Mode B (Realtime trigger) and Mode C (dictation→helper) deltas on top of the official `esphome/home-assistant-voice-pe` config.

## What's here

| File | Purpose |
|---|---|
| [`voice-pe.yaml`](voice-pe.yaml) | The reusable package. Pulls upstream as a sub-package and adds wake-word capture, the realtime event firing, and the `on_stt_end` → `input_text` write. Configurable via substitutions; carries no device-specific secrets. |
| [`example-consumer.yaml`](example-consumer.yaml) | A minimal template a downstream user drops into `/config/esphome/<device>.yaml`. Customises substitutions (if any) and provides the per-device encryption key + WiFi creds. |

## Why a wrapper, not a fork

ESPHome's `packages:` mechanism supports remote git references and non-destructive dictionary merging. Our package pins to an upstream `ref:` and adds only deltas. Upstream firmware improvements land for free when we (or a consumer) bumps the ref. Consumers pin our package the same way, so they get our updates too. See [`../docs/adr/0001-hybrid-orchestration.md`](../docs/adr/0001-hybrid-orchestration.md).

## Package surface (substitutions)

All optional; defaults match the project's setup docs.

| Substitution | Default | Purpose |
|---|---|---|
| `voix_dictation_wake_word` | `"Hey Jarvis"` | Wake word whose runs write to the dictation helper. |
| `voix_realtime_wake_word` | `"Hey Mycroft"` | Wake word that fires the realtime event. |
| `voix_dictation_helper` | `input_text.voix_dictation_buffer` | HA entity to receive transcripts. |
| `voix_realtime_event` | `voix.realtime_requested` | HA event the custom integration listens to. |
| `voix_voice_pe_ref` | `26.4.0` | Pinned upstream firmware tag. |
| `voix_voice_pe_refresh` | `1d` | How often the dashboard refetches upstream. |

## Install

Copy `example-consumer.yaml` to `/config/esphome/<your-device>.yaml`, customise the four marked spots, and compile/install via the ESPHome dashboard.

Encryption key, WiFi credentials, and the specific MAC-suffixed secret name all stay in the consumer YAML — the package itself is reusable across deployments.

## Updating

Bump `voix_voice_pe_ref` in your consumer YAML and re-install. The `refresh:` setting also pulls upstream changes within `voix_voice_pe_refresh` of every compile.

## Status

The `on_stt_end` and `on_wake_word_detected` overrides match the validated upstream YAML structure (top-level `voice_assistant:` block, neither key set upstream — both safe to add additively). Re-check whenever you bump `voix_voice_pe_ref`: if a future upstream release sets either trigger itself, our actions will replace upstream's rather than concatenate (list-valued top-level keys don't merge across packages).

