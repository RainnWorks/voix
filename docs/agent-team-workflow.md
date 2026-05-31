# Agent-team workflow

**How Claude runs large initiatives in this repo with minimal user
interaction.** Authored after the M01-M18 audit pass exposed both the
power and failure modes of multi-agent work, and rewritten after
research showed the community has converged on conventions worth
adopting rather than inventing.

This sits alongside `docs/build-workflow.md`: the build doc says
*what* to ship; this doc says *how the team ships it*. Intended as
the default operating mode across all projects in
`/Users/tom/Projects/`. Other projects should symlink or copy this
file; overrides must be declared explicitly in the project's
CLAUDE.md.

---

## TL;DR

Use **Claude Code's Agent Teams** (built-in, already enabled in
`~/.claude/settings.json`). It is the canonical Anthropic
orchestrator-worker mechanism with a shared task list, peer
messaging, plan-approval gates, and on-idle delivery. It does the
plumbing for free; this doc covers the **conventions** that go on
top.

> *"The bottleneck is no longer generation. It's verification."*
> *"Delegate the tasks, not the judgment."*
> — Addy Osmani, [Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/)

The coordinator (Claude main thread) holds the judgement.
Teammates do the work. The verification triangle catches what
neither sees.

---

## 1. The mechanism — Claude Code Agent Teams

Reference: <https://code.claude.com/docs/en/agent-teams.md>

What's built in:

| Capability | Tool | Why it matters |
|---|---|---|
| Spawn a team + shared task list | `TeamCreate` | One mechanism for "we're working on X with N agents" |
| Add teammates | `Agent` with `team_name` + `name` | Roles are subagent_types; teammates self-discover via `~/.claude/teams/<name>/config.json` |
| Self-claim work | `TaskUpdate owner` | DAG-aware: a task becomes ready when its `blockedBy` set is empty |
| Peer messaging | `SendMessage` | Coordinator ↔ teammate, teammate ↔ teammate (auto-delivered on idle) |
| Plan approval | `SendMessage` with `plan_approval_request` / `plan_approval_response` | Built-in gate — teammates can require human-in-the-loop sign-off before implementation |
| Shutdown | `SendMessage` with `shutdown_request` | Graceful teardown when work is done |
| Hooks | `~/.claude/settings.json` | `TeammateIdle`, `TaskCreated`, `TaskCompleted` — exit code 2 attaches feedback |

Use **Agent Teams** for the long-running coordinator + worker fleet
pattern (this doc's primary case).

Use **`Workflow`** for one-shot deterministic fan-outs that produce
structured data the coordinator integrates programmatically (e.g.
"run this 8-way audit, return JSON"). No team needed.

Use **single `Agent` calls** for one-off research / decisions that
don't need a team scaffold.

Use **`orca orchestration`** *only* for cross-worktree, decision-
gated, or terminal-bound work (a deploy that needs an interactive
shell). Audit lesson: Orca strained under 5+ parallel workers; cap
at 2-3 if you must.

---

## 2. Roles

Roles are *postures* a teammate takes, mapped to subagent_types.
Names come from Shrivu Shankar's "[Building Multi-Agent Systems
Part 2](https://blog.sshh.io)" taxonomy (Lead-Specialist /
Master-Clone / Scripting). We use Lead-Specialist.

| Role | subagent_type | Tools | Purpose |
|---|---|---|---|
| **Coordinator** | (main thread) | All | Holds judgement. Plans, dispatches, integrates, commits. |
| **Researcher** | `Explore` | read-only | Maps existing code, lists files an implementer will touch, surfaces landmines. |
| **Implementer** | `general-purpose` | full | Writes code for a scoped task. Returns diff + receipts + their own tests. |
| **Tester** | `general-purpose` | full | Runs tests, captures output. Distinguishes "shape" (unit) from "verified" (integration). |
| **Adversary** | `general-purpose` | full | Reads diff with malicious intent. Primed with specific suspicions; asked to find more. Personality required. |
| **Product** | `general-purpose` | full | Steps out of code. Reads brief + diff. Asks "does this match what we promised?" Personality required. |
| **Doc/State** | (usually coordinator inline) | n/a | Keeps STATE.md, session-handoff, milestone notes in sync. |

**Personality on Adversary + Product is non-negotiable.** A generic
adversary returns generic feedback. Use the starting cast in
`docs/build-workflow.md` (Marina, Sven, Priya, Wren, Caleb) or
spin up new ones as needed.

---

## 3. The loop, per milestone

```
plan → research → implement → ┬─ tester ─────┐
                              ├─ adversary ──┼─ integrate → document
                              └─ product ────┘
                                (verification triangle)
```

**1. Plan** *(coordinator, or a Plan-agent if scope is unclear)*.
Read STATE + brief + the relevant subsystem. Write acceptance
criteria *before* dispatching. "What command / UI / test proves
this milestone landed?" If you can't write it, don't dispatch.

