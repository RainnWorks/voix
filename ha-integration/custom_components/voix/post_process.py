"""LLM post-processing for dictation transcripts.

After STT produces a raw transcript, a mode can route it through a small
LLM to rewrite the text per the mode's `post_process_prompt` (the
Supershout pattern: each mode is a different reformatting style — Email,
Message, Note, Code).

Two providers are wired in:
  - **openai**: `/v1/chat/completions` against the OpenAI key already
    configured for STT + realtime. Default models: gpt-4o-mini, gpt-4o.
  - **openrouter**: `/v1/chat/completions` against an optional OpenRouter
    key in entry.options. Same protocol — OpenRouter exposes a
    drop-in-compatible chat API — so the implementation is one HTTP
    call with a different base URL + key.

The provider abstraction is deliberately tiny. Voix doesn't need
streaming, function-calling, or temperature tuning here; it needs
"system prompt + raw transcript → polished text". If post-processing
fails for any reason (no key, HTTP error, model refuses), we fall back
to the raw text so a dictation is never lost.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import aiohttp

_LOGGER = logging.getLogger(__name__)

PROVIDER_OPENAI = "openai"
PROVIDER_OPENROUTER = "openrouter"

_OPENAI_URL = "https://api.openai.com/v1/chat/completions"
_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Cap the post-proc call so a stuck model can't drag out a session.
# Most dictations finish their LLM round-trip in <2s; 20s is the
# "something is genuinely wrong" ceiling.
_HTTP_TIMEOUT_S = 20.0


async def post_process(
    raw_text: str,
    *,
    system_prompt: str,
    provider: str,
    model: str,
    openai_key: Optional[str],
    openrouter_key: Optional[str],
    session: aiohttp.ClientSession,
) -> str:
    """Run raw STT text through a post-processing LLM. Returns polished text.

    Falls back to `raw_text` on any failure — the caller always gets
    something usable. Empty `system_prompt` or empty `raw_text` are
    no-ops.
    """
    raw_text = (raw_text or "").strip()
    if not raw_text:
        return raw_text
    system_prompt = (system_prompt or "").strip()
    if not system_prompt:
        return raw_text

    provider = (provider or PROVIDER_OPENAI).lower()
    if provider == PROVIDER_OPENROUTER:
        url = _OPENROUTER_URL
        key = openrouter_key
    else:
        # Anything not openrouter falls through to OpenAI — including the
        # default "openai" and unknown / typo'd providers. Logging the
        # mismatch lets us catch config drift without breaking the user's
        # dictation.
        if provider != PROVIDER_OPENAI:
            _LOGGER.warning(
                "voix post-process: unknown provider %r, falling back to openai",
                provider,
            )
        url = _OPENAI_URL
        key = openai_key

    if not key:
        _LOGGER.warning(
            "voix post-process: no API key for provider %s — returning raw text",
            provider,
        )
        return raw_text

    body = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": raw_text},
        ],
        # Low temperature — these prompts ask for transformation, not
        # creativity. Same setting Supershout uses (implicit via ai-sdk
        # default, around 0.3-0.7). 0.2 keeps Email-mode polish from
        # inventing new clauses.
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if provider == PROVIDER_OPENROUTER:
        # OpenRouter's analytics dashboard groups requests by these. Not
        # required, but it gives us a useful "what's this voix install
        # calling for?" answer when costs spike.
        headers["HTTP-Referer"] = "https://github.com/thenairn/voix"
        headers["X-Title"] = "voix dictation post-processing"

    try:
        async with asyncio.timeout(_HTTP_TIMEOUT_S):
            async with session.post(url, json=body, headers=headers) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    _LOGGER.warning(
                        "voix post-process: %s returned %d: %s",
                        provider, resp.status, text[:400],
                    )
                    return raw_text
                data = await resp.json()
    except Exception as e:  # noqa: BLE001
        _LOGGER.warning("voix post-process: HTTP failure (%s): %s", provider, e)
        return raw_text

    try:
        polished = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        _LOGGER.warning(
            "voix post-process: unexpected response shape from %s: %s "
            "(payload=%s)",
            provider, e, str(data)[:400],
        )
        return raw_text

    polished = (polished or "").strip()
    if not polished:
        _LOGGER.warning(
            "voix post-process: %s returned empty content, falling back to raw",
            provider,
        )
        return raw_text

    _LOGGER.info(
        "voix post-process: %s/%s ok — raw=%d chars → polished=%d chars",
        provider, model, len(raw_text), len(polished),
    )
    return polished
