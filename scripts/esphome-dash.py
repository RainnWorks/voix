#!/usr/bin/env python3
"""Drive the ESPHome dashboard's WebSocket API from the command line.

The dashboard's /compile, /run, /upload, /validate, /logs endpoints are all
WebSocket-only. Each emits JSON messages of shape {"event": ..., "data": ...}.

Usage:
  scripts/esphome-dash.py compile <config.yaml>
  scripts/esphome-dash.py run <config.yaml>      # compile + OTA upload + logs
  scripts/esphome-dash.py upload <config.yaml>   # OTA-only after last compile
  scripts/esphome-dash.py logs <config.yaml>     # tail device logs
  scripts/esphome-dash.py validate <config.yaml>

Reads ESPHOME_DASHBOARD_URL from .env (default http://192.168.96.15:6052).
Exits non-zero if the dashboard reports a non-zero exit code.
"""
import asyncio, json, os, pathlib, sys
import websockets

ROOT = pathlib.Path(__file__).resolve().parent.parent

def load_env():
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

async def stream(endpoint: str, configuration: str, extra: dict | None = None) -> int:
    load_env()
    base = os.environ.get("ESPHOME_DASHBOARD_URL", "http://192.168.96.15:6052").rstrip("/")
    ws_url = base.replace("http://", "ws://").replace("https://", "wss://")
    url = f"{ws_url}/{endpoint}"
    print(f"# connecting to {url} (config={configuration})", file=sys.stderr, flush=True)
    exit_code = 1
    spawn_msg = {"type": "spawn", "configuration": configuration}
    if extra:
        spawn_msg.update(extra)
    async with websockets.connect(url, max_size=8 * 1024 * 1024, ping_interval=20, ping_timeout=180) as ws:
        await ws.send(json.dumps(spawn_msg))
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                print(raw, flush=True)
                continue
            ev = msg.get("event")
            data = msg.get("data", "")
            if ev == "line":
                # data is a string with trailing newline
                sys.stdout.write(data)
                sys.stdout.flush()
            elif ev == "exit":
                try:
                    exit_code = int(data)
                except (TypeError, ValueError):
                    exit_code = 1
                print(f"\n# dashboard exit code: {exit_code}", file=sys.stderr, flush=True)
                break
            else:
                print(f"# event={ev} data={data!r}", file=sys.stderr, flush=True)
    return exit_code

def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    endpoint = sys.argv[1]
    if endpoint not in ("compile", "run", "upload", "logs", "validate"):
        sys.exit(f"unknown endpoint: {endpoint}")
    configuration = sys.argv[2]
    extra: dict = {}
    # Optional extra k=v args (e.g. port=OTA, encryption=true)
    for kv in sys.argv[3:]:
        if "=" in kv:
            k, v = kv.split("=", 1)
            extra[k] = v
    rc = asyncio.run(stream(endpoint, configuration, extra))
    sys.exit(rc)

if __name__ == "__main__":
    main()
