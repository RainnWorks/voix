# esphome/

Thin override for the Home Assistant Voice PE satellite.

## What's here

- [`voice-pe.yaml`](voice-pe.yaml) — A wrapper that pulls the official Voice PE YAML in as an ESPHome remote package and adds project-specific deltas (the dictation `on_stt_end` hook; the Realtime button handler in Phase 3).

## Why a wrapper, not a fork

ESPHome's `packages:` mechanism supports remote git references and non-destructive merging. We can pin to an upstream `ref:` and add only what we need on top. Upstream firmware improvements land for free by bumping the ref. We never own the base configuration. See [`../docs/adr/0001-hybrid-orchestration.md`](../docs/adr/0001-hybrid-orchestration.md).

## How to install

1. In Home Assistant, open the **ESPHome dashboard** (Settings → Add-ons → ESPHome Builder, or the ESPHome integration's "Open web UI" link).
2. **Adopt** the Voice PE if it's currently using the auto-onboarded config.
3. Replace the device's YAML with the contents of [`voice-pe.yaml`](voice-pe.yaml).
4. Install via OTA.

## Updating

Bump the `ref:` in [`voice-pe.yaml`](voice-pe.yaml) and re-install. Pin to a specific commit/tag once Phase 1 verification passes.

## Status

The `on_stt_end` override matches the validated upstream YAML structure (top-level `voice_assistant:` block, `on_stt_end` not currently set upstream). One thing to re-check whenever you bump the `ref:`: if a future upstream release sets its own `on_stt_end`, our value will replace it (list-valued keys aren't merged across packages). See the comment block in [`voice-pe.yaml`](voice-pe.yaml).

