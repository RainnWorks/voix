#!/usr/bin/env python3
"""Send one or more HA WebSocket commands and print the result(s).

Usage:
  scripts/ha-ws.py '{"type":"assist_pipeline/pipeline/list"}'
  scripts/ha-ws.py @cmds.json     # read newline-delimited commands from file
  scripts/ha-ws.py -              # read from stdin

Reads HA_URL and HA_TOKEN from .env in the repo root (HA_URL defaults to
https://home.thenairn.com)."""
import asyncio, json, os, sys, pathlib
import websockets

ROOT = pathlib.Path(__file__).resolve().parent.parent

def load_env():
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

def commands_from_args(argv):
    if not argv:
        sys.exit("usage: ha-ws.py <json>|-|@file")
    raw = argv[0]
    if raw == "-":
        text = sys.stdin.read()
    elif raw.startswith("@"):
        text = pathlib.Path(raw[1:]).read_text()
    else:
        return [json.loads(raw)]
    cmds = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            cmds.append(json.loads(line))
    return cmds

async def run(cmds):
    load_env()
    token = os.environ.get("HA_TOKEN")
    url = os.environ.get("HA_URL", "https://home.thenairn.com").rstrip("/")
    ws_url = url.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"
    if not token:
        sys.exit("HA_TOKEN not set in .env")
    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        hello = json.loads(await ws.recv())
        assert hello["type"] == "auth_required", hello
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth = json.loads(await ws.recv())
        assert auth["type"] == "auth_ok", auth
        for i, cmd in enumerate(cmds, start=1):
            cmd = {**cmd, "id": i}
            await ws.send(json.dumps(cmd))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == i and msg.get("type") == "result":
                    print(json.dumps({"cmd": cmd["type"], "success": msg.get("success"), "result": msg.get("result"), "error": msg.get("error")}, indent=2, default=str))
                    break

if __name__ == "__main__":
    asyncio.run(run(commands_from_args(sys.argv[1:])))
