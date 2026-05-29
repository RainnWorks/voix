"""voix HA integration — connector only.

The integration is the bridge between Home Assistant and the voix
backend daemon. It does NOT carry audio: the daemon owns that path
end-to-end via its own WebSocket endpoint. Pucks talk directly to
the daemon; HA's only audio-path job is telling them where to find
it (the adoption push under `_register_voix_adoption`).

What this integration does:
  • Discover voix-capable ESPHome devices (those exposing
    `voix_set_server` / `voix_set_state` api.actions)
  • Push the daemon's URL + a shared auth token to each device
  • Expose per-device entities (mode select, LED ring, sensors,
    buttons, wake-word selects)
  • Register `voix.set_mode` / `voix.cycle_mode` / `voix.update_mode`
    / `voix.create_mode` / `voix.delete_mode` services so HA
    automations and the daemon's ha_sync layer can mutate state
  • Mirror the daemon's mode catalog into entry.options so the
    light entities can render colour and the select entities can
    enumerate choices without a round-trip
"""
from __future__ import annotations

import asyncio
import logging

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from .const import (
    CONF_MODES,
    DEFAULT_ASSIST_WAKE_WORD,
    DEFAULT_VOIX_WAKE_WORD,
    DOMAIN,
    EVENT_MODE_CHANGED,
    MODE_TYPE_REALTIME,
    SERVICE_CREATE_MODE,
    SERVICE_CREATE_VOICE,
    SERVICE_CYCLE_MODE,
    SERVICE_CYCLE_VOICE,
    SERVICE_DELETE_MODE,
    SERVICE_DELETE_VOICE,
    SERVICE_GET_TRANSCRIPT,
    SERVICE_LIST_MODES,
    SERVICE_LIST_VOICES,
    SERVICE_SET_MODE,
    SERVICE_SET_VOICE,
    SERVICE_UPDATE_MODE,
    SERVICE_UPDATE_VOICE,
    TRANSCRIPTS_DIRNAME,
)
from .modes import slugify_mode_id
from .modes import ensure_builtin_modes, get_mode

# Signal dispatched when a new device is discovered via WS hello.
# Per-device entity platforms subscribe and call async_add_entities.
SIGNAL_DEVICE_DISCOVERED = f"{DOMAIN}_device_discovered"
CONF_DISCOVERED_DEVICES = "discovered_devices"

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.LIGHT,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.TEXT,
]

# Dispatcher signal fired by ws_view when a per-device session opens or
# closes. Per-device binary_sensor + button entities subscribe.
SIGNAL_SESSION_STATE_CHANGED = f"{DOMAIN}_session_state_changed"


