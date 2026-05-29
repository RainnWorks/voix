"""Config flow for voix.

Initial setup captures the OpenAI key only — the rest is editable via the
Options flow:

  - Defaults:        OpenAI key, dictation helper, default mode
  - Modes:           CRUD on the global mode catalog (each mode = name +
                     behavior type + prompt + voice + model + LED color)
  - Prompt context:  always-included entities/people + freeform addendum
                     appended to every mode's prompt

The system prompt supports HA Jinja: `{{ states('light.kitchen') }}`,
`{{ now() }}`, `{{ area_name(entity_id) }}`.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry, OptionsFlow
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    CONF_DEFAULT_MODE,
    CONF_IDLE_TIMEOUT_S,
    CONF_MODES,
    CONF_DAEMON_URL,
    CONF_OPENAI_API_KEY,
    CONF_OPENROUTER_API_KEY,
    CONF_WS_TOKEN,
    DEFAULT_IDLE_TIMEOUT_S,
    DEFAULT_REALTIME_INSTRUCTIONS,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_REALTIME_VOICE,
    DOMAIN,
    MODE_TYPES,
)
from .stt import DEFAULT_STT_PROVIDER, STT_PROVIDERS
from .modes import (
    ensure_builtin_modes,
    get_modes,
    slugify_mode_id,
    validate_mode_def,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _to_hex(rgb: list[int]) -> str:
    try:
        r, g, b = (max(0, min(255, int(x))) for x in rgb)
        return f"#{r:02x}{g:02x}{b:02x}"
    except (TypeError, ValueError):
        return "#000000"


def _parse_hex(s: str) -> list[int] | None:
    if not s:
        return None
    s = s.strip().lstrip("#")
    if len(s) != 6:
        return None
    try:
        return [int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)]
    except ValueError:
        return None


def _csv_to_list(s: str) -> list[str]:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


# ─── Config flow (initial setup) ─────────────────────────────────────────────


class VoixConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Minimal initial setup. The interesting config is in the options flow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()
            # Generate a random WS token at first install. Stored in entry.data
            # (not options) so it survives options-flow edits. The user copies
            # this into their device's ESPHome secrets file under
            # `voix_ws_token` so the firmware can send it in its hello.
            import secrets as _secrets
            user_input[CONF_WS_TOKEN] = _secrets.token_urlsafe(24)
            # Seed built-in modes into options on first install so the user
            # has something to work with immediately.
            options = ensure_builtin_modes({})
            return self.async_create_entry(
                title="voix", data=user_input, options=options
            )

        schema = vol.Schema(
            {
                vol.Optional(CONF_OPENAI_API_KEY): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> OptionsFlow:
        return VoixOptionsFlow(entry)


# ─── Options flow ────────────────────────────────────────────────────────────


class VoixOptionsFlow(OptionsFlow):
    """Top menu: Defaults / Modes / Prompt context."""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._selected_mode_id: str | None = None

    # Top-level menu ----------------------------------------------------------

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        return self.async_show_menu(
            step_id="init",
            menu_options=["defaults", "modes"],
        )

    # Defaults form -----------------------------------------------------------

    async def async_step_defaults(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            new_opts = dict(self._entry.options)
            # Don't store empty strings — let resolvers fall through to defaults.
            for k, v in user_input.items():
                if v in ("", None):
                    new_opts.pop(k, None)
                else:
                    new_opts[k] = v
            return self.async_create_entry(title="", data=new_opts)

        def cur(k, default):
            return self._entry.options.get(k, self._entry.data.get(k, default))

        modes = get_modes(self._entry)
        default_mode_choices = {mid: m.get("name", mid) for mid, m in modes.items()}

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_OPENAI_API_KEY, default=cur(CONF_OPENAI_API_KEY, "")
                ): str,
                vol.Optional(
                    CONF_OPENROUTER_API_KEY,
                    default=cur(CONF_OPENROUTER_API_KEY, ""),
                ): str,
                vol.Optional(
                    CONF_DAEMON_URL,
                    default=cur(CONF_DAEMON_URL, ""),
                ): str,
                vol.Optional(
                    CONF_DEFAULT_MODE,
                    default=cur(CONF_DEFAULT_MODE, next(iter(default_mode_choices))),
                ): vol.In(default_mode_choices),
                vol.Optional(
                    CONF_IDLE_TIMEOUT_S,
                    default=cur(CONF_IDLE_TIMEOUT_S, DEFAULT_IDLE_TIMEOUT_S),
                ): vol.All(vol.Coerce(float), vol.Range(min=1.0, max=120.0)),
            }
        )
        return self.async_show_form(step_id="defaults", data_schema=schema)

    # Modes CRUD --------------------------------------------------------------

    async def async_step_modes(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Pick a mode to edit, or add a new one."""
        modes = get_modes(self._entry)
        choices = {mid: m.get("name", mid) for mid, m in modes.items()}
        choices["__new__"] = "➕ Add new mode"

        if user_input is not None:
            picked = user_input["mode_id"]
            if picked == "__new__":
                self._selected_mode_id = None
            else:
                self._selected_mode_id = picked
            return await self.async_step_mode_form()

        return self.async_show_form(
            step_id="modes",
            data_schema=vol.Schema({vol.Required("mode_id"): vol.In(choices)}),
        )

    async def async_step_mode_form(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Edit (or add) a single mode."""
        modes = get_modes(self._entry)
        editing_id = self._selected_mode_id
        existing = modes.get(editing_id, {}) if editing_id else {}

        if user_input is not None:
            if user_input.get("delete"):
                if editing_id and editing_id in modes:
                    new_modes = {k: v for k, v in modes.items() if k != editing_id}
                    if not new_modes:
                        # Don't allow deleting the last mode.
                        return self.async_abort(reason="cannot_delete_last")
                    new_opts = dict(self._entry.options)
                    new_opts[CONF_MODES] = new_modes
                    return self.async_create_entry(title="", data=new_opts)

            color = _parse_hex(user_input["color_hex"]) or [255, 255, 255]
            mode_def = {
                "name": user_input["name"].strip(),
                "type": user_input["type"],
                "prompt": user_input.get("prompt") or "",
                "voice": user_input.get("voice") or "",
                "model": user_input.get("model") or "",
                "stt_provider": user_input.get("stt_provider") or DEFAULT_STT_PROVIDER,
                "stt_model": (user_input.get("stt_model") or "").strip()
                or STT_PROVIDERS.get(
                    user_input.get("stt_provider") or DEFAULT_STT_PROVIDER,
                    ("", ""),
                )[1],
                # Per-mode prompt context (formerly the global "Prompt
                # context" options-flow step). Each mode carries its own
                # entity/person inclusions + addendum so "Work" and "Home"
                # modes can have completely different always-included context.
                "include_entities": list(user_input.get("include_entities") or []),
                "include_persons": list(user_input.get("include_persons") or []),
                "addendum": (user_input.get("addendum") or "").strip(),
                "color": color,
                "brightness": float(user_input["brightness"]),
                "effect": (user_input.get("effect") or "None").strip(),
            }
            ok, err = validate_mode_def(mode_def)
            if not ok:
                return self.async_show_form(
                    step_id="mode_form",
                    data_schema=_mode_form_schema(existing, mode_def),
                    errors={"base": err or "invalid"},
                )

            target_id = editing_id or slugify_mode_id(mode_def["name"])
            # If adding new but slug collides, append a number.
            if not editing_id:
                n = 2
                base = target_id
                while target_id in modes:
                    target_id = f"{base}-{n}"
                    n += 1

            new_modes = dict(modes)
            new_modes[target_id] = mode_def
            new_opts = dict(self._entry.options)
            new_opts[CONF_MODES] = new_modes
            return self.async_create_entry(title="", data=new_opts)

        return self.async_show_form(
            step_id="mode_form",
            data_schema=_mode_form_schema(existing, None),
            description_placeholders={
                "name": existing.get("name", "<new mode>"),
            },
        )

    # Prompt context now lives per-mode (see _mode_form_schema below).
    # The legacy global-prompt-extras step was removed when prompts moved
    # into mode_def — see ensure_builtin_modes() for the one-shot
    # migration that copies any pre-existing global values into every
    # mode on first load.


def _mode_form_schema(existing: dict, draft: dict | None) -> vol.Schema:
    """Schema for the add/edit mode form. Pre-fills from existing or draft."""
    src = draft or existing or {}
    # STT provider picker: only relevant for dictation modes, but we show
    # it on every form so users can flip the type without losing the
    # picker. The bridge ignores stt_* fields for non-dictation modes.
    stt_provider_choices = {
        pid: label for pid, (label, _model) in STT_PROVIDERS.items()
    }
    return vol.Schema(
        {
            vol.Required("name", default=src.get("name", "")): str,
            vol.Required("type", default=src.get("type", "realtime")): vol.In(MODE_TYPES),
            vol.Optional(
                "prompt", default=src.get("prompt", DEFAULT_REALTIME_INSTRUCTIONS)
            ): str,
            vol.Optional("voice", default=src.get("voice", DEFAULT_REALTIME_VOICE)): str,
            vol.Optional("model", default=src.get("model", DEFAULT_REALTIME_MODEL)): str,
            vol.Optional(
                "stt_provider",
                default=src.get("stt_provider", DEFAULT_STT_PROVIDER),
            ): vol.In(stt_provider_choices),
            vol.Optional(
                "stt_model",
                default=src.get(
                    "stt_model",
                    STT_PROVIDERS.get(DEFAULT_STT_PROVIDER, ("", ""))[1],
                ),
            ): str,
            vol.Optional(
                "include_entities",
                default=list(src.get("include_entities") or []),
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(multiple=True),
            ),
            vol.Optional(
                "include_persons",
                default=list(src.get("include_persons") or []),
            ): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="person", multiple=True),
            ),
            vol.Optional(
                "addendum",
                default=src.get("addendum", ""),
            ): selector.TextSelector(
                selector.TextSelectorConfig(multiline=True),
            ),
            vol.Required(
                "color_hex", default=_to_hex(src.get("color", [128, 128, 128]))
            ): str,
            vol.Required(
                "brightness", default=src.get("brightness", 0.4)
            ): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=1.0)),
            vol.Optional("effect", default=src.get("effect", "None")): str,
            vol.Optional("delete", default=False): bool,
        }
    )
