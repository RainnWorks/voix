# voix · Design brief: from single-device to multi-surface

**Audience**: a designer (or design-capable AI) being handed the next
iteration of the voix product UI. You don't need to know the codebase.
You need to understand where the product has been, the brand it has
settled on, and the directional shift that just happened so the next
design lands in the right place.

**Status**: as of 2026-05-28, the just-shipped UI is brand-correct but
*architecturally puck-centric*. It assumes a single Voice PE puck as
the only place users speak to voix. That assumption is now wrong, and
this brief explains how the model has to change.

---

## 1. What voix is

voix is a personal voice assistant with three properties that
distinguish it from off-the-shelf assistants like Alexa, Google
Assistant, Siri, or Home Assistant's stock voice pipeline:

1. **You define the modes.** A "mode" is a named preset of {prompt,
   model, voice, behaviour, look}. You might have a *Realtime* mode for
   conversation, a *Dictation* mode for writing prose, an *Email* mode
   that rewrites your raw speech into a polished business email, a
   *Code* mode that handles technical voice notes. The product is
   built around the user shaping these themselves.
2. **Your data is yours.** It runs on the user's Home Assistant
   install. OpenAI Realtime is the speech path; OpenAI/OpenRouter chat
   completions are the post-processing path. Transcripts and recordings
   stay on the user's HA host. No SaaS, no telemetry.
3. **Context comes from home assistant + your devices.** The model is
   given a snapshot of relevant HA entities (lights, sensors,
   calendars, todo lists) plus context from whichever surface you
   invoked it from, via an MCP-style registry.