# ─── M02c: entity_id migration ─────────────────────────────────────────────
@callback
def _migrate_voice_entity_ids(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Rename any `voix_mode_*` / `voix_default_mode` entity_ids under this
    config entry to the canonical `voix_voice_*` / `voix_default_voice`.
    Idempotent: a second run after rename finishes is a no-op.

    unique_ids are NOT touched — HA uses them to track entity identity
    across renames, so changing them would orphan every installed
    light/select. Renaming the entity_id is the user-visible part
    (Devices & Entities, automations) and that's what this does.
    """
    from homeassistant.helpers import entity_registry as er

    registry = er.async_get(hass)
    renamed = 0
    for reg_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        eid = reg_entry.entity_id
        new_eid: str | None = None
        if "voix_mode_" in eid:
            new_eid = eid.replace("voix_mode_", "voix_voice_", 1)
        elif eid.endswith("voix_default_mode"):
            new_eid = eid.replace("voix_default_mode", "voix_default_voice")
        if not new_eid or new_eid == eid:
            continue
        # Avoid clobber if the target somehow already exists (e.g. a half-
        # finished migration on a previous version). Leaving both around
        # is safer than failing the entire migration.
        if registry.async_get(new_eid):
            _LOGGER.debug(
                "voix entity_id migration: skipping %s → %s (target already exists)",
                eid, new_eid,
            )
            continue
        try:
            registry.async_update_entity(eid, new_entity_id=new_eid)
            _LOGGER.warning("voix entity_id migrated: %s → %s", eid, new_eid)
            renamed += 1
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("voix entity_id migration failed for %s: %s", eid, err)
    if renamed:
        _LOGGER.warning(
            "voix: migrated %d entity_id(s) from voix_mode_* to voix_voice_*. "
            "Any HA automations or scripts that reference the old names need "
            "to be updated manually.",
            renamed,
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up voix from a config entry."""
    # Migrate older entries that pre-date WS token auth: generate a token on
    # first load with the new code, surface it loudly in the log so the
    # user can copy it into their device secrets.
    from .const import CONF_WS_TOKEN as _CONF_WS_TOKEN
    if not entry.data.get(_CONF_WS_TOKEN):
        import secrets as _secrets
        new_data = dict(entry.data)
        new_data[_CONF_WS_TOKEN] = _secrets.token_urlsafe(24)
        hass.config_entries.async_update_entry(entry, data=new_data)
        _LOGGER.warning(
            "voix: generated a new WS token for this install — copy into "
            "esphome/secrets.yaml as `voix_ws_token: \"%s\"` and rebuild the "
            "device firmware to enable WS auth.",
            new_data[_CONF_WS_TOKEN],
        )

    # Migration: drop the legacy `default-assist` builtin if it's still in
    # the catalog. The split model uses "Okay Nabu" for stock HA Assist
    # directly, so there's no need for an assist mode in the voix catalog.
    # Users who customized it can re-add a custom assist-typed mode.
    from .const import CONF_MODES as _CONF_MODES
    legacy_modes = (entry.options or {}).get(_CONF_MODES) or {}
    if "default-assist" in legacy_modes:
        cleaned = {k: v for k, v in legacy_modes.items() if k != "default-assist"}
        new_opts = {**(entry.options or {}), _CONF_MODES: cleaned}
        # If the entry was defaulted to assist, switch to realtime.
        if new_opts.get("default_mode") == "default-assist":
            new_opts["default_mode"] = "default-realtime"
        hass.config_entries.async_update_entry(entry, options=new_opts)
        _LOGGER.info(
            "voix: migrated entry — removed legacy default-assist mode "
            "(use Okay Nabu for Assist behaviour)"
        )

    # First-time bootstrap: seed the builtin modes (Dictation / Realtime)
    # into entry options if they're not already there.
    bootstrapped = ensure_builtin_modes(entry.options or {})
    if bootstrapped != (entry.options or {}):
        hass.config_entries.async_update_entry(entry, options=bootstrapped)

    hass.data.setdefault(DOMAIN, {})

    # M02c: one-shot entity_id migration. Renames any existing
    # `*.voix_mode_*` / `select.voix_default_mode` registered against
    # this config entry to the canonical `voix_voice_*` form. Runs
    # BEFORE platforms set up so new entity instances pick up the new
    # entity_id from the registry. Idempotent — a second run is a
    # no-op once everything is renamed.
    _migrate_voice_entity_ids(hass, entry)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register voix.cycle_mode + voix.set_mode services (called by the device's
    # center button and the LED idle-color pusher).
    await _register_services(hass)

    # Push LED color whenever the mode changes. Also do an initial push so the
    # ring shows the restored mode immediately on startup.
    _register_led_pusher(hass, entry)

    # Listen for the Voice PE's center-button event entity. Upstream fires
    # event.button_press_event with event_type=single_press on press; we
    # intercept and cycle the voix mode instead of letting upstream's
    # voice_assistant.start kick off a session.
    _register_button_handler(hass, entry)

    # Set up the auto-discovery callback that the WS view uses on first
    # hello from any device. Devices persist across HA restarts via
    # entry.options['discovered_devices'].
    _register_device_discovery(hass, entry)

    # Push wake-word slot config to every discovered Voice PE when it
    # comes online (and on every voix-wake-word change at the gateway).
    _register_wake_word_pusher(hass, entry)

    # Adopt: push voix config (WS URL + token + current state) to every
    # ESPHome device that exposes the voix actions. Runs on setup AND
    # on each new device that comes online. HA's standard ESPHome
    # adoption flow is the only "adoption" the user goes through;
    # voix piggybacks on it via the device's API actions.
    _register_voix_adoption(hass, entry)

    _LOGGER.info("voix: ready (connector mode — daemon owns the audio path)")
    return True


async def _register_services(hass: HomeAssistant) -> None:
    """Idempotent: register voix.cycle_mode + voix.set_mode once per HA."""
    if hass.services.has_service(DOMAIN, SERVICE_CYCLE_MODE):
        return

    async def _cancel_active_session(device_id: str | None) -> None:
        """Force-close any in-flight voix WS for this device.

        Mode-change semantics: switching mode mid-session is the user's
        explicit "stop what you're doing" signal, so we kill any active
        bridge before flipping the select. Without this, button-cycle
        while a Realtime session was streaming would just leave it
        running until idle/timeout — frustrating.
        """
        if not device_id:
            return
        active = hass.data.get(DOMAIN, {}).get("active_ws") or {}
        ws = active.get(device_id)
        if ws is not None and not ws.closed:
            _LOGGER.info("voix: closing active session for %s before mode change", device_id)
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                _LOGGER.debug("voix: ws.close() raised", exc_info=True)

    async def _cycle(call: ServiceCall) -> None:
        device_id = call.data.get("device_id")
        select = _resolve_select(hass, device_id)
        if select is None:
            _LOGGER.warning("voix.cycle_mode: no mode select entity for device=%s", device_id)
            return
        await _cancel_active_session(device_id or select.device_id)
        await select.async_select_option(select.cycle())

    async def _set(call: ServiceCall) -> None:
        device_id = call.data.get("device_id")
        mode = call.data["mode"]
        select = _resolve_select(hass, device_id)
        if select is None:
            _LOGGER.warning("voix.set_mode: no mode select entity for device=%s", device_id)
            return
        await _cancel_active_session(device_id or select.device_id)
        await select.async_select_option(mode)

    hass.services.async_register(
        DOMAIN,
        SERVICE_CYCLE_MODE,
        _cycle,
        schema=vol.Schema({vol.Optional("device_id"): str}),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_MODE,
        _set,
        schema=vol.Schema(
            # `mode` is a mode_id from entry.options["modes"], not one of the
            # fixed MODE_TYPES. Accept any string; the handler validates the
            # id against the current catalog and logs a warning if unknown.
            {vol.Required("mode"): str, vol.Optional("device_id"): str}
        ),
    )

    # ─── Mode CRUD (used by the Tauri app's mode editor) ────────────────
    # All three mutate entry.options[CONF_MODES] under the only voix entry.
    # Multi-entry installs aren't a real use case — if it ever becomes one,
    # take `entry_id` in the schema and route accordingly.

    def _entry():
        entries = hass.config_entries.async_entries(DOMAIN)
        return entries[0] if entries else None

    async def _create_mode(call: ServiceCall) -> None:
        entry = _entry()
        if entry is None:
            _LOGGER.warning("voix.create_mode: no entry")
            return
        modes = dict((entry.options or {}).get(CONF_MODES) or {})
        name = (call.data["name"] or "").strip() or "Untitled"
        # Generate a unique slug — if the user picks "Realtime" three times
        # we get realtime / realtime-2 / realtime-3 rather than collisions.
        base = slugify_mode_id(name) or "mode"
        mode_id = base
        n = 2
        while mode_id in modes:
            mode_id = f"{base}-{n}"
            n += 1
        modes[mode_id] = {
            "name": name,
            "type": call.data.get("type") or MODE_TYPE_REALTIME,
            "prompt": call.data.get("prompt") or "",
            "voice": call.data.get("voice") or "",
            "model": call.data.get("model") or "",
            "color": list(call.data.get("color") or [3, 169, 244]),
            "brightness": float(call.data.get("brightness") or 0.40),
            "effect": call.data.get("effect") or "None",
            "post_process_prompt": call.data.get("post_process_prompt") or "",
            "post_process_provider": call.data.get("post_process_provider") or "openai",
            "post_process_model": call.data.get("post_process_model") or "gpt-4o-mini",
            "routing_hint": call.data.get("routing_hint") or "",
        }
        new_opts = {**(entry.options or {}), CONF_MODES: modes}
        hass.config_entries.async_update_entry(entry, options=new_opts)
        _LOGGER.info("voix.create_mode: created %s (%s)", mode_id, name)

    async def _update_mode(call: ServiceCall) -> None:
        entry = _entry()
        if entry is None:
            _LOGGER.warning("voix.update_mode: no entry")
            return
        modes = dict((entry.options or {}).get(CONF_MODES) or {})
        mode_id = call.data["mode_id"]
        if mode_id not in modes:
            _LOGGER.warning("voix.update_mode: unknown mode %s", mode_id)
            return
        current = dict(modes[mode_id])
        # Keep this list in sync with mode_def fields (see modes.py +
        # config_flow._mode_form_schema). Missing fields from call.data
        # are left untouched on the existing mode — partial updates are
        # the norm from the desktop app.
        list_fields = {"color", "include_entities", "include_persons"}
        for k in (
            "name", "type", "prompt", "voice", "model",
            "stt_provider", "stt_model",
            "include_entities", "include_persons", "addendum",
            "color", "brightness", "effect",
            "post_process_prompt", "post_process_provider",
            "post_process_model", "routing_hint",
        ):
            if k in call.data and call.data[k] is not None:
                current[k] = (
                    list(call.data[k]) if k in list_fields else call.data[k]
                )
        modes[mode_id] = current
        new_opts = {**(entry.options or {}), CONF_MODES: modes}
        hass.config_entries.async_update_entry(entry, options=new_opts)
        _LOGGER.info("voix.update_mode: %s updated", mode_id)

    async def _delete_mode(call: ServiceCall) -> None:
        entry = _entry()
        if entry is None:
            return
        modes = dict((entry.options or {}).get(CONF_MODES) or {})
        mode_id = call.data["mode_id"]
        if mode_id not in modes:
            return
        if len(modes) <= 1:
            _LOGGER.warning("voix.delete_mode: refusing to delete the last mode")
            return
        del modes[mode_id]
        new_opts = {**(entry.options or {}), CONF_MODES: modes}
        # If the global default pointed at the deleted mode, fall back to
        # whatever remains first in catalog order.
        from .const import CONF_DEFAULT_MODE
        if new_opts.get(CONF_DEFAULT_MODE) == mode_id:
            new_opts[CONF_DEFAULT_MODE] = next(iter(modes))
        hass.config_entries.async_update_entry(entry, options=new_opts)
        _LOGGER.info("voix.delete_mode: removed %s", mode_id)

    _mode_field_schema = vol.Schema({
        vol.Optional("name"): str,
        vol.Optional("type"): str,
        vol.Optional("prompt"): str,
        vol.Optional("voice"): str,
        vol.Optional("model"): str,
        vol.Optional("stt_provider"): str,
        vol.Optional("stt_model"): str,
        vol.Optional("include_entities"): [str],
        vol.Optional("include_persons"): [str],
        vol.Optional("addendum"): str,
        vol.Optional("color"): [int],
        vol.Optional("brightness"): vol.Coerce(float),
        vol.Optional("effect"): str,
        vol.Optional("post_process_prompt"): str,
        vol.Optional("post_process_provider"): str,
        vol.Optional("post_process_model"): str,
        vol.Optional("routing_hint"): str,
    }, extra=vol.ALLOW_EXTRA)

    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_MODE, _create_mode,
        schema=_mode_field_schema.extend({vol.Required("name"): str}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_MODE, _update_mode,
        schema=_mode_field_schema.extend({vol.Required("mode_id"): str}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_DELETE_MODE, _delete_mode,
        schema=vol.Schema({vol.Required("mode_id"): str}),
    )

    # voix.get_transcript — fetch the contents of a transcript file as
    # response data. The filepath comes from a transcript sensor's state.
    # Path is validated to live under <config>/voix/transcripts/ so this
    # service can never be coaxed into reading arbitrary HA files.
    async def _get_transcript(call: ServiceCall) -> ServiceResponse:
        from pathlib import Path

        requested = str(call.data["filepath"])
        base = Path(hass.config.path(TRANSCRIPTS_DIRNAME)).resolve()
        try:
            resolved = Path(requested).resolve()
        except OSError as e:
            raise ServiceValidationError(f"invalid path: {e}") from e
        # Reject anything outside the transcripts dir.
        try:
            resolved.relative_to(base)
        except ValueError:
            raise ServiceValidationError(
                f"filepath must be under {base}: {requested}"
            )

        def _read() -> tuple[str, int]:
            if not resolved.exists():
                raise FileNotFoundError(resolved)
            return resolved.read_text(encoding="utf-8"), resolved.stat().st_mtime_ns

        try:
            content, mtime_ns = await hass.async_add_executor_job(_read)
        except FileNotFoundError as e:
            raise HomeAssistantError(f"transcript file not found: {resolved}") from e

        return {
            "filepath": str(resolved),
            "content": content,
            "char_count": len(content),
            "modified_ns": mtime_ns,
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_TRANSCRIPT,
        _get_transcript,
        schema=vol.Schema({vol.Required("filepath"): str}),
        supports_response=SupportsResponse.ONLY,
    )

    # voix.list_modes — full mode catalog with all fields. The desktop app
    # uses this to populate the mode editor (prompt/voice/model/color/etc).
    # The light entities only expose color/brightness/effect, which is
    # enough for HA's native UI but not for our editor.
    async def _list_modes(_call: ServiceCall) -> ServiceResponse:
        entry = _entry()
        if entry is None:
            return {"modes": []}
        modes = dict((entry.options or {}).get(CONF_MODES) or {})
        # Inflate each entry with its id so the response is array-friendly.
        rows = [
            {"mode_id": mid, **(mdef or {})} for mid, mdef in modes.items()
        ]
        return {"modes": rows}

    hass.services.async_register(
        DOMAIN,
        SERVICE_LIST_MODES,
        _list_modes,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )

    # ─── M02b: voice-vocabulary aliases ────────────────────────────────
    #
    # Same handlers, registered under the canonical "voice" names so
    # the HA UI + automations + the Mac app can use the new vocabulary.
    # The old "mode_*" service names above stay registered for one
    # release as deprecated aliases — drop them once the Tauri app
    # ships the new names and no live automations reference the old.
    #
    # Field naming on the new services: `voice_id` is canonical (the
    # daemon + UI speak it). The `update_voice` + `delete_voice`
    # services accept either `voice_id` (canonical) or `mode_id`
    # (legacy) so the handler doesn't need a second copy.

    # Lightweight stand-in for ServiceCall; the handlers only read
    # call.data, so a duck-typed wrapper with the renamed fields is
    # enough — and it spares us from constructing a real ServiceCall
    # (its constructor signature has drifted across HA versions).
    class _RemappedCall:
        def __init__(self, data: dict) -> None:
            self.data = data

    async def _update_voice(call: ServiceCall) -> None:
        # Translate canonical voice_id back to mode_id internally —
        # entry.options still uses the "modes" key (CONF_MODES) per
        # the M02b scope decision.
        voice_id = call.data.get("voice_id") or call.data.get("mode_id")
        if not voice_id:
            _LOGGER.warning("voix.update_voice: missing voice_id")
            return
        await _update_mode(_RemappedCall({**call.data, "mode_id": voice_id}))

    async def _delete_voice(call: ServiceCall) -> None:
        voice_id = call.data.get("voice_id") or call.data.get("mode_id")
        if not voice_id:
            return
        await _delete_mode(_RemappedCall({**call.data, "mode_id": voice_id}))

    async def _set_voice(call: ServiceCall) -> None:
        # `voice` is the canonical field; accept legacy `mode` too.
        voice = call.data.get("voice") or call.data.get("mode")
        if not voice:
            _LOGGER.warning("voix.set_voice: missing voice")
            return
        await _set(_RemappedCall({**call.data, "mode": voice}))

    async def _list_voices(_call: ServiceCall) -> ServiceResponse:
        entry = _entry()
        if entry is None:
            return {"voices": []}
        modes = dict((entry.options or {}).get(CONF_MODES) or {})
        # Same shape as list_modes but the row id key is "voice_id"
        # and the wrapper key is "voices". Tauri can switch keys
        # without re-deriving fields.
        rows = [
            {"voice_id": mid, **(mdef or {})} for mid, mdef in modes.items()
        ]
        return {"voices": rows}

    # voice schemas mirror the mode ones but key on voice_id and
    # accept both old + new field names (the handlers translate).
    _voice_field_schema = _mode_field_schema

    hass.services.async_register(
        DOMAIN, SERVICE_CYCLE_VOICE, _cycle,
        schema=vol.Schema({vol.Optional("device_id"): str}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_VOICE, _set_voice,
        schema=vol.Schema({
            vol.Required("voice"): str,
            vol.Optional("device_id"): str,
        }),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_VOICE, _create_mode,
        schema=_mode_field_schema.extend({vol.Required("name"): str}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_VOICE, _update_voice,
        schema=_voice_field_schema.extend({vol.Required("voice_id"): str}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_DELETE_VOICE, _delete_voice,
        schema=vol.Schema({vol.Required("voice_id"): str}),
    )
    hass.services.async_register(
        DOMAIN, SERVICE_LIST_VOICES, _list_voices,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )


def _resolve_select(hass: HomeAssistant, device_id: str | None):
    """Resolve the mode select for a device.

    - If `device_id` is specified and matches a known device, return its select.
    - If `device_id` is specified but unknown, return None (no silent fallback —
      callers asked for a specific device).
    - If `device_id` is omitted and there's exactly one device, return that one.
    - Otherwise return None and log a warning.
    """
    selects = hass.data.get(DOMAIN, {}).get("mode_select", {})
    if not selects:
        return None
    if device_id:
        return selects.get(device_id)
    if len(selects) == 1:
        return next(iter(selects.values()))
    _LOGGER.warning(
        "voix services called without device_id but multiple devices present (%d)",
        len(selects),
    )
    return None


def _register_led_pusher(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Push the mode's color to the right device's outer LED ring on mode change.

    Per-device: each event carries device_id; we derive that device's
    `light.<device>_led_ring` entity_id and call light.turn_on on it.
    Animation params come from the active mode definition in
    entry.options[CONF_MODES][mode_id], so users can edit color/brightness/
    effect per mode in the options flow.
    """

    @callback
    def _on_mode_change(event):
        data = event.data or {}
        if data.get("entry_id") != entry.entry_id:
            return
        mode_id = data.get("to")
        device_id = data.get("device_id")
        if not mode_id or not device_id:
            return
        # Always re-resolve the entry — the original closure-captured
        # `entry` goes stale after async_update_entry replaces it, which
        # gave us silently-old mode_defs (and the "off by one" colour).
        current = hass.config_entries.async_get_entry(entry.entry_id)
        if current is None:
            return
        mode_def = get_mode(current, mode_id)
        params = {
            "color": mode_def.get("color", [255, 255, 255]),
            "brightness": mode_def.get("brightness", 0.4),
            "effect": mode_def.get("effect", "None"),
        }
        led_entity = _led_entity_for(device_id)
        hass.async_create_task(
            _push_led_then_refresh(hass, led_entity, params, device_id)
        )

    entry.async_on_unload(
        hass.bus.async_listen(EVENT_MODE_CHANGED, _on_mode_change)
    )

    # Also push LEDs when a mode's color/brightness/effect changes
    # without the active mode_id changing — e.g. the user picks a new
    # swatch for the currently-selected mode in the Mac app. The
    # voix.update_mode service writes to entry.options which fires a
    # config entry update; re-render every currently-active device's
    # outer ring with its current mode's params.
    async def _on_options_update(_hass: HomeAssistant, updated_entry: ConfigEntry):
        if updated_entry.entry_id != entry.entry_id:
            return
        modes = (updated_entry.options or {}).get(CONF_MODES) or {}
        # For every device that has a discovered mode, check if its
        # active mode_def's color/brightness/effect changed and push.
        # The light entities in HA also re-render on their own via the
        # config entry update listener in light.py — we just additionally
        # push to the device's outer ring light so the puck reflects it.
        selects = hass.data.get(DOMAIN, {}).get("mode_select", {})
        for device_id, sel in selects.items():
            mode_id = getattr(sel, "_attr_current_option", None)
            if not mode_id or mode_id not in modes:
                continue
            mode_def = modes[mode_id]
            params = {
                "color": mode_def.get("color", [255, 255, 255]),
                "brightness": mode_def.get("brightness", 0.4),
                "effect": mode_def.get("effect", "None"),
            }
            led_entity = _led_entity_for(device_id)
            hass.async_create_task(
                _push_led_then_refresh(hass, led_entity, params, device_id)
            )

    entry.async_on_unload(entry.add_update_listener(_on_options_update))


def _led_entity_for(device_id: str) -> str:
    """Derive the upstream Voice PE outer-ring light entity_id from device_id."""
    from .util import device_slug
    return f"light.{device_slug(device_id)}_led_ring"


def _register_device_discovery(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register the discovery callback used by the adoption push.

    Called from `_on_service_registered` (when ESPHome exposes a
    voix-capable device's `voix_set_server` action) and from the
    initial push that scans existing services on integration setup.
    Persists the device in entry.options and fires
    SIGNAL_DEVICE_DISCOVERED so the per-device entity platforms (select,
    text) can call async_add_entities. Devices survive HA restarts
    because the platforms read the persisted list on
    async_setup_entry.
    """
    from homeassistant.helpers.dispatcher import async_dispatcher_send

    def register_device(device_id: str, friendly_name: str) -> None:
        if not device_id:
            return
        # Re-resolve the entry on every call. The closure captures `entry`
        # at setup time, but the actual ConfigEntry instance in
        # hass.config_entries may have been replaced (e.g. by an
        # async_update_entry from elsewhere) — calling async_update_entry
        # with a stale reference raises UnknownEntry.
        current = hass.config_entries.async_get_entry(entry.entry_id)
        if current is None:
            _LOGGER.debug(
                "voix: register_device(%s) skipped — entry %s gone",
                device_id, entry.entry_id,
            )
            return
        known: dict = dict(current.options.get(CONF_DISCOVERED_DEVICES, {}))
        if device_id in known:
            return
        known[device_id] = {"friendly_name": friendly_name}
        hass.config_entries.async_update_entry(
            current, options={**current.options, CONF_DISCOVERED_DEVICES: known}
        )
        _LOGGER.info("voix: discovered new device %s (%s)", device_id, friendly_name)
        async_dispatcher_send(
            hass, SIGNAL_DEVICE_DISCOVERED, entry.entry_id, device_id, friendly_name
        )

    hass.data.setdefault(DOMAIN, {})["register_device"] = register_device


def _register_wake_word_pusher(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Apply each device's configured wake-word slots to upstream.

    Per-device: each Voice PE has its own voix wake word + assist wake
    word stored under entry.options['discovered_devices'][device_id].
    On discovery (or HA restart) we push the device's saved values to
    its upstream wake_word / wake_word_2 selects.

    Upstream entities aren't always available immediately on first
    discovery — wait a few seconds before pushing.
    """
    import asyncio as _asyncio
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from .select import _push_wake_word_to_device

    async def _push_for(device_id: str) -> None:
        await _asyncio.sleep(3.0)
        per_dev = (entry.options.get(CONF_DISCOVERED_DEVICES) or {}).get(device_id) or {}
        voix_ww = per_dev.get("voix_wake_word") or DEFAULT_VOIX_WAKE_WORD
        assist_ww = per_dev.get("assist_wake_word") or DEFAULT_ASSIST_WAKE_WORD
        await _push_wake_word_to_device(hass, device_id, "wake_word", assist_ww)
        await _push_wake_word_to_device(hass, device_id, "wake_word_2", voix_ww)
        # Slot 2 (voix wake word) → "preferred". The voix WS bridge cancels
        # upstream voice_assistant on wake-word detection, so this pipeline
        # never actually runs; we just need it set to something benign that
        # isn't one of the legacy voix-* pipelines.
        # Slot 1 (Assist wake word) is user-owned — DO NOT touch it. If we
        # pushed "preferred" here too and HA's preferred pipeline lacked an
        # STT engine (it's a valid HA config), Okay Nabu would red-flash.
        from .select import _push_pipeline_to_device
        await _push_pipeline_to_device(hass, device_id, "assistant_2", "preferred")

    @callback
    def _on_discovered(entry_id: str, device_id: str, friendly_name: str | None):
        if entry_id != entry.entry_id:
            return
        hass.async_create_task(_push_for(device_id))

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_discovered)
    )

    # Push to already-discovered devices on this setup pass too.
    for device_id in (entry.options.get(CONF_DISCOVERED_DEVICES) or {}):
        hass.async_create_task(_push_for(device_id))


def _register_button_handler(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Cycle voix mode on each device's center-button single-press.

    Upstream exposes the button as a HA event entity per device. We subscribe
    one tracker per discovered device — re-subscribing whenever a new device
    arrives so newly-discovered Voice PEs are wired automatically.
    """
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from homeassistant.helpers.event import async_track_state_change_event

    unsub_per_device: dict[str, callable] = {}

    def _subscribe(device_id: str) -> None:
        if device_id in unsub_per_device:
            return
        button_entity = _button_entity_for(device_id)

        @callback
        def _on_state(event):
            new_state = event.data.get("new_state")
            if new_state is None:
                return
            event_type = (new_state.attributes or {}).get("event_type")
            if event_type != "single_press":
                return
            _LOGGER.debug(
                "voix: %s center button single-press → cycle_mode + cancel VA",
                device_id,
            )
            # Cycle the mode select.
            hass.async_create_task(
                hass.services.async_call(
                    DOMAIN, SERVICE_CYCLE_MODE, {"device_id": device_id}, blocking=False
                )
            )
            # Cancel the voice_assistant session that upstream's button
            # binding kicked off on the firmware side. The chime audio
            # already started, but the listen + pipeline won't run.
            from .util import device_slug
            slug = device_slug(device_id)
            hass.async_create_task(
                hass.services.async_call(
                    "esphome", f"{slug}_voix_va_stop", {}, blocking=False
                )
            )

        unsub_per_device[device_id] = async_track_state_change_event(
            hass, [button_entity], _on_state
        )

    # Subscribe for already-discovered devices.
    for device_id in entry.options.get(CONF_DISCOVERED_DEVICES, {}):
        _subscribe(device_id)

    # And for new ones.
    @callback
    def _on_discovered(entry_id: str, device_id: str, friendly_name: str | None):
        if entry_id != entry.entry_id:
            return
        _subscribe(device_id)

    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_DEVICE_DISCOVERED, _on_discovered)
    )

    def _unsub_all() -> None:
        for unsub in unsub_per_device.values():
            unsub()
        unsub_per_device.clear()

    entry.async_on_unload(_unsub_all)


def _button_entity_for(device_id: str) -> str:
    """Derive the upstream button-press event entity_id from device_id."""
    from .util import device_slug
    return f"event.{device_slug(device_id)}_button_press"


# ─── voix adoption (push WS URL/token/state via ESPHome API actions) ─────────

from .const import CONF_WS_TOKEN
from .util import device_slug


def _register_voix_adoption(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Push voix config to ESPHome devices that have the voix actions.

    HA's standard ESPHome adoption flow is the user-facing adoption
    (mDNS discovery → click "Adopt"). Once a device is adopted, the
    ESPHome integration exposes its API actions as HA services named
    `esphome.<device_name>_<action_name>`. We probe for
    `esphome.<device>_voix_set_server` to detect voix-capable devices
    and push the WS URL + shared token. We also push current mode +
    wake-word state via `voix_set_state`.

    Triggers:
      1. On setup, push to every already-known voix-capable device
         (in case HA restarts after devices were adopted).
      2. On device discovery (SIGNAL_DEVICE_DISCOVERED — fired on
         first ESPHome adoption via the upstream device hello).
      3. On EVENT_MODE_CHANGED — push the new mode_type.
      4. On wake-word change — push the new wake word.
    """
    from homeassistant.helpers.dispatcher import async_dispatcher_connect

    def _esphome_svc(device_id: str, action: str) -> str:
        # HA's ESPHome integration registers actions as
        # `esphome.<slug>_<action>` where slug is the device name with
        # hyphens replaced by underscores (standard HA slugification).
        return f"{device_slug(device_id)}_{action}"

    def _voix_capable(device_id: str) -> bool:
        return hass.services.has_service(
            "esphome", _esphome_svc(device_id, "voix_set_server")
        )

    async def _push_server(device_id: str) -> None:
        if not _voix_capable(device_id):
            _LOGGER.debug(
                "voix adoption: %s lacks voix_set_server action — skipping",
                device_id,
            )
            return

        # Pucks talk directly to the voix-backend daemon (running as an
        # HA Add-on or external service). The integration's only job in
        # the audio path is telling the puck where to find the daemon —
        # we do NOT host an in-HA bridge anymore.
        from .const import CONF_DAEMON_URL
        from urllib.parse import urlparse
        daemon_url = (entry.options.get(CONF_DAEMON_URL)
                      or entry.data.get(CONF_DAEMON_URL)
                      or "").strip()
        if not daemon_url:
            _LOGGER.warning(
                "voix adoption: %s — no daemon URL configured. "
                "Set it in voix Options → Defaults so the puck knows "
                "where to connect.",
                device_id,
            )
            return
        # Accept ws://, wss://, http://, https:// — normalise to ws/wss
        # scheme. Append /ws if the user gave a bare host.
        parsed = urlparse(daemon_url)
        scheme = parsed.scheme.lower()
        if scheme in ("http", "ws"):
            scheme = "ws"
        elif scheme in ("https", "wss"):
            scheme = "wss"
        else:
            _LOGGER.warning(
                "voix adoption: %s unsupported daemon URL scheme %r — skipping push",
                device_id, parsed.scheme,
            )
            return
        netloc = parsed.netloc or parsed.path  # bare host falls through to path
        path = parsed.path if parsed.netloc else ""
        if not path or path == "/":
            path = "/ws"
        ws_url = f"{scheme}://{netloc}{path}"
        _LOGGER.info("voix adoption: %s → daemon at %s", device_id, ws_url)
        token = entry.data.get(CONF_WS_TOKEN) or ""
        if not token:
            _LOGGER.warning(
                "voix adoption: no WS token in entry — skipping push to %s",
                device_id,
            )
            return
        try:
            await hass.services.async_call(
                "esphome",
                _esphome_svc(device_id, "voix_set_server"),
                {"url": ws_url, "token": token},
                blocking=False,
            )
            _LOGGER.warning("voix adoption: pushed server config to %s", device_id)
        except Exception as e:  # noqa: BLE001
            _LOGGER.warning(
                "voix adoption: voix_set_server to %s failed: %s", device_id, e
            )

    async def _push_state(device_id: str) -> None:
        if not hass.services.has_service(
            "esphome", _esphome_svc(device_id, "voix_set_state")
        ):
            return
        mode_id = _current_mode_id(hass, device_id) or ""
        current = hass.config_entries.async_get_entry(entry.entry_id)
        if current is None:
            return
        mode_def = get_mode(current, mode_id) if mode_id else {}
        mode_type = mode_def.get("type", "")
        # Resolve the device's voix wake word from the select entity.
        wake_entity = f"select.voix_wake_word_{device_slug(device_id)}"
        st = hass.states.get(wake_entity)
        wake_word = (st.state if st else "") or ""
        try:
            await hass.services.async_call(
                "esphome",
                _esphome_svc(device_id, "voix_set_state"),
                # M08: mode_id pushed alongside mode_type so the puck's
                # next hello carries the canonical voice id. Empty
                # string is a valid value (daemon falls back to default).
                {
                    "mode_type": mode_type,
                    "wake_word": wake_word,
                    "mode_id": mode_id,
                },
                blocking=False,
            )
            _LOGGER.debug(
                "voix adoption: pushed state to %s (mode_type=%s, wake=%s, mode_id=%s)",
                device_id, mode_type, wake_word, mode_id,
            )
        except Exception as e:  # noqa: BLE001
            _LOGGER.debug(
                "voix adoption: voix_set_state to %s failed: %s", device_id, e
            )

    @callback
    def _on_device_discovered(entry_id: str, device_id: str, friendly_name):
        if entry_id != entry.entry_id:
            return
        hass.async_create_task(_push_server(device_id))
        hass.async_create_task(_push_state(device_id))

    @callback
    def _on_mode_changed(event):
        data = event.data or {}
        if data.get("entry_id") != entry.entry_id:
            return
        device_id = data.get("device_id")
        if device_id:
            # Also push server on every mode change — idempotent on the
            # device (early-return guard if value hasn't changed) but
            # guarantees the URL/token get pushed at SOME point, since
            # _initial_push runs before ESPHome services are registered
            # and the service_registered listener can miss the early
            # registrations.
            hass.async_create_task(_push_server(device_id))
            hass.async_create_task(_push_state(device_id))

    @callback
    def _on_wake_word_changed(event):
        # state_changed for select.voix_wake_word_<slug> — extract device_id
        # from the entity_id and re-push state to that device.
        data = event.data or {}
        eid = (data.get("entity_id") or "")
        prefix = "select.voix_wake_word_"
        if not eid.startswith(prefix):
            return
        slug = eid[len(prefix):]
        # device_id (ESPHome name) is the slug with underscores → hyphens.
        # HA slugifies hyphens to underscores in entity_ids; we reverse
        # that here. Best-effort.
        device_id = slug.replace("_", "-")
        hass.async_create_task(_push_state(device_id))

    entry.async_on_unload(
        async_dispatcher_connect(
            hass, SIGNAL_DEVICE_DISCOVERED, _on_device_discovered
        )
    )
    entry.async_on_unload(
        hass.bus.async_listen(EVENT_MODE_CHANGED, _on_mode_changed)
    )
    entry.async_on_unload(
        hass.bus.async_listen("state_changed", _on_wake_word_changed)
    )

    # The ESPHome integration registers device actions as HA services
    # AFTER it connects to the device's native API. That can happen
    # before OR after the voix integration loads. We listen for
    # service_registered events on the bus and push whenever the
    # ESPHome integration newly exposes a voix_set_server for a device.
    # This covers both "HA started and device was already up" and
    # "device came online after HA was running" without us having to
    # poll.
    @callback
    def _on_service_registered(event):
        data = event.data or {}
        if data.get("domain") != "esphome":
            return
        svc = data.get("service") or ""
        if not svc.endswith("_voix_set_server"):
            return
        device_id = svc[: -len("_voix_set_server")]
        # Discovery now happens here. The WS hello used to be the
        # earliest signal a puck was up; with the audio path moved to
        # the daemon, ESPHome registering voix_set_server is the new
        # earliest signal.
        register_device = hass.data.get(DOMAIN, {}).get("register_device")
        if register_device:
            register_device(device_id, device_id)
        hass.async_create_task(_push_server(device_id))
        hass.async_create_task(_push_state(device_id))

    entry.async_on_unload(
        hass.bus.async_listen("service_registered", _on_service_registered)
    )

    # One-shot push at setup. Scans ALL currently-registered services
    # for ones that look like ESPHome voix actions
    # (`esphome.<device>_voix_set_server`), and pushes config to each.
    # Catches the common case where the ESPHome integration loaded
    # first and already registered services before our event listener
    # subscribed (so the service_registered events are already gone).
    async def _diagnose() -> str:
        """One-shot diagnostic of what HA exposes for our device."""
        all_services = hass.services.async_services()
        esphome_services = list(all_services.get("esphome", {}).keys())
        voix_named = [
            f"{d}.{s}"
            for d, svcs in all_services.items()
            for s in svcs
            if "voix" in s.lower()
        ]
        known = (entry.options or {}).get(CONF_DISCOVERED_DEVICES, {}) or {}
        # ESPHome devices may expose API actions through a per-device
        # entity instead of HA services in newer versions. Check the
        # device registry too.
        from homeassistant.helpers import device_registry as dr
        dev_reg = dr.async_get(hass)
        esphome_devices = [
            d.name or d.id
            for d in dev_reg.devices.values()
            if any(i[0] == "esphome" for i in d.identifiers)
        ]
        return (
            f"known={list(known.keys())}\n"
            f"esphome_devices_in_registry={esphome_devices}\n"
            f"esphome_services_total={len(esphome_services)}\n"
            f"esphome_services_sample={esphome_services[:8]}\n"
            f"voix_named_services={voix_named}"
        )

    async def _initial_push():
        msg = await _diagnose()
        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "notification_id": "voix_adoption_debug",
                "title": "voix adoption (initial)",
                "message": msg,
            },
            blocking=False,
        )
        _LOGGER.error("voix adoption diagnostic (initial):\n%s", msg)

        esphome_services = hass.services.async_services().get("esphome", {})
        known = (entry.options or {}).get(CONF_DISCOVERED_DEVICES, {}) or {}
        # Two passes:
        #  1. Push to discovered devices (matches the slugified service
        #     name to the device_id we know).
        for device_id in known:
            if _voix_capable(device_id):
                _LOGGER.warning(
                    "voix adoption: pushing config to known device %s", device_id
                )
                await _push_server(device_id)
                await _push_state(device_id)
        #  2. Catch any voix-capable ESPHome devices we don't have a
        #     device_id record for yet (e.g. they were adopted via the
        #     ESPHome dashboard but haven't opened a voix WS yet). The
        #     service name is `<slug>_voix_set_server`; we use the slug
        #     directly as device_id since hyphen↔underscore conversion
        #     isn't reversible (some user-named devices may genuinely
        #     have underscores in their ESPHome name).
        register_device = hass.data.get(DOMAIN, {}).get("register_device")
        known_slugs = {device_slug(d) for d in known}
        for svc_name in list(esphome_services.keys()):
            if not svc_name.endswith("_voix_set_server"):
                continue
            slug = svc_name[: -len("_voix_set_server")]
            # Discover the device so per-device entities get created.
            if register_device:
                register_device(slug, slug)
            if slug in known_slugs:
                continue  # handled in pass 1
            _LOGGER.info(
                "voix adoption: orphan voix-capable service esphome.%s "
                "(no matching known device — pushing with slug as device_id)",
                svc_name,
            )
            await _push_server(slug)
            await _push_state(slug)

    hass.async_create_task(_initial_push())

    async def _delayed_recheck():
        await asyncio.sleep(30)
        msg = await _diagnose()
        await hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "notification_id": "voix_adoption_debug_30s",
                "title": "voix adoption (+30s)",
                "message": msg,
            },
            blocking=False,
        )
        _LOGGER.error("voix adoption diagnostic (+30s):\n%s", msg)

    hass.async_create_task(_delayed_recheck())


def _current_mode_id(hass: HomeAssistant, device_id: str) -> str | None:
    """Read the per-device select.voix_mode_<slug> state, returning the mode_id."""
    from .util import device_slug as _slug
    entity_id = f"select.voix_mode_{_slug(device_id)}"
    st = hass.states.get(entity_id)
    return st.state if st else None


async def _push_led(hass: HomeAssistant, led_entity: str, params: dict) -> None:
    """Issue light.turn_on with the per-mode color/brightness/effect."""
    if not led_entity:
        return
    r, g, b = params["color"]
    service_data = {
        "entity_id": led_entity,
        "rgb_color": [int(r), int(g), int(b)],
        "brightness_pct": int(params["brightness"] * 100),
    }
    effect = params.get("effect")
    if effect and effect.lower() != "none":
        service_data["effect"] = effect
    try:
        await hass.services.async_call(
            "light", "turn_on", service_data, blocking=False
        )
    except Exception:  # noqa: BLE001
        _LOGGER.exception("voix: failed to push mode color to %s", led_entity)


async def _push_led_then_refresh(
    hass: HomeAssistant, led_entity: str, params: dict, device_id: str
) -> None:
    """Push the new mode colour, then tell the device to re-render LEDs.

    The light.turn_on call updates the device's outer-ring light state.
    The `voix_refresh` ESPHome action then re-runs `control_leds` on the
    device, which reads the now-correct light state and updates the
    physical LEDs in one frame. Without the explicit refresh, the device
    keeps showing the previous mode's colour until the next press/event.
    """
    await _push_led(hass, led_entity, params)
    # ESPHome exposes api.actions as `esphome.<device_name>_<action_name>`.
    # device_id is the ESPHome `esphome.name`, so the service name is
    # constructed directly.
    service_name = f"{device_id}_voix_refresh"
    try:
        await hass.services.async_call(
            "esphome", service_name, {}, blocking=False
        )
    except Exception as e:  # noqa: BLE001
        # Most likely cause: firmware doesn't have the `voix_refresh`
        # action yet (older build). Log at debug — the colour push above
        # already happened; the device will just be one tick behind
        # until the next state change.
        _LOGGER.debug(
            "voix: refresh action call failed for %s (%s)", device_id, e
        )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
