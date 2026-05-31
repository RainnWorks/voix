# Wren — UX flow review · tom-smoke (iOS, iPhone 16 Pro sim, Phase 6 end-of-source)

Lens: interaction / flow / IA / mental model. Voice is the primary channel;
the screen is a secondary cue. Pixels, type, and colour are Marina's — where a
finding bottoms out at a hex value or a font I hand it off and say so.

Material: `/tmp/voix-tom-smoke/ios-01..08`, plus the daemon-log line proving the
press fired: `hello v1 kind=phone-sat intent=discuss voice_id=default-realtime
mic=48000/1 speaker=24000` → orchestrator → RealtimePipeline; WS opened then
closed at 0.8s, recorder captured 0 chunks (sim has no real mic).

---

## Receipts (what works — so the punch list isn't read as a verdict)

- **Onboarding tolerates interruption (the §exact question asked).** `ios-01`
  (22:21) and `ios-02` (22:31) are byte-for-byte the same screen after 10 min
  backgrounded. The flow held its place — no timeout, no forced re-onboard, no
  lost step. Gulf of evaluation is clean: the user returns exactly where they
  left. No finding; this is correct.
- **"Skip setup" on every onboarding step** (`ios-01/03/04`) — a standing escape
  hatch (Nielsen #3, user control & freedom). Right call: setup is optional, the
  copy says so ("works on its own with the daemon you'll wire up").
- **Connect screen models state before commit** (`ios-04`): a live "● Connected"
  badge, an editable URL, and "Reset to default" recovery. The user sees the
  connection is real *before* pressing Done — visibility of system status done
  right (Nielsen #1).
- **The bottom axis is named right** — "Voices" (not "Modes"/"Presets") and
  "Surfaces" (not "Devices"). Modes-as-portraits and surfaces-as-peers, the
  intent-over-target framing the brief wants. "Voices" is a genuine portrait word
  ("how you want to sound"). The naming is correct; the *rendering* of it is where
  F4 bites.
- **Welcome framing is voice-first and in-register**: "voix listens when you talk
  to it." The device listens, it doesn't command. (Legibility of that heading is
  near-zero — see F9 handoff to Marina.)

---

## Findings — worst-first by Method priority

### 1. `ios-06` + AX label `＋, New conversation, ⌘N` — the product's front door has no handle on this surface. [severity: high]
The user taps "+ New conversation" and **nothing happens** — no navigation, no
feedback, no spinner. The accessibility label exposes why: the action is bound to
`⌘N`, a keystroke that does not exist on a phone. So the single signifier for the
gulf of execution *into the whole product* — "I have something to say, start
here" — is wired to a key this surface can't press.
- **Violates:** Norman affordance + mapping (the control maps to no effect);
  Nielsen #1 (no feedback on the primary action). The "press, speak, paste"
  promise from `ios-01` dies at the first tap.
- **Intent broken:** the JTBD is "start talking to voix." On a phone-sat this is
  *the* entry, and it's dead.
- **Fix shape:** wire the press/`onPress` handler to the same intent the `⌘N`
  accelerator fires (create + navigate into a new conversation). Keep the
  accelerator as an *additional* path, not the only one.
- *Also a functional defect — coordinator may route to engineering, but the UX
  consequence is mine: net-new users cannot start.*

### 2. `ios-07`→`ios-08` + log (`WS closed 0.8s, 0 chunks`) — after "Connecting…" the user can't tell whether voix heard them, ended, or failed. [severity: high]
The press fired correctly (log confirms `hello v1 … intent=discuss`) and the UI
moved idle → "Connecting…" (`ios-08`). Then the WS closed at 0.8s having captured
**zero** audio. There is no captured frame for a *listening / "go ahead, I'm
hearing you"* state, and none for *session ended* or *I heard nothing — try
again*. On a voice surface the user's whole contract is "can I tell what phase
we're in?" — and here Connecting… resolves into silence.
- **Violates:** Nielsen #1, visibility of system status — the reflexive one for a
  voice product. **Listening must be distinguishable from connecting, replying,
  and failed**, or the user talks into a dead session and never learns it heard
  nothing. The screen is only a *secondary* cue, but on the phone-sat it is the
  *only* cue (no puck LED/chime here), so it has to carry all four phases.
- **Mental model broken:** the user believes "I held, it connected, it's
  listening." Reality: it captured 0 chunks and closed. The gulf of evaluation is
  total.
- **Fix shape:** a distinct **listening** state (mic-live affordance + "I'm
  listening") once the session opens, and an explicit **terminal** state on close
  — "Heard nothing — hold and speak again" on a 0-chunk close, "Done" on a normal
  end. Never let Connecting… decay silently to idle.

### 3. `ios-05` (first landing) vs `ios-07` — a net-new user has no path to talk. [severity: high]
First landing is the **Voices** catalog + a conversation list. Neither pane
offers a talk affordance. The TalkButton ("Talk to voix", `ios-07`) lives *inside*
a conversation — and per the §note you only reach it by "tapping an existing
history entry." A brand-new user has **no history**, and the one button that
would mint a conversation is dead (F1). So the path from "I want to talk" to a
talk button is: pick a voice → … → nothing.
- **Violates:** JTBD / gulf of execution (Christensen; Cooper goal-directed). The
  user hired voix to *speak through it*; the landing makes them *administer a
  catalogue* first — exactly the "settings panel with a mic bolted on" failure.
- **Fix shape:** the Voices landing (or a persistent dock) needs a primary "Talk"
  affordance that opens a session in the active voice without first requiring a
  conversation to exist. Selecting a voice should be able to *start talking*, not
  just arm a future session.

### 4. `ios-05` — modes are rendered as activate-rows with a single global ACTIVE binary, and "NOW · puck-1" assumes the user is acting on the puck (they're on the phone). [severity: high]
The Voices list is a vertical stack of rows, each with a colour dot, a name, a
one-line description, and an **"Activate"** button; "Realtime" alone carries an
**ACTIVE** badge. That's the settings-list shape, not a portrait gallery — and a
single global active/Activate binary. Worse, the top strip reads "NOW · puck-1 ·
Realtime", but the log says this surface is `kind=phone-sat`. So when the user
taps "Activate" on, say, Dictation, **which surface does it apply to** — the
puck named in the strip, or the phone they're holding?
- **Violates:** the brief's per-surface active-mode model (design-brief §7) and
  intent-over-target. Norman mapping: the control's effect-target is ambiguous.
  Red flags: "Activate as a global binary" and "a NOW · device · mode strip that
  assumes one device."
- **Fix shape:** make active-mode **per-surface** — each voice shows "in use on:
  ‹surfaces›" rather than one global ACTIVE; the row's primary action picks the
  voice *for this surface*. Drop the single-device NOW strip in favour of a
  per-surface indicator (this phone-sat is its own peer).

### 5. `ios-05/06/07/08` — the phone shows a permanent two-column iPad/desktop split; two navigation contexts compete on a one-thing-at-a-time surface. [severity: med]
Every main-app screen renders a fixed left **conversation sidebar** ("+ New
conversation", TODAY, "Kitchen quick chat") *beside* the content pane (Voices /
Conversations). That's a master-detail idiom for a wide canvas. On a phone the
user's model is *one focus at a time, drill in and back* — here they get a
squeezed desktop layout where neither column is fully usable and the active
context is unclear (am I navigating history or picking a voice?).
- **Violates:** Norman conceptual model / mapping; IA mismatch to the surface
  (the screen *is* a primary channel on a no-puck phone-sat, but its structure is
  borrowed from a surface with twice the width).
- **Fix shape:** collapse to a single-column phone layout — conversation list as a
  push/drawer, content full-width — so one context owns the screen at a time.
- *The text truncation this causes ("Talks back. Knows…", "ACTIV[E]", "puck-1 ·
  Realtime" clipped) is a pixel/layout consequence → Marina.*

### 6. `ios-05` — "Realtime" as a voice name is the transport's name, not a way of sounding. [severity: med]
Among the voices — Dictation, Message, Email, Note (all portraits of *how the
output reads*) — "Realtime" stands out as the name of the OpenAI Realtime API
transport, not a register the user chose. The log confirms the user's intent is
`discuss` (`voice_id=default-realtime`): they picked *talk-it-through*, and the UI
labels that "Realtime."
- **Violates:** Nielsen #2 (match between system and the real world) and the
  brand's no-SRE-jargon rule. A voice is a portrait; "Realtime" is plumbing.
- **Fix shape:** name the discuss voice for what it does to the user — "Discuss" /
  "Conversation" / "Talk it through." Keep `default-realtime` as the internal id.

### 7. `ios-07` — per-turn latency badges ("7 ms", "9 ms", "8 ms") and an unexplained "shaped" tag leak telemetry into the conversation history. [severity: med]
Each conversation entry shows a millisecond figure beside the timestamp, and one
entry carries a bare "shaped" tag. A user reading their own history does not care
that a turn took 7 ms — that's an engineer's debug column sitting in a
user-facing list, and "shaped" names an internal concept with no glossary.
- **Violates:** Nielsen #2 (real-world language; show what the user needs, not
  what the system measures).
- **Fix shape:** drop latency from the user-facing row (keep it in a debug view if
  needed); either explain "shaped" in the user's terms or remove it.

### 8. `ios-07/08` — "Hold to talk to voix" doesn't adapt to discuss-vs-dictate, and "hold the whole time" contradicts a back-and-forth conversation. [severity: med]
The hint is fixed at "Hold to talk to voix." M23 specced the hint to switch on
`voice.type`. For the `discuss`/realtime default, the killer model is a *two-way
conversation* — but "hold the whole time" is the dictation/walkie-talkie gesture,
which conflicts with voix talking *back* to you. Hold-to-talk is right for
*dictate*; for *discuss* the user expects tap-to-open-the-session.
- **Violates:** Norman affordance/signifier (the gesture the copy teaches doesn't
  match the interaction the voice actually wants); intent semantics (discuss vs
  dictate).
- **Fix shape:** drive the hint and gesture off `voice.type` per M23 — hold-to-talk
  for dictate voices, tap-to-start / tap-to-end for discuss/realtime voices. Verify
  the default discuss voice gets the conversational variant, not the dictation one.

### 9. `ios-03/04` — the onboarding page indicator shows only one visible dot; the user can't tell "step 2 of 3" or how many remain. [severity: low]
A single blue dot is the only progress marker on the mic and connect steps. The
user has no sense of "how far into setup am I / how much is left" — a small gulf
of evaluation on a multi-step flow.
- **Violates:** Nielsen #1 (visibility — where am I in the sequence).
- **Fix shape:** render all three dots with the inactive ones visible.
- *If the inactive dots exist but are drawn at near-zero contrast, the fix is a
  contrast value → Marina. I can only say the user can't tell their position.*

### 10. `ios-04..08` — "Open debugger to view warnings" dev toast sits over the bottom nav. [severity: low]
A persistent RN dev-overlay obscures the bottom of every main-app screen and
speaks pure engineer ("debugger", "warnings"). Almost certainly a debug-build
artifact that won't ship — flagging so it isn't mistaken for product chrome, not
weighting it as a real finding. If it *can* appear in a release build, it's a
Nielsen #2 jargon leak; otherwise ignore.

---

## Net

The setup flow is genuinely good (interruption-tolerant, escape-hatched, live
connection feedback) and the axis is named right (Voices/Surfaces). The product
breaks at the two moments that matter most: **you can't start a conversation on a
phone (F1), and once a session does start you can't tell whether voix heard you
(F2)** — the killer flow has a dead front door and a blind status channel.
Disposition is the coordinator's.

---

## First-five-bullets verification (soul §5)

Re-reading F1–F5, asking of each: *could a generic LLM that never read my soul
have written this?*

1. **F1 (dead +New button):** the bare bug ("button does nothing") is generic — but
   my framing isn't: AX-label evidence that it's bound to `⌘N` (a key the
   phone-sat lacks), framed as the gulf-of-execution front door to the killer
   flow. Named lens, surface-specific reasoning. **Pass (rewritten to carry the
   lens, not just the bug).**
2. **F2 (no listening/terminal state):** Nielsen #1 voice-first, the
   listening-vs-connecting-vs-failed distinction, screen-as-only-cue on a no-puck
   phone-sat, tied to the `0-chunk close` log. A generic pass says "add a loading
   state"; this names the four phases a voice surface must show. **Pass.**
3. **F3 (no talk path on landing):** JTBD + gulf of execution + the net-new-user
   dead-end (no history → no TalkButton). Voix-specific flow reasoning. **Pass.**
4. **F4 (activate-binary / per-surface / NOW-puck mismatch):** design-brief §7
   per-surface active-mode, intent-over-target, two named red flags, the
   phone-sat-vs-puck mapping ambiguity. Could only be written about this product.
   **Pass.**
5. **F5 (iPad split on iPhone):** "not responsive" is generic — so I framed it as
   the IA/mental-model violation (two competing nav contexts on a
   one-focus-at-a-time surface) and handed the truncation pixels to Marina.
   **Pass (rewritten to the mental-model lens).**

0 of 5 land as generic after rewrite. F1 and F5 were the risks and were reframed
to their named lenses rather than left as bug/responsiveness notes.