The current physical product is the Nabu Casa **Voice PE** ("the
puck") — a small wake-word-listening device with a mic array, speaker,
LED ring, and ESP32-S3 brains. It sits on a desk or shelf. You say its
wake word; it listens; voix responds. The puck has been the only
surface up to this point.

That changes now.

---

## 2. Modes are how you sound, not just what voix does

The product is not "a voice assistant with a few preset behaviours."
It is "a tool that turns your raw voice into output that sounds like
you, appropriately calibrated for the context you're aiming at."

That distinction matters for design. A mode card is not a settings
tile. It is a small portrait of one of the voices the user wants
themselves to be able to speak in.

### What a mode actually does

Concretely, a mode is a transformation:

```
raw spoken audio  →  STT transcript  →  LLM post-process w/ mode prompt  →  output
                                        (or a realtime stream)
```

The mode prompt is where the user's *voice* lives. It says:

- who the assistant is (or whether there's one at all)
- what register the output should land in (sweary kitchen-table /
  warm-but-professional / corporate-with-a-smile / Instagram-cap /
  Twitch-chat-reply / etc.)
- what shape the output should take (single paragraph / bullet list /
  email with subject + body / a chat reply under 200 chars)
- what *not* to do (don't add a signature, don't open with "Hey
  there", don't apologise, don't use em dashes)

The raw input is freeform. The user can ramble, swear, repeat
themselves, change their mind mid-sentence, or speak as if
vent-typing to a friend. The mode is what does the work of turning
that into something a recipient can read.

### Personal mode examples (real, not illustrative)

The user we're designing for has these in mind for himself, today:

- **Email** — input: ranty voice note about why a vendor missed a
  deadline. Output: a professional email that holds the line without
  burning the relationship, in his usual writing voice (slightly
  British, dry, ends with "Cheers,").
- **Facebook Messages** — input: same kind of raw note. Output: how
  he actually talks to friends — lowercase, no apologies for typos,
  two emoji max, lands in 3-4 short sentences.
- **Marketing copy** — input: idea for a product post. Output: brand
  voice (specifically: Voix's brand voice — Instrument Serif energy,
  not corporate bullet points).
- **Twitch chat replies** — input: streamer's running commentary on
  what someone said in chat. Output: a reply that fits the chat
  register (short, in-jokes intact, capitalised right).
- **Realtime** — no transformation. Just a back-and-forth conversation
  with the model.
- **Dictation** — raw transcript with light cleanup (filler words,
  punctuation). No personality transform.

The product becomes interesting at scale because **everyone's modes
look completely different**:

- A copywriter has *Tone of voice for client X*, *Tone of voice for
  client Y*, *Press release draft*, *Pitch email*.
- A streamer has *Twitch reply*, *YouTube comment reply*, *Discord
  community post*, *Sponsor outreach*.
- A developer has *Code voice note*, *PR description from the change
  I just made*, *Bug report*.
- A parent has *School email*, *Group chat with the other parents*,
  *Note to the babysitter*.
- A marketing person has *Instagram caption*, *LinkedIn post*,
  *Brand-voice-for-this-product-line*.

Modes are the personality layer of the product. They are also the
moat: a user who has spent an evening tuning four modes to their
own voice is no longer a flight risk to a competing tool.

### The "I can swear at it" property

This is the thing that makes voice-as-input actually usable for real
life, and it's a deliberate design property the user keeps coming
back to.

The promise:

> "I can talk to it however I want — annoyed, half-formed, swearing,
> rambling — and the right mode rotates that into something that
> actually sounds good for the context I'm in."

Voice notes are *high-bandwidth, low-precision*. People speak twice
as fast as they type but with much messier structure. Most voice
tools shame this — they show you the raw STT transcript and you
cringe at how unhinged you sound. voix's mode prompt is the safety
net: the user gets to be unfiltered into the mic and the *output*
still lands appropriately.

This has implications for the design language:

- The mode editor should encourage prompts that capture **how the
  user wants to sound**, not "instructions for the model." Placeholder
  text and example prompts should reflect this — "Write this as me
  emailing a vendor I'm annoyed with but still want to work with"
  beats "Rewrite the user's input as a professional email."
- The mode card should communicate **personality**, not function.
  A quote-styled snippet of the mode's tone; the 12-colour swatch;
  the puck. The colour is *not* just a category tag — it's the user
  saying "this is the colour Email-Tom wears."
- The empty-state for the mode list shouldn't be "Create your first
  mode" with a generic icon. It should be "What's one way you want
  voix to make you sound?" with concrete starter examples lifted
  from this list.
- The "+ New mode" affordance should be a real first-class thing,
  not buried in a settings menu. **Creating modes is using the
  product**, not configuring it.

### Why this matters for the multi-surface shift

The mode is where the user lives. The surface is plumbing.

This reframes the multi-surface story in a way that makes the design
work easier:

- A surface picks up the modes that fit its capabilities (the iOS
  keyboard surfaces dictation-class modes; the puck surfaces
  realtime + voice-out modes; the Mac menu bar surfaces everything).
- The user *carries their modes between surfaces*. They tuned
  "Facebook Messages" once; it works the same way whether they're
  speaking into their phone, their Mac, or their puck — as long as
  the surface can deliver text into a focused field somewhere.
- The cross-surface continuity story isn't "the same chat session
  persists across devices" (cute but rarely useful in practice).
  It's "your **voice presets follow you**." Much more valuable, and
  much more achievable.

A specific consequence: when redesigning the mode list to handle
multi-surface, **don't lean into surface-as-the-primary-axis**.
Surfaces are how you get to the modes. The modes are the thing.
A grid of mode cards with "in use on: puck, Mac" chips reads
correctly. A grid of surfaces with "current mode: Email" reads
backwards.

---

## 3. The killer flow: discuss, then output

This is the most important insight in the brief and it's been
implicit until now. The actual product value isn't the two flows
we've been treating as discrete (Realtime for conversation, Dictation
for one-shot output). It's the **combination**: a realtime
conversation that ends with a polished artifact.

The old framing:

- **Dictation** mode = monologue → output. One-shot. The user gets one
  pass. No iteration. No thinking.
- **Realtime** mode = open-ended back-and-forth. No artifact. Just
  talking.

The unlock — the thing that makes voix actually compelling, the thing
nobody in the voice-tools market is shipping well — is:

> **Realtime conversation about what you're trying to write, followed
> by a consensual "OK, produce it" moment, followed by the polished
> artifact.**

People type when they already know what they want to say. People
talk when they're thinking out loud about what they want to say. The
current voice-tools market mostly serves the first case (faster
typing). voix serves the *second* case — the messier, more valuable
one — because it has the realtime model to *think with* and the
output model to *land the result*.

### A concrete example (the one the user reached for)

Tom is on his iPhone. He needs to reply to Sarah on Facebook
Messenger. He's annoyed. He invokes voix on the iOS keyboard:

> **Tom**: "I need to reply to Sarah. She's been a bitch about the
> birthday thing. I don't want to be mean but I want to make it clear
> she crossed a line."
>
> **voix** (realtime, conversationally): "What did she actually do at
> the birthday?"
>
> **Tom**: "She told everyone I forgot, but I messaged her three weeks
> before and she said she couldn't make it. Now she's making it sound
> like I'm the asshole."
>
> **voix**: "Got it. Do you want to address the original
> miscommunication directly, or just deflect this current accusation?"
>
> **Tom**: "Address it. I've got the receipts."
>
> **voix**: "Want me to write a reply that names the original message
> without sounding defensive?"
>
> **Tom**: "Yeah, do it."
>
> **voix** (calls `produce_output` tool; the output lands in the
> Messenger field):
>
> > "hey, just checking back — I sent you a message on the 14th about
> > the birthday and you said you couldn't make it. happy to share the
> > screenshot if it helps clear things up x"

Three things to notice:

1. The conversation phase let Tom *think out loud* about what he
   actually wanted to say. He landed on the strategy ("address it,
   don't deflect") through back-and-forth, not by writing it.
2. The model asked clarifying questions — extracted the receipts,
   the tone, the intent. This is the realtime model's strength.
3. The output is a single artifact, in Tom's voice (he has a
   "Facebook Messages" mode that codes for lowercase + "x" sign-off
   + no apologies). It lands in the field, ready to send. No editing
   round.

This is **the product**. Everything else is plumbing in service to
this loop.

### The architectural pattern: phases + a handoff tool

A session has phases:

1. **Discuss** — open realtime conversation. The model asks
   clarifying questions, the user thinks out loud, they iterate on
   what's being said.
2. **Confirm** — a moment where one party says "OK, that's what we
   want." Either the model offers ("shall I write it now?") or the
   user signals ("yeah, do it" / "produce it").
3. **Output** — the realtime model calls a `produce_output` tool. The
   tool takes the entire conversation, the originally-stated intent,
   and the context bundle (HA + surface, §5) and runs the mode's
   *output prompt* to produce the artifact via the post-process model.
4. **Deliver** — the artifact lands appropriately for the surface:
   pasted into the focused field (iOS keyboard, Mac), spoken aloud
   (puck), saved to a transcript file, or shown in the web UI.

The user can short-circuit straight to output ("just write the email,
don't make me talk it through"). And modes can have only one phase:
pure dictation has no Discuss; pure conversation has no Output.

The *interesting* modes have both.

### What this means for the mode model

The current `type: "realtime" | "dictation"` field is the wrong
shape. The right shape is closer to:

```
mode.flow: {
  conversation?: { prompt, voice, model }     // optional realtime phase
  output?:       { prompt, provider, model }  // optional artifact phase
}
```

- A pure **dictation** mode is `{ output: {…} }` — no conversation.
- A pure **realtime** mode is `{ conversation: {…} }` — no artifact.
- The **killer flow** is `{ conversation: {…}, output: {…} }`.

Today's mode editor has two separate conditional UI branches
(`mode.type === "realtime"` vs `=== "dictation"`). The redesign
collapses this: every mode editor shows two panels, and the user
chooses to fill in one, the other, or both. The panels should be
labelled intuitively so the user isn't reading documentation about
phases:

- "When we're talking" → the conversation prompt
- "When I'm done" → the output prompt

### What this means for the UI

A few concrete asks of the redesign:

1. **The mode card should hint at the flow shape.** A small visual
   cue showing whether this mode is talk-only, output-only, or
   talk-then-output. (Not literal emoji — design something on-brand
   that fits next to the puck.)
2. **The mode editor wants two prompt panels.** "When we're talking"
   (conversation prompt + voice + realtime model) and "When I'm
   done" (output prompt + provider + post-process model). Either
   can be empty.
3. **The session UI needs a "produce it" affordance.** During a
   conversational session, the user needs an obvious way to signal
   "we're done, write it." The model also needs to be able to ask
   "shall I write it now?" before doing so. On surfaces with a
   screen (Mac, iOS, web), this is a button. On the puck, it's
   voice-only — the model proposes, the user confirms ("yes" / "do
   it"), the puck plays the output back (or surfaces it to a paired
   screen).
4. **The conversations screen should show the phase transitions.**
   "Discussed for 4 min 12s → produced output → 312 chars." Plus the
   discussion transcript AND the artifact, presented side-by-side or
   sequentially. This is how a user understands *why* the output
   came out the way it did.

### Why this matters for surfaces

The iOS keyboard case in §5 is *only useful* because of this loop.
The user doesn't want to dictate a one-shot reply into Messenger;
they want to *think about how to reply* — using the visible thread
above the keyboard as live context — and then have voix produce
the polished version. The "discuss then output" pattern is the iOS
keyboard's main reason to exist.

Same on the Mac for emails: "Hey voix, I need to reply to this email
from the vendor — they missed the deadline and I'm pissed but I want
to keep the relationship. Let me talk it through." Discussion, then
the artifact pastes into Mail. The Mac surface gets context from the
focused window (the email being replied to), the user gets to
*reason out loud* via realtime, and the output mode produces the
reply.

The "discuss then output" flow is what makes the multi-surface story
*valuable*, not just *available*.

---

## 4. Where we have been

### Phase 1 — HA custom integration (abandoned)

voix originally lived as a Home Assistant custom integration. HA hosted
the pipeline: STT, the OpenAI realtime client, post-processing,
transcript storage. Modes were stored in HA's config entry options.
The puck talked to HA via the standard voice-assistant API.

This was wrong for many reasons that compounded over many sessions:

- **HA pins its dependencies** (httpx version, OpenAI SDK version,
  Python version). We hit conflicts trying to use the official OpenAI
  Realtime SDK because HA was on an older httpx.
- **HA's log buffer is a 100-line ring**, default level WARN. Useful
  diagnostics from a 30s voice session would roll off before you could
  read them. We had to use `_LOGGER.warning(...)` for *everything*.
- **HA restarts on every config-flow change**, which killed in-flight
  voice sessions. Adoption pushes (telling the puck its server URL +
  token) had to happen *after* a load order that the integration
  framework didn't guarantee.
- **HA owns the lifecycle**, not us. We can't crash-recover, can't
  control startup, can't easily attach a debugger.

### Phase 2 — Standalone daemon as HA Add-on (current)

We moved the brain out of the integration into a standalone Bun
daemon, packaged as an HA Add-on. The HA integration shrinks to a thin
adoption layer that tells the puck where to connect.

Stack:
- **Runtime**: Bun + Elysia + TypeScript strict
- **Storage**: JSON on `/data/voix/` (HA Add-on data volume)
- **HA bridge**: Streamable HTTP MCP at `/api/mcp` via Supervisor proxy
- **UI**: React + react-native-web (RN component primitives in browser
  via vite alias) served at the add-on's ingress port
- **HA Add-on shell**: `ingress: true` puts the UI inside HA's chrome
  at *Settings → Add-ons → voix backend → Open Web UI*

The crucial bit for design: **the daemon is the brain, not HA**. HA is
a sensor — one of many context sources. The UI we ship is the daemon's
UI, accessed through HA's chrome but architecturally independent.

### Phase 3 — Brand-correct UI (just shipped, the thing you're iterating on)

The first UI was generic Material-ish. The user (a designer himself)
rejected it: "really need to redesign that. Like. Really bad."

We then built two brand guides that **diverge intentionally**:

- `voix-brand-guide.html` — the **marketing** brand. Cream paper
  (#FAF8F3). Instrument Serif display, Hanken Grotesk body. HA blue
  (#03A9F4) as a rare accent. This is the website, the landing page,
  the docs site. Voicey, romantic, hand-set.
- `voix-desktop-guide.html` — the **desktop app** brand. *Deliberately
  sober*. System fonts only (SF Pro on macOS, Segoe UI Variable on
  Windows). JetBrains Mono for technical labels and timestamps.
  System accent (#007AFF on macOS) for sidebar selection and focus
  rings. HA blue ONLY for "Voix moments" — the puck centre, status
  pills, the VOIX speaker tag, the active-mode indicator. **Never put
  HA blue in chrome.**

The split exists because the user model is different: the website
must seduce a stranger; the app must disappear into the OS so the user
can use it daily without visual fatigue.

The just-shipped UI implements the desktop brand:

- **Sidebar layout**: titlebar with the wordmark + puck glyph, sidebar
  with three sections (Conversations / Modes / Devices), main pane.
- **Mode list**: card grid. Each card has the brand puck glyph at 44px
  in the mode's colour. There's a "NOW · device · mode" strip at top
  with HA-blue background showing the current state. Active mode card
  has a 2px HA-blue border + ACTIVE pill. Non-active cards have an
  Activate button.
- **Mode editor**: 56px puck preview, inline name + description
  (click-and-type, autosave on blur with "Saved" / "Saving…"
  indicator), 12-swatch picker (the user picks from a fixed palette,
  not arbitrary hex), settings rows for voice/model/STT/post-process.

### The 12-colour mode palette

This is the desktop brand's only intentional exception to "use system
accent for chrome, HA blue for voix moments, nothing else." Modes are
*personal*; the user wants their *Email* mode to feel different from
their *Realtime* mode at a glance. So they get 12 swatches to choose
from:

- **6 saturated**: HA blue (#03A9F4), Amber (#F59E0B), Violet (#7C3AED),
  Green (#10B981), Coral (#F43F5E), Magenta (#D946EF)
- **6 soft**: Sky, Lemon, Lavender, Mint, Peach, Slate

Legacy modes with arbitrary RGB get snapped to the nearest swatch via
a `nearestSwatch()` helper. Custom hex input is not allowed — the
palette is the rail.

### The puck glyph

The brand puck — an ink-coloured rounded square (22% border radius
of the side) with an HA-blue (or mode-coloured) circle centered at
35% of the side — is the recurring visual identity. It appears at
multiple sizes:

- 14px in the wordmark
- 11px next to the "Modes" sidebar item
- 44px on each mode card
- 56px in the mode editor identity row

Proportions are locked. It is the thing that says "voix" without
words.

---

## 5. The directional shift (the reason you're being briefed)

The puck has been the only surface. That is changing.

The user wants voix to feel native on **whatever surface they happen
to be using**. The puck is one of those surfaces, not the privileged
one. The roadmap surfaces are:

| Surface | Form | Trigger | Input | Output |
|---|---|---|---|---|
| **Voice PE puck** | hardware device | wake word | mic array | speaker + LED ring |
| **macOS menu bar app** | always-running OS app | global hotkey | mic | system audio + paste to focused app |
| **iOS keyboard extension** | replaces stock keyboard | tap button in keyboard | iPhone mic | text into focused field; no audio out |
| **Web client** (HA add-on UI itself) | browser tab | click in-app button | browser mic | browser audio |
| **future**: Android, watchOS, in-car CarPlay/Auto, smart-glasses | TBD | TBD | TBD | TBD |

These all talk to the **same daemon** running on the user's HA host.
They all use the **same modes** the user has defined. They all share
the **same conversation history**, the same recordings, the same
context sources.

This isn't multi-device-as-replication. It's multi-surface-as-input.

### What this breaks in the current design

**The "Activate" button on the mode card.** Today it means: "set this
as the puck's mode." With multiple surfaces, the question is *Activate
on what?* — and there's no obvious singular answer.

**The "NOW · device · mode" strip.** It assumes one device. With many
surfaces, you might have *Realtime* active on the puck, *Dictation*
default on the Mac, *Email* as the iOS keyboard's last-used.

**The "Devices" sidebar item.** It implies physical devices in the IoT
sense. The new mental model is *surfaces*: input/output channels the
user can speak to voix through, only one of which is a physical
device.

**Mode applicability.** Some modes don't make sense on some surfaces.
*Realtime* mode (back-and-forth conversation) needs an audio output;
on an iOS keyboard there's no speaker context, so the model's spoken
reply has nowhere to go. *Dictation* mode pastes text; on the puck
there's nothing to paste into. Modes need to declare which surfaces
they target, or surfaces need to filter the mode list by capability.

### What this preserves

- The **brand**. System fonts, sober palette, 12-colour mode swatches,
  puck glyph, HA-blue as accent for voix moments only. The just-shipped
  visual language is right. Keep all of it.
- The **mode catalog as a global concept**. Users define modes once;
  they're available everywhere they speak.
- The **conversation history as global**. A session started on the Mac
  and continued on the puck is *one* conversation. (We don't have
  cross-surface session continuity yet, but the storage layer assumes
  it.)
- The **daemon as the brain**. All surfaces are thin clients that ship
  audio + context to the daemon over WS.

---

## 6. Every surface is also a context gatherer

A subtle but important property the existing daemon already supports,
and the UI does not yet expose: **surfaces are not just input/output
channels. They are also context sources.**

The daemon has an MCP-style context registry. When a session starts,
the daemon asks every registered source: "what do you know about the
user right now that might matter for this session?" The result gets
folded into the LLM's prompt before audio starts flowing.

Today there are two sources wired in:

- **Home Assistant** (via the HA MCP server at `/api/mcp`) — entity
  states, todo lists, calendars, persons. The daemon's HA source is
  a thin MCP client.
- **voix builtin** — a small source for session-control tools like
  `voix.end_session`.

The roadmap is for **every surface that runs voix code to also be a
context source**. A surface's manifest declares both *what audio it
can capture/play* (input/output capabilities, §4) and *what context
it can offer* (sources).

### What each surface can plausibly contribute

| Surface | Context it can offer |
|---|---|
| Home Assistant host | Entities, sensors, todo lists, calendars, persons (already wired) |
| Voice PE puck | Its physical room ("kitchen" / "office"), recent HA events near it, ambient state |
| macOS menu bar app | Focused app + window title, frontmost document path, selection text, recent clipboard, Claude Code project root if open, focused Slack thread, calendar busy state |
| iOS keyboard | Which app the user is typing into, recipient name in a DM, conversation history visible above the field, the current iMessage/WhatsApp/Messenger thread, the field's hint text ("Tweet your reply…") |
| Browser web client | Current tab URL, page title, selected text |

The point: the *same mode prompt* lands very differently depending on
what context surrounds it. "Reply to this thread in my voice" is a
useless instruction without thread-context; it's a magic instruction
with it.

### Modes are opinionated about which sources to pull

Two real examples that drive this:

- **Living-room puck, Realtime mode** → mostly Home Assistant context.
  The user is probably asking voix to control the house, check on
  things, list reminders. Pull HA hard. Skip Mac/iOS sources — the
  puck isn't near them, and the prompt budget is finite.
- **Office puck, Realtime mode** → mostly Mac context. The user is at
  their desk; they're asking about work. Pull Mac (focused app,
  current Claude Code project, calendar) hard. HA context is still
  available but lower-priority.

Same hardware (puck), same mode type (Realtime), totally different
context profile. This is configurable per-mode.

There are three ways the user could shape this, in increasing order
of UI surface area:

1. **Implicit, surface-defaulted.** Each surface has a default
   context profile baked in. The office puck is configured at setup
   time as "work-leaning." The user never thinks about it again.
2. **Per-mode, explicit.** The mode editor has a "Context sources"
   panel. The user picks which sources this mode pulls. *Email* mode
   pulls Mac (focused app for tone-matching). *Home* mode pulls HA
   only. *Code voice note* pulls Mac (focused project, recent git
   diff). The mode itself declares its appetite.
3. **Per-(mode × surface), explicit.** *Realtime mode on the office
   puck* pulls one set of sources; *Realtime mode on the kitchen
   puck* pulls a different set, despite being "the same mode."

(3) is the most powerful and the most overwhelming. (1) is invisible
and won't satisfy power users. (2) is probably the right default —
a mode declares its context appetite, surface-level overrides exist
for power users but stay out of the way.

### The iOS keyboard is where context-grabbing gets exciting

The iOS keyboard is the surface where this idea has the most
upside, because the user is *already inside* the destination app
when they invoke voix:

- Replying to a DM in Messenger → the keyboard knows: it's Messenger,
  contact name X, here's the visible thread above the field. The mode
  prompt can land *as a reply in this specific conversation*.
- Composing a tweet → keyboard knows: it's Twitter/X, 280-char limit,
  here's the post being quote-tweeted.
- Writing an email in Mail → keyboard knows: it's Mail, here's the
  To/Subject/thread.

A single *Reply in my voice* mode does the work of five
context-specific modes because the keyboard provides the context
dynamically. This is the killer-app shape for iOS. The design should
sell that promise — under "Reply / Message" example prompts, the
copy should hint at the dynamic-context magic, not ask the user to
specify Messenger-vs-Twitter-vs-Mail by hand.

### What this means for design

A few concrete asks of the redesign:

1. **The mode editor needs a "Context" section.** Either always-on
   (with sensible defaults pre-selected per mode type) or revealed
   under an "Advanced" disclosure. Lists the *registered* sources
   (HA, Mac, iOS keyboard, etc.) with toggle + importance hint.
   Sources only show up when the daemon knows about them — a user
   without a Mac surface registered doesn't see Mac.
2. **The Surfaces screen should show what context each surface
   offers**, not just what audio it captures/plays. A surface card
   reading "Provides: focused app, window title, recent clipboard,
   Claude Code project" reads as a real first-class actor in the
   system, not a dumb microphone with a speaker.
3. **The mode card might hint at context appetite.** A small row of
   source-dots under the puck (HA-dot, Mac-dot, iOS-dot) could
   telegraph what this mode pulls. Helps the user see at a glance
   why *Office-Realtime* and *Home-Realtime* are different modes
   even when their prompts look similar.
4. **The session lifecycle needs a "context receipt" affordance.**
   Today's UI doesn't show what context was injected into a session.
   For trust and debuggability, the user should be able to see "for
   this session, voix knew: it was 3:42 PM, you were in Slack DM
   with Alice, your living-room light was on, your next calendar
   event is in 12 mins." This belongs on the Conversations screen.

### Why this matters for the trust model

Voice is intimate; context can feel invasive. The user needs to be
able to see *what voix knew about them* during any given session —
not as a privacy tax, but as a calm receipt: "here's what I had on
me when you spoke." It also makes the product *more* compelling. The
user sees how rich the input was, which makes them understand why
the output landed so well. Context is the secret behind the magic;
showing it (legibly, beautifully) is part of the brand.

---

## 7. Concepts to design around

### A mode is intent, not target

Re-frame what a mode means. A mode is the user's *intent*:
- "I want a back-and-forth conversation" → Realtime
- "I want to transcribe a long ramble into prose" → Dictation
- "I want to rewrite my ramble as a business email" → Email
- "I want a quick voice memo I'll review later" → Note
- "I want technical-sounding voice notes with code-friendly post-processing" → Code

The *surface* is the input channel — where the audio comes from. A
mode is *not* "set on" a surface; a mode is *what the user wants to do
this time*, and any capable surface can carry it out.

### "Active mode" is per-surface, not global

Each surface remembers the user's last-used mode (or has a default).
That's what the surface boots into.

- Puck: wake-word triggers the puck's last-used (or NVS-stored) mode.
- Mac menu bar: hotkey opens with the Mac's last-used mode; you can
  switch with another hotkey or in the popup before speaking.
- iOS keyboard: opens to the keyboard's last-used dictation-class mode
  (it can't realistically host a Realtime mode).
- Web client: a dropdown in the UI lets you pick.

The mode catalog UI then shows: "this mode is in use on [puck], [Mac],
[iOS keyboard]" — a chip set, not a binary ACTIVE pill.

### A surface has capabilities

A surface declares what it can do. The mode catalog filters/sorts by
relevance to the surface the user is browsing from.

```
Surface capabilities (sketch):
  - audio_in: bool       (does it capture mic?)
  - audio_out: bool      (does it play sound?)
  - text_paste: bool     (can it paste to a focused field?)
  - hands_free: bool     (wake-word vs button-triggered)
  - display: bool        (can it show streaming transcript?)
  - background: bool     (does it run when not focused?)
```

A puck has `audio_in: yes, audio_out: yes, text_paste: no,
hands_free: yes, display: no, background: yes`.

An iOS keyboard has `audio_in: yes, audio_out: no, text_paste: yes,
hands_free: no, display: yes, background: no`.

A Realtime mode requires `audio_out` to be useful. A Dictation mode
requires `text_paste` (or at minimum, display) to deliver value.

### Mode editor doesn't change much

The mode editor is still the right shape: identity row + colour
picker + system prompt + post-process settings. What changes:

- Add a "Surfaces" row showing which surfaces have this mode set as
  default + a small chip set you can toggle. *Or* don't — let the
  surface itself decide what to expose, and keep the editor about the
  *content* of the mode.
- The "compatibility" filter probably belongs to the surface picking
  the mode, not the mode editor.

---

## 8. Screens to redesign

### The mode list

Today it's a card grid with one ACTIVE pill on one card and Activate
buttons on the rest. It needs to become:

- A grid that shows for each mode where it's currently in use — a
  small chip set ("puck", "Mac", "iOS kbd") instead of one ACTIVE pill.
- A *per-surface* control somewhere (probably the "NOW" strip at top)
  that lets you set the current mode for the surface you're viewing
  the UI on. So if you opened the UI on your Mac, the strip might
  show "MAC · Dictation" with a dropdown to change.
- The "Activate" button per card may go away entirely. Or it may
  become a contextual menu: "Set as default on… [picker]".

Open question: do we let the user set a mode as default for *another*
surface from the desktop UI? Probably yes — the desktop UI is the
admin console. Worth thinking about how that interaction reads.

### The sidebar

Current: Conversations / Modes / Devices.

Suggested: Conversations / Modes / **Surfaces**. The "Devices" name
implies IoT; "Surfaces" is the concept we actually mean.

### A new "Surfaces" screen

This replaces / extends the planned Devices screen. It lists every
surface the daemon has seen:

- Voice PE puck (your puck-095e4e)
- Mac (Tom's MacBook Pro) — connected / disconnected
- iOS keyboard (Tom's iPhone 17 Pro) — last seen 2h ago
- Web client — currently in this browser

For each: status, capabilities, default mode, last-used mode, recent
sessions. Per-surface settings live here (Mac hotkey, iOS keyboard
button placement, puck wake-word slot, etc.).

### A new "Conversations" screen

This was a placeholder in the just-shipped UI. It needs to be:

- A list of past sessions across *all* surfaces, dated, with the
  surface name and mode used.
- Click into a session to see the transcript and play the mic + speaker
  recordings (audio plays inline; today the daemon already stores
  per-session WAVs at `/recordings/`).

This screen is surface-agnostic by design — history is global.

### The wordmark + titlebar

Today the titlebar shows the wordmark and a window-controls
placeholder. Worth adding a surface indicator there too — "you're
viewing voix from your Mac" / "you're viewing voix from your iPhone".
Small, mono, top-right next to the connection dot.

---

## 9. Brand rules to preserve

Cannot stress this enough — the just-shipped visual language is good
and the user explicitly said so. Don't redesign the *look*, redesign
the *information architecture* and the *interaction model*.

Rules that hold:

- **System fonts only** for UI text. SF Pro Text/Display on macOS,
  Segoe UI Variable on Windows, system default on web. Never Inter,
  Geist, Manrope, Söhne, or any of the desktop's tempting alternatives.
- **JetBrains Mono** for technical labels (timestamps, model names,
  sample rates, section labels like "NOW", "ACTIVE").
- **No marketing brand fonts** (Instrument Serif, Hanken Grotesk) in
  the desktop app. Ever. They belong on the website.
- **System accent** (#007AFF on macOS, system Win11 accent on Windows)
  for sidebar selection, focus rings, link colour. Browser default
  focus rings stay — don't disable outlines.
- **HA blue (#03A9F4)** only for voix moments: puck centre, ACTIVE
  pills, the VOIX speaker tag, the wake-word listening state. Treat
  it like a costume the brand wears for a beat, then takes off.
- **12-colour mode palette** is the only other colour input. No custom
  hex. `nearestSwatch()` snaps legacy values.
- **The puck glyph** at every brand touchpoint. Proportions locked
  (ink squircle 22% radius, circle 35% of side, centered).
- **No nested cards.** Section borders are 0.5px hairlines. Surfaces
  are flat.
- **No em dashes** (the rule from the marketing guide — desktop is more
  flexible but punctuation should still feel hand-set, not stock).

Rules that *might* relax a bit for multi-surface:

- The "NOW · device · mode" strip can probably become richer (multi-
  row, or animated when surfaces hand off). Don't be afraid to use
  more vertical space if the information warrants it.

---

## 10. Open questions for design

These are real product decisions the user hasn't made. Surface them
as design proposals rather than asking — but flag the trade-offs:

1. **Does a "current" surface concept exist?** When the user opens the
   web UI from their Mac, is "Mac" implicitly the surface in focus, or
   is the UI surface-agnostic? Argument for *current surface* = the
   "Activate" button gets back a clear target. Argument *against* =
   the UI is admin, not a remote control; treat all surfaces as peers.
2. **Can a user start a session in the UI itself?** Today, every
   session starts on a hardware trigger (wake word, hotkey, keyboard
   tap). Should the web UI offer a "press to talk" button that uses
   the browser mic? Probably yes — it's how someone with no puck
   tries voix the first time.
3. **Cross-surface continuity.** Can a session that started on the
   puck be continued on the Mac if the puck disconnects? Storage
   supports it; UX doesn't. Probably a v2 feature.
4. **Per-surface mode availability.** Should the Realtime mode show
   up in the iOS keyboard at all (no audio out)? Either hide it,
   or show it greyed with a "no audio out on this surface" hint.
5. **Surface naming**. Users will have multiple Macs, multiple
   iPhones over time. Surfaces need friendly names. Default to
   hostname + form factor; let the user rename.

---

## 11. Constraints you don't need to solve but should know

- Surfaces talk to the daemon over WebSocket using the same protocol
  pucks use (`hello` + binary audio frames + JSON control messages).
  They identify themselves with a `device_id` like `mac-tom-mbp` or
  `ios-kbd-tom-iphone17`. The daemon's `devices/store.ts` already
  treats device IDs generically — it doesn't care if a device is a
  puck or a Mac.
- The daemon ships per-session recordings to `/recordings/`
  regardless of surface. Same for transcripts.
- Surface-side code that doesn't exist yet:
  - macOS menu-bar app (SwiftUI) — planned
  - iOS keyboard extension (Swift) — planned
  - The web UI's own "press to talk" client — not started
- The Voice PE puck is real and shipping today; everything else is
  hypothetical-but-funded direction. You can assume the puck's
  capabilities are well-known. Other surfaces' capabilities are best
  guesses and may evolve.

---

## 12. TL;DR for the next designer

- The just-shipped UI is brand-right. The visual language stays.
- The information architecture needs to shift: surfaces are
  peers, not "the puck + stragglers."
- The "Activate" button is the most concrete symptom. Replace it with
  a per-surface concept: each surface has a current mode; users see
  where each mode is in use.
- Add a "Surfaces" section to the sidebar (replacing the IoT-shaped
  "Devices"). Build the corresponding screen.
- Build the Conversations history screen (already a planned
  placeholder, just hasn't been done).
- Add a "press to talk" affordance inside the web UI so the UI itself
  is a surface.
- Keep the brand rules in §9 verbatim. They're the result of many
  small fights and they're correct.
- Internalise §2 before designing anything: modes are *the product*,
  not a settings category. The mode card has to feel like a portrait,
  not a row.
- Internalise §3 before touching the mode editor: the killer flow
  is **discuss, then output**. Modes have two phases (conversation +
  output), either can be empty, the interesting ones have both. The
  mode editor needs two prompt panels, not one toggle.
- Internalise §6: every surface is also a context gatherer. Modes
  declare what context they want. The Surfaces screen advertises what
  each surface offers. The Conversations screen shows a "context
  receipt" per session so the user sees what voix knew about them.

---

## Appendix A — File pointers

If you do end up reading the code:

- `voix-backend/ui/src/lib/theme.ts` — design tokens + 12-colour palette
- `voix-backend/ui/src/components/Puck.tsx` — the brand glyph
- `voix-backend/ui/src/components/Wordmark.tsx` — wordmark + glyph + /vwa/
- `voix-backend/ui/src/components/AppShell.tsx` — titlebar/sidebar/main
- `voix-backend/ui/src/modes/ModeList.tsx` — the screen most needing
  re-think
- `voix-backend/ui/src/modes/ModeEditor.tsx` — mostly fine; the
  identity row is the visual standard
- `voix-backend/src/devices/store.ts` — generic device record store
  that already handles non-puck surfaces by virtue of being typed on
  `deviceId: string`
- `voix-brand-guide.html` — marketing brand (do not apply to app)
- `voix-desktop-guide.html` — desktop brand (do apply, religiously)
- `docs/STATE.md` — overall project state
- `docs/architecture.md` — long-form rationale

## Appendix B — A pithy way to put it

The puck used to *be* voix. Now voix is the daemon, and the puck is
how voix listens from the kitchen. Soon voix will also listen from
the Mac, from the iPhone, from the browser. Same mind, more ears.
The design must say that quietly.
