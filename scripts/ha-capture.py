#!/usr/bin/env python3
"""Subscribe to HA events for a fixed window and dump anything voice-related.

Used to determine which events / state changes carry the dictation transcript.

Usage:
  scripts/ha-capture.py [seconds]   # default 60
"""
import asyncio, json, os, sys, pathlib, time
import websockets

# line-buffered stdout so interim peeks see events
sys.stdout.reconfigure(line_buffering=True)

ROOT = pathlib.Path(__file__).resolve().parent.parent

def load_env():
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

NOISY_ENTITY_PREFIXES = (
    "sensor.",
    "binary_sensor.",
    "weather.",
    "climate.",
    "light.",  # too many, drop unless it's our LED ring
)

def is_interesting(msg):
    ev = msg.get("event") or {}
    et = ev.get("event_type")
    if not et:
        return False
    if et == "state_changed":
        eid = (ev.get("data") or {}).get("entity_id") or ""
        # always include voice_* devices and our helper
        if "voice" in eid or "voix" in eid or eid.startswith(("assist_satellite.", "stt.", "tts.", "wake_word.")):
            return True
        # otherwise drop noisy domains
        return not any(eid.startswith(p) for p in NOISY_ENTITY_PREFIXES)
    # All non-state_changed events pass (call_service, etc. included)
    return True

async def main(seconds):
    load_env()
    token = os.environ["HA_TOKEN"]
    url = os.environ.get("HA_URL", "https://home.thenairn.com").rstrip("/")
    ws_url = url.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"
    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        hello = json.loads(await ws.recv())
        assert hello["type"] == "auth_required", hello
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth = json.loads(await ws.recv())
        assert auth["type"] == "auth_ok", auth
        # Subscribe to all events
        await ws.send(json.dumps({"id": 1, "type": "subscribe_events"}))
        ack = json.loads(await ws.recv())
        assert ack.get("success"), ack
        print(f"# subscribed; capturing for {seconds}s. Speak the wake word + phrase now.", file=sys.stderr)
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.time()))
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if not is_interesting(msg):
                continue
            ev = msg["event"]
            et = ev.get("event_type")
            data = ev.get("data") or {}
            ts = ev.get("time_fired", "")
            if et == "state_changed":
                eid = data.get("entity_id")
                new = (data.get("new_state") or {})
                ns = new.get("state")
                attrs = new.get("attributes", {})
                interesting_attrs = {k: v for k, v in attrs.items() if k not in ("friendly_name", "icon", "device_class", "supported_features", "options")}
                print(json.dumps({"t": ts, "et": "state_changed", "eid": eid, "state": ns, "attrs": interesting_attrs}, default=str))
            else:
                print(json.dumps({"t": ts, "et": et, "data": data}, default=str))

if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 60))
