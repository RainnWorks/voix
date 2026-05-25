# ha/

Home Assistant-side artifacts owned by this project.

| File | Purpose | Phase |
|---|---|---|
| [`helpers.yaml.example`](helpers.yaml.example) | The `input_text.dictation_buffer` helper used by Mode C. Can be created via the UI instead. | 2 |

The custom integration (`custom_components/voix/`) for Mode B lives at the repo root — created in Phase 3.

## Conventions

- Examples ship as `*.example` files. Copy and edit; don't commit live config from a real HA instance.
- Never commit `secrets.yaml`. The OpenAI API key, HA tokens, and ESPHome encryption keys all live in your local HA config.