**2. Research** *(Researcher, only if unknowns exist)*. Map the
existing code, list files an implementer will touch, surface
landmines. Cheap insurance against fabrication — see §6 on the
A1 incident from the prior audit pass.

**3. Implement** *(1-3 Implementers, parallel if independent)*.
Each gets the scoped brief + acceptance criteria + receipts
requirement. Implementers may use the plan-approval gate to
require coordinator sign-off before writing code on risky
changes.

**4. Verification triangle** *(Tester + Adversary + Product,
parallel)*.
- **Tester** runs the suite, captures output, distinguishes unit
  from integration.
- **Adversary** reads the diff with malicious intent. Returns a
  punch list with severity.
- **Product** reads brief + diff. Returns feature gaps + UX
  assumptions + edge cases.

**5. Integrate** *(coordinator)*. Read all three streams. Decide:
- **Ship** — nothing material from any stream. Rare; be honest
  about whether the adversary did real work.
- **Fix-and-ship** — dispatch focused Implementers for severity
  ≥ medium issues. Loop back to verify.
- **Rework** — scope was wrong. Re-plan from §3.1.
- **Roll back** — milestone shouldn't ship. Revert, document, move on.

**6. Document** *(coordinator)*. Update STATE.md +
build-workflow.md if phase map shifted. Commit. Push.

---

## 4. When to interrupt the user

**Default: don't.** Every interruption is context-switch tax.
Save them up; batch with `AskUserQuestion`.

Interrupt only for:

- **Hardware-blocked** — puck offline, USB device missing,
  homelab unreachable.
- **Credential / API key needed** — `DEEPGRAM_API_KEY`, signing
  keys, third-party tokens.
- **Genuine product decision** — the kind where two reasonable
  engineers would build different things. The §3 killer-flow
  question is the archetype.
- **External-service decision** — repository home, deployment
  target, domain ownership.
- **Destructive operation** — `git rm -r` of a meaningful
  directory, force-push, dropping data.

**Do NOT interrupt for**: bug fixes, refactors the audits flagged,
test gaps, renames, dep bumps, lint cleanup, anything where the
right answer is obvious.

---

## 5. Receipts

