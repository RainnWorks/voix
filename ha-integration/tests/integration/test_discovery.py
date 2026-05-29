"""Integration tests for device auto-discovery.

The WS view calls `hass.data[DOMAIN]["register_device"](device_id,
friendly_name)` on first hello. That callback:

  1. Adds the device to entry.options["discovered_devices"] if not seen.
  2. Persists via async_update_entry.
  3. Dispatches SIGNAL_DEVICE_DISCOVERED.

The per-device entity platforms (select, text) subscribe to that signal
and create their entities. After this round-trip the device should have
its select + text in the registry, and entry.options must hold it for
HA-restart survival.
"""
from __future__ import annotations

from typing import Any

import pytest

from custom_components.voix import (
    CONF_DISCOVERED_DEVICES,
    SIGNAL_DEVICE_DISCOVERED,
)
from custom_components.voix.const import DOMAIN

pytestmark = pytest.mark.enable_custom_integrations

DEVICE_ID = "home-assistant-voice-095e4e"
EXPECTED_SELECT = "select.voix_mode_home_assistant_voice_095e4e"
EXPECTED_TEXT = "text.voix_dictation_home_assistant_voice_095e4e"


async def test_register_device_persists_into_options(
    hass: Any, mock_config_entry
) -> None:
    """Given an entry with no devices, When register_device is called, Then options[discovered_devices] grows."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    register = hass.data[DOMAIN]["register_device"]
    assert mock_config_entry.options.get(CONF_DISCOVERED_DEVICES, {}) == {}

    register(DEVICE_ID, "Kitchen")
    await hass.async_block_till_done()

    devices = mock_config_entry.options[CONF_DISCOVERED_DEVICES]
    assert DEVICE_ID in devices
    assert devices[DEVICE_ID]["friendly_name"] == "Kitchen"


async def test_register_device_dispatches_signal(
    hass: Any, mock_config_entry
) -> None:
    """Given the discovery signal is being listened to, When register_device fires, Then subscribers receive (entry_id, device_id, friendly_name)."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    from homeassistant.helpers.dispatcher import async_dispatcher_connect

    received: list[tuple] = []

    def _on_signal(entry_id, device_id, friendly_name):
        received.append((entry_id, device_id, friendly_name))

    unsub = async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_signal)
    try:
        register = hass.data[DOMAIN]["register_device"]
        register(DEVICE_ID, "Kitchen")
        await hass.async_block_till_done()
    finally:
        unsub()

    assert received == [(mock_config_entry.entry_id, DEVICE_ID, "Kitchen")]


async def test_register_device_creates_select_and_text_entities(
    hass: Any, mock_config_entry
) -> None:
    """Given a fresh entry, When a device registers, Then a select + text entity show up in states."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get(EXPECTED_SELECT) is None
    assert hass.states.get(EXPECTED_TEXT) is None

    register = hass.data[DOMAIN]["register_device"]
    register(DEVICE_ID, "Kitchen")
    await hass.async_block_till_done()

    assert hass.states.get(EXPECTED_SELECT) is not None
    assert hass.states.get(EXPECTED_TEXT) is not None


async def test_register_device_is_idempotent(
    hass: Any, mock_config_entry
) -> None:
    """Given a device already discovered, When register_device runs again, Then options are unchanged and signal does not refire."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    register = hass.data[DOMAIN]["register_device"]
    register(DEVICE_ID, "Kitchen")
    await hass.async_block_till_done()
    snapshot = dict(mock_config_entry.options[CONF_DISCOVERED_DEVICES])

    from homeassistant.helpers.dispatcher import async_dispatcher_connect

    refire = []
    unsub = async_dispatcher_connect(
        hass,
        SIGNAL_DEVICE_DISCOVERED,
        lambda *a: refire.append(a),
    )
    try:
        register(DEVICE_ID, "Kitchen")  # same device, second time
        await hass.async_block_till_done()
    finally:
        unsub()

    assert mock_config_entry.options[CONF_DISCOVERED_DEVICES] == snapshot
    assert refire == []


async def test_register_device_with_empty_id_is_noop(
    hass: Any, mock_config_entry
) -> None:
    """Given an empty device_id, When register_device runs, Then options are not changed."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    register = hass.data[DOMAIN]["register_device"]
    register("", "X")
    await hass.async_block_till_done()
    assert mock_config_entry.options.get(CONF_DISCOVERED_DEVICES, {}) == {}


async def test_devices_persisted_in_options_recreate_entities_on_setup(
    hass: Any, mock_config_entry
) -> None:
    """Given discovered_devices is pre-populated in options, When the entry sets up, Then entities exist without any signal fired."""
    mock_config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        mock_config_entry,
        options={
            **mock_config_entry.options,
            CONF_DISCOVERED_DEVICES: {DEVICE_ID: {"friendly_name": "Kitchen"}},
        },
    )
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()

    assert hass.states.get(EXPECTED_SELECT) is not None
    assert hass.states.get(EXPECTED_TEXT) is not None
