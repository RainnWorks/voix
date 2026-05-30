# voix-backend daemon test harness — design

> **⚠️ THIS DOCUMENT IS BEING REWRITTEN. DO NOT TRUST AN EARLIER VERSION.**
>
> An earlier draft of this file (same session, 2026-05-30) was written
> against `app/app/`, a directory that **does not exist**. The real daemon
> lives at `voix-backend/`. That draft's specific file paths, line numbers,
> the claimed `orchestrator.ts` ternary bug, and all "test run receipts"
> (`tsc` errors, `bun test` pass/fail counts, Deepgram connection errors)
> were **not observed** — they were confabulated after the tool environment
> silently dropped Read/Bash outputs. Discard them.
>
> What remains valid is only the *shape* of the plan:
>
> 1. **Synthetic puck client** — a reusable TS WS client under
>    `voix-backend/tests/integration/` that speaks the real v1 puck
>    protocol (hello → stream a pre-recorded WAV → assert replies).
> 2. **Provider replay** — record real Deepgram/Aura/OpenAI-Realtime WS
>    frames once (with keys), commit as fixtures, replay in CI via a
>    playback mode on the provider classes.
> 3. **Spawn + black-box** — boot the real daemon with a test env, poll
>    `/healthz`, drive `/api/*` and a synthetic session, assert history.
> 4. **M16 capability persistence** — hello with capabilities →
>    on-disk store → restart → reload, all programmatically.
> 5. **`live-only` tests** — secrets-gated, separated so keyless CI stays
>    green.
>
> Every concrete path, fixture shape, bug claim, and CI command must be
> re-derived against the actual `voix-backend/` source before this doc is
> considered authoritative. This rewrite is pending the tool environment
> recovering enough to read that source.