**This is unique to this workflow — there is no community
convention as of 2026.** The closest prior art is the NabaOS paper
([arXiv:2603.10060](https://arxiv.org/abs/2603.10060)) on HMAC-
signed tool-call receipts; no shipped framework adopts it.

Every teammate that claims to have read a file must produce one of:

- `stat -f "%m %z %N" <path>` (mtime + size + path), OR
- `md5sum <path>` / `shasum -a 256 <path>`, OR
- The first and last 10 lines of the file with line numbers.

The coordinator spot-checks 2-3 receipts per wave by comparing
them against the actual files. Missing or wrong receipt → report
rejected, teammate re-dispatched.

**Why**: in the M01-M18 audit pass, two of five workers (A1, A3)
returned plausible-looking analysis of code that did not exist or
they had not read. A1 wrote a daemon-test harness against
`/Users/tom/Projects/voix/app/app` (path does not exist). A3
first claimed a "compromised tool channel" then retracted.
Receipts catch both cases cheaply.

---

## 6. Failure modes from past sessions

### Fabrication under parallel load

**Symptom**: a teammate reports detailed findings about code that
doesn't exist or wasn't read. Plausible function names, plausible
line numbers, all invented.

**Mitigation**: receipts (§5), waves of 2-3, dispatch a Researcher
to map paths first when the brief touches code the teammate
hasn't seen the coordinator open.

### "Tested" vs "verified"

**Symptom**: a milestone's commit says "behaviour works" when only
unit tests with stubs were run. The shape compiles; the behaviour
is unproven. The voix M08-M18 stack is the cautionary tale.

**Mitigation**: testers distinguish unit-test pass ("shape") from
integration-test pass ("verified against a real dependency").
Coordinator gates phase tags on the verified column. Commits use
"tested" for shape, "verified" only after integration.

### Empty adversary report

**Symptom**: adversary says "looks good, no findings." Almost
never true on a real diff.

**Mitigation**: prime with at least one specific suspicion the
coordinator believes is real. If the adversary doesn't find it,
the dispatch was broken — re-issue with a sharper persona.

### Coordinator narrates instead of dispatches

**Symptom**: coordinator types "here's what I found" to the user
instead of dispatching a fix.

**Mitigation**: when the user gave standing direction "fix the
findings," dispatch. The user reads the diff after the fact.

### Phase tangling

**Symptom**: Phase N+1 work reveals Phase N is wrong; coordinator
half-fixes Phase N inline and proceeds.

**Mitigation**: stop, fix Phase N as its own milestone, re-run
verification, then resume. This is build-workflow.md rule 6,
doubled.

---

## 7. Production-ready acceptance bar

A milestone ships to main when:

- [ ] Tests pass (unit, biome, typecheck — relevant subset for the
      change)
- [ ] Adversary's high/medium findings all closed or explicitly
      deferred with a one-line note
- [ ] Product gap list addressed or filed as follow-up milestones
      in build-workflow.md
- [ ] Receipts spot-check passed for at least one Implementer +
      one verify-phase teammate
- [ ] STATE.md updated
- [ ] Commit body has a "manual smoke test" recipe (what the user
      should do if they want to verify)

A **phase** ships (gets a `v0.phase-N` tag) when:

- [ ] Every milestone has at least one integration test passing
      against a real dependency (real WS, real external API with
      a fixture, real HA running locally) — not a stub
- [ ] Zero known crash paths in the happy path
- [ ] Zero known data-loss paths
- [ ] Cold-start works without manual setup beyond documented
      prereqs
- [ ] Documented failure modes have user-visible recovery

**Phases do not tag on "all unit tests green."** This is the
verification cliff lesson from M03-M18.

---

## 8. Team lifecycle

A team is created per **initiative** (a chunk of work that spans
multiple milestones with a coherent goal — e.g. "RN end-to-end" =
Phase 6). One team per initiative; teammates persist across
milestones within that initiative.

```
TeamCreate "voix-rn"        # at the start of Phase 6
  ├─ Agent "researcher"      Explore
  ├─ Agent "implementer-1"   general-purpose
  ├─ Agent "implementer-2"   general-purpose
  ├─ Agent "tester"          general-purpose
  ├─ Agent "adversary-wren"  general-purpose (personality: Wren)
  └─ Agent "product-marina"  general-purpose (personality: Marina)

# milestones flow through. Teammates stay alive between them,
# state is in the shared task list.

SendMessage { type: shutdown_request } to each teammate
TeamDelete                  # at end of phase
```

**Why per-initiative, not per-milestone**: spawning is expensive
and teammates accumulate useful context about the codebase across
milestones. Spinning down between milestones throws that away.

**Why not one global team**: roles drift, personalities go stale,
the shared task list bloats. A team is a unit of focused work.

---

## 9. Coordinator hygiene

- **Read STATE.md at the start of every session.** If you didn't
  spawn the team yourself, read its config too:
  `~/.claude/teams/<name>/config.json`.
- **Keep your own context lean.** Push noisy reads (test output,
  source dumps) into teammates and ask for synthesised reports.
- **Use TaskCreate/TaskUpdate as external memory.** When you spot
  follow-up work mid-milestone, log a task instead of holding it
  in context.
- **Don't poll.** Teammates auto-deliver on idle. If you're
  waiting on N teammates, do other useful work or write up
  intermediate state.
- **Plan-approval gate is for the coordinator's benefit too.**
  Ask implementers to send a plan-approval request before writing
  >200 LOC of new code. Catches a wrong shape before it's
  committed.

---

## 10. Prior art and citations

This doc adopts conventions from:

- **Anthropic Agent Teams**
  — <https://code.claude.com/docs/en/agent-teams.md>
  *The mechanism. Use it directly.*
- **Anthropic "How we built our multi-agent research system"**
  — orchestrator-worker pattern where workers don't talk to each
  other. Use this topology.
- **Addy Osmani, "Code Agent Orchestra"**
  — <https://addyosmani.com/blog/code-agent-orchestra/>
  *Vocabulary: verification is the bottleneck, delegate tasks not
  judgment, plan-approval gates, dedicated reviewer subagent.*
- **Shrivu Shankar, "Building Multi-Agent Systems Part 2"**
  — <https://blog.sshh.io>
  *Shape vocabulary: Lead-Specialist / Master-Clone / Scripting.
  We use Lead-Specialist.*
- **VoltAgent `09-meta-orchestration/multi-agent-coordinator.md`**
  — <https://github.com/VoltAgent/awesome-claude-code-subagents>
  *Cited prior art for a coordinator skill; we don't adopt
  wholesale but the structure influenced this doc.*

Originals to this doc:

- **§5 Receipts** — no shipped framework has this; NabaOS paper
  is the closest prior art and is unshipped.
- **§7 phase-acceptance bar with the "verified" vs "tested"
  distinction** — built from the M03-M18 verification-cliff
  lesson.
- **§6 failure mode taxonomy** — from the M01-M18 audit pass.

---

## 11. When to edit this doc

- **Build-workflow doc**: edit when scope shifts (new
  milestones, re-ordered phases).
- **This doc**: edit when the workflow itself proved wrong.
- **STATE.md**: edit at every milestone merge.
- **CLAUDE.md**: edit when an operational fact about the
  environment changes.

The four together are the system. If something doesn't fit any
of them, it probably isn't a thing yet.
