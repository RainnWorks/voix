# voix-backend

Daemon that bridges Voice PE pucks (and, later, the Mac app) to OpenAI Realtime, runs dictation post-processing, and gathers context from MCP servers (Home Assistant, Mac app, future).

This is the "brain" half of voix. The HA custom integration (`ha-integration/`) handles puck discovery and onboarding only — once a puck is adopted, its WS connects directly here.

## Run locally (dev)

```bash
cd voix-backend
cp .env.example .env
# edit .env: set OPENAI_API_KEY + generate VOIX_WS_TOKEN
#   openssl rand -hex 32

bun install
bun run dev
```

The daemon listens on `:8765` by default. Point your puck at `ws://<dev-host>:8765/ws` with the matching token (the HA integration pushes this automatically once you've onboarded).

## Run as a Home Assistant Add-on

1. In HA: Settings → Add-ons → Add-on Store → ⋮ → Repositories → add `https://github.com/thenairn/voix`.
2. "voix backend" appears in the store. Install.
3. Configuration tab: paste your OpenAI API key. Leave `ws_token` blank — the daemon will generate one on first boot and log it. Copy that token into your ESPHome puck's `secrets.yaml`.
4. Start the add-on.

## Layout

```
src/
├── index.ts          Entrypoint — Elysia app + healthz + WS route mount
├── env.ts            Config loader (env vars OR /data/options.json from HA Add-on)
├── log.ts            Level-gated logger
├── audio/
│   └── resample.ts   PCM16 linear resampler with state threading (16 → 24 kHz)
├── puck/
│   ├── protocol.ts   Wire types between puck firmware and daemon
│   ├── route.ts      Elysia /ws endpoint — auth, message dispatch
│   └── session.ts    Per-puck session lifecycle (puck ↔ OpenAI relay)
└── realtime/
    └── openai.ts     OpenAI Realtime WS client (GA schema, post May 2026)
```

## Scripts

```bash
bun run dev         # watch mode
bun run start       # one-shot
bun run typecheck   # tsc --noEmit
bun run check       # biome lint + format check
bun run format      # biome format --write
```

## What's not here yet (Phase 2+)

- MCP client for context gathering (HA areas/persons, Mac app focused window, …)
- Mode catalog + post-processing pipeline (lifted from `ha-integration/`)
- Mac-side WS connection (the Tauri app currently talks to HA, will talk here)
- History store (transcripts + raw + polished + context, JSON index)
- Auto-routing (dictation-mode picker driven by Mac app context)

## Why a daemon, why now

The HA custom integration was doing three jobs: device adoption, mode/state mirror, and the actual realtime + STT bridge. The third job kept fighting HA's runtime constraints — pinned `openai==2.21.0`, 100-line log buffer, restart-kills-session lifecycle, slugification surprises. Moving the brain into a daemon process lets us:

- pin our own dependencies, including OpenAI SDK GA
- log to stdout at any level (HA Supervisor captures cleanly)
- restart HA without dropping puck sessions
- run anywhere a Bun image runs (HA Add-on, Docker, native), not only inside HA
