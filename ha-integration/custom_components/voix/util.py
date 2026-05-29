"""Small shared helpers for the voix integration."""
from __future__ import annotations

import re

from .const import GATEWAY_DEVICE_ID


def gateway_device_info(domain: str) -> dict:
    """Device-registry payload for the virtual 'voix gateway' device.

    All global entities (voice select, idle timeout, default mode) attach
    to this so the user sees them grouped under one device in HA's UI
    instead of orphan-floating in the integration's entity list.
    """
    return {
        "identifiers": {(domain, GATEWAY_DEVICE_ID)},
        "name": "voix gateway",
        "manufacturer": "voix",
        "model": "Integration gateway",
        "entry_type": "service",
    }


def device_slug(device_id: str) -> str:
    """Convert an ESPHome device name to its HA entity_id slug component.

    ESPHome auto-generates HA entity_ids using this same rule: lowercase,
    non-alphanumeric → underscore, trim leading/trailing underscores. So
    `home-assistant-voice-095e4e` becomes `home_assistant_voice_095e4e`,
    matching upstream's `light.home_assistant_voice_095e4e_led_ring` etc.

    This is the single source of truth for the slug — `select.py`, `text.py`,
    and the LED/button entity-id lookups all import from here. Keep them
    aligned to avoid a stale-entity-id drift bug.
    """
    return re.sub(r"[^a-z0-9]+", "_", device_id.lower()).strip("_")
