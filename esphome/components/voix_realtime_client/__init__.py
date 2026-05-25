"""voix_realtime_client — custom ESPHome component for Mode B (Realtime).

Layers on top of the stock Voice PE config without replacing anything:

  - Reuses upstream's `i2s_mics` microphone (declared in upstream YAML)
  - Reuses upstream's `voice_resampling_speaker` for playback
  - Coexists with upstream's `voice_assistant` — Mode A and C use that;
    only Mode B (Hey Mycroft) routes here

The C++ side opens a WebSocket to a configurable server URL (our HA
integration's `/api/voix/realtime` endpoint), streams 16 kHz PCM mic
audio in, and plays received audio chunks through the speaker. The
server bridges to OpenAI Realtime, including format conversion.

This file declares the YAML schema + code-generation hooks. The actual
behaviour lives in voix_realtime_client.{h,cpp}.

Status: skeleton. start/stop log only; no WS / audio yet.
"""
from __future__ import annotations

from esphome import automation
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import microphone, speaker
from esphome.const import CONF_ID, CONF_MICROPHONE, CONF_SPEAKER

CODEOWNERS = ["@voix"]
DEPENDENCIES = ["network"]

voix_realtime_client_ns = cg.esphome_ns.namespace("voix_realtime_client")
VoixRealtimeClient = voix_realtime_client_ns.class_(
    "VoixRealtimeClient", cg.Component
)

StartAction = voix_realtime_client_ns.class_("StartAction", automation.Action)
StopAction = voix_realtime_client_ns.class_("StopAction", automation.Action)
InterruptAction = voix_realtime_client_ns.class_("InterruptAction", automation.Action)
IsRunningCondition = voix_realtime_client_ns.class_(
    "IsRunningCondition", automation.Condition
)
IsSpeakingCondition = voix_realtime_client_ns.class_(
    "IsSpeakingCondition", automation.Condition
)

CONF_SERVER_URL = "server_url"
CONF_ON_CONNECTED = "on_connected"
CONF_ON_DISCONNECTED = "on_disconnected"
CONF_ON_AUDIO_OUT_START = "on_audio_out_start"
CONF_ON_AUDIO_OUT_END = "on_audio_out_end"
CONF_ON_ERROR = "on_error"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(VoixRealtimeClient),
        cv.Required(CONF_SERVER_URL): cv.string,
        cv.Required(CONF_MICROPHONE): cv.use_id(microphone.Microphone),
        cv.Required(CONF_SPEAKER): cv.use_id(speaker.Speaker),
        cv.Optional(CONF_ON_CONNECTED): automation.validate_automation(
            cv.Schema({})
        ),
        cv.Optional(CONF_ON_DISCONNECTED): automation.validate_automation(
            cv.Schema({})
        ),
        cv.Optional(CONF_ON_AUDIO_OUT_START): automation.validate_automation(
            cv.Schema({})
        ),
        cv.Optional(CONF_ON_AUDIO_OUT_END): automation.validate_automation(
            cv.Schema({})
        ),
        cv.Optional(CONF_ON_ERROR): automation.validate_automation(cv.Schema({})),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_server_url(config[CONF_SERVER_URL]))

    mic = await cg.get_variable(config[CONF_MICROPHONE])
    cg.add(var.set_microphone(mic))
    spk = await cg.get_variable(config[CONF_SPEAKER])
    cg.add(var.set_speaker(spk))

    for trigger_key, trigger_class in (
        (CONF_ON_CONNECTED, "get_connected_trigger"),
        (CONF_ON_DISCONNECTED, "get_disconnected_trigger"),
        (CONF_ON_AUDIO_OUT_START, "get_audio_out_start_trigger"),
        (CONF_ON_AUDIO_OUT_END, "get_audio_out_end_trigger"),
        (CONF_ON_ERROR, "get_error_trigger"),
    ):
        for action in config.get(trigger_key, []):
            await automation.build_automation(
                getattr(var, trigger_class)(), [], action
            )


@automation.register_action(
    "voix_realtime_client.start",
    StartAction,
    cv.Schema({cv.Required(CONF_ID): cv.use_id(VoixRealtimeClient)}),
)
async def voix_start_to_code(config, action_id, template_arg, args):
    var = cg.new_Pvariable(action_id, template_arg)
    parent = await cg.get_variable(config[CONF_ID])
    cg.add(var.set_parent(parent))
    return var


@automation.register_action(
    "voix_realtime_client.stop",
    StopAction,
    cv.Schema({cv.Required(CONF_ID): cv.use_id(VoixRealtimeClient)}),
)
async def voix_stop_to_code(config, action_id, template_arg, args):
    var = cg.new_Pvariable(action_id, template_arg)
    parent = await cg.get_variable(config[CONF_ID])
    cg.add(var.set_parent(parent))
    return var


@automation.register_action(
    "voix_realtime_client.interrupt",
    InterruptAction,
    cv.Schema({cv.Required(CONF_ID): cv.use_id(VoixRealtimeClient)}),
)
async def voix_interrupt_to_code(config, action_id, template_arg, args):
    var = cg.new_Pvariable(action_id, template_arg)
    parent = await cg.get_variable(config[CONF_ID])
    cg.add(var.set_parent(parent))
    return var


@automation.register_condition(
    "voix_realtime_client.is_running",
    IsRunningCondition,
    cv.Schema({cv.Required(CONF_ID): cv.use_id(VoixRealtimeClient)}),
)
async def voix_is_running_to_code(config, condition_id, template_arg, args):
    var = cg.new_Pvariable(condition_id, template_arg)
    parent = await cg.get_variable(config[CONF_ID])
    cg.add(var.set_parent(parent))
    return var


@automation.register_condition(
    "voix_realtime_client.is_speaking",
    IsSpeakingCondition,
    cv.Schema({cv.Required(CONF_ID): cv.use_id(VoixRealtimeClient)}),
)
async def voix_is_speaking_to_code(config, condition_id, template_arg, args):
    var = cg.new_Pvariable(condition_id, template_arg)
    parent = await cg.get_variable(config[CONF_ID])
    cg.add(var.set_parent(parent))
    return var
