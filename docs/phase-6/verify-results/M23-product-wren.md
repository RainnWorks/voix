# Wren's M23 product review

Two of my watching briefs land in this milestone: (M21) the iOS hardcoded
`intent: "discuss"` and (since M17 onward) the no-marketing-copy-anywhere
tone gap. M23 is the milestone where voix-the-app stops being a working
prototype and starts being a thing a stranger can install. Reviewing
through that lens: does the first launch *land* as voix, or as a generic
voice-pickle?

## Receipts

Files read:

```
voix-backend/src/voices/builtins.ts                    (BUILTIN_TONES + 6 voices)
packages/ui/src/voices/VoiceList.tsx                   (cardTone render)
packages/ui/src/voices/VoiceEditor.tsx                 (tone input)
packages/ui/src/conversations/TalkButton.tsx           (intent prop + hint copy)
packages/ui/src/conversations/ConversationList.tsx     (derives intent from active voice)
packages/ui/src/onboarding/Onboarding.tsx              (3-screen story)
packages/ui/src/settings/SettingsScreen.tsx            (IA of the 5 sections)
voix-brand-guide.html                                  (Section 07 · Voice; do/don't)
voix-desktop-guide.html                                (Section 06 · Never; first-run sober)
docs/phase-6/verify-results/M21-product-wren.md        (my prior intent finding)
docs/phase-6/verify-results/M23-implementer-report.md  (what shipped)
```

## Intent gap closure (M21 carry-forward)

My M21 finding was that the iOS TalkButton hardcoded `intent: "discuss"`
at line 57. That meant: pick the Dictation voice, hold to talk, get a
voice reply you didn't ask for. The product axis was inert.

M23 closes the gap mechanically *and* surfaces it as product:

1. **TalkButton.tsx:50-54** — `intent` is a required prop. No default,
   no `?:`. `tsc` enforces this; missing the prop is a compile error.
   I confirmed by reading the call sites (ConversationList passes
   `intent={intent}`, MacOverlay passes `"dictate"`). The "silent
   regression to discuss" risk is closed at the type level — exactly
   what Decision 3 promised.

2. **ConversationList.tsx:99** — `intent: Intent = activeVoice?.type
   === "dictation" ? "dictate" : "discuss"`. The active voice's `type`
   drives the intent. Switching the active voice from a Realtime card
   to a Dictation card on the Voices screen, then returning to
   Conversations, re-derives intent. No separate UI axis. The
   architecture earns its keep — *the voice IS the intent*.

3. **Hint copy and labels both fork on intent**:
   - `TalkButton.tsx:140-141` — `hintCopy = intent === "dictate" ?
     "Hold to dictate." : "Hold to talk to voix."`
   - `labelFor()` lines 274-289 forks too: idle is "Hold to dictate" vs
     "Talk to voix", and speaking is "Transcribing…" vs "voix is
     replying." The speaking-state fork is the load-bearing one I
     wouldn't have asked for explicitly — it stops the screen from
     lying about what the system is doing. A Dictation voice telling
     you "voix is replying" while it's actually transcribing would
     have been a small but corrosive trust break. Caught here,
     properly.

The closure is **clean**. Both axes covered (compile-time AND copy),
no fallback default sneaking back in, the consumer derives correctly.
This was the cleanest possible shape of the fix — I'd have flagged any
of the alternatives (runtime check, options dict with sentinel,
"smart" auto-detect) as the wrong move; the type-required-prop is
right.

One small note: the no-active-voice fallback at line 99 is `discuss`.
That's defensible (first-run before any device record exists; you'll
probably onboard with a Realtime voice). But if M24 ships the iOS
keyboard extension first and a keyboard-extension user lands on
Conversations before activating anything, they'll see "Hold to talk to
voix" instead of "Hold to dictate" — which mis-frames the product for
a dictation-keyboard user. Watching brief: revisit when the keyboard
extension lands.

**Verdict: intent gap CLOSED.**

## Tone snippet copy quality (the 8-milestone gap)

This is where I came to fight. Built-in tones could so easily have
been "Formal", "Casual", "Detailed" — the developer-default that
poisons the well. Let me read every one shipped at
`voix-backend/src/voices/builtins.ts:144-151`:

```
default-realtime: "A calm conversational partner."
default-dictation: "Just transcribes. No rewrite."
default-message: "Crisp messages. No fluff."
default-email: "Polite and professional. Always lands."
default-note: "Quick capture for future-you."
default-code: "Plain prompts. Comments where they earn it."
```

Reading these against `voix-brand-guide.html` §07 ("Confident. Specific.
Slightly knowing. Short sentences. Concrete nouns. The cheek is in the
timing, not the volume."):

| ID | Tone | Brand fit |
|----|------|-----------|
| realtime | "A calm conversational partner." | C+ — generic, slightly self-impressed. The weakest of the six. Closer to "your AI assistant" copy than to "talk to it, it talks back." |
| dictation | "Just transcribes. No rewrite." | A — concrete, period-not-comma, exactly the cheek-in-the-timing voice. Tells you what it *doesn't* do, which is the whole point. |
| message | "Crisp messages. No fluff." | A — two-beat, "no fluff" is genuinely the brand voice. |
| email | "Polite and professional. Always lands." | B+ — "always lands" is a nice product promise, slightly hedges on the "polite and professional" front (that phrase IS the AI-slop the brand guide warns against). I'd lose "polite and professional" — keep "Always lands." or fold to something like "Reads like you meant it." |
| note | "Quick capture for future-you." | A- — "future-you" is the one place a personality voice sneaks in. Specific, useful, ownable. |
| code | "Plain prompts. Comments where they earn it." | A+ — best of the six. "Comments where they earn it" is exactly the slightly-knowing register the guide describes. A developer reads this and recognises themselves. |

**Distinctiveness**: yes. You could shuffle the six and still pair them
correctly. None of them are interchangeable with "formal/casual/
technical" axis-driven copy. Each says what *that voice* does, not
what category it fits into.

**Length**: all six are between 30-50 chars. The 80-char clamp is
comfortable headroom for user-supplied snippets. Card render at
`VoiceList.tsx:126-128` uses `numberOfLines={1}` — they all fit on one
line at 11pt italic on a 280px-min card.

**Period-vs-comma discipline**: brand guide says "Short sentences."
Five of six use periods between clauses (good). "Polite and
professional. Always lands." is the model. Dictation, Message, Code
all follow this. Email and Realtime are the ones I'd polish before
they leak into a screenshot.

**Em dashes?** None. The brand guide is explicit: em dashes are an AI
tell. Implementer caught this.

**Exclamation marks?** None. Brand guide says "no exclamation marks.
Ever." Implementer caught this too.

This is the gap I've been watching for 8 milestones. The Implementer
shipped copy, didn't ship null, and the copy is *mostly* the brand
voice. **One sub-finding** below on the realtime + email snippets.

**Verdict: tone gap CLOSED, with one polish ask.**

## Tone editor UX

Reading `VoiceEditor.tsx:117-127`:

```tsx
<TextInput
  value={voice.tone ?? ""}
  placeholder="A one-line personality snippet."
  placeholderTextColor={colors.textQuiet}
  maxLength={80}
  onChangeText={(t) => setVoice({ ...voice, tone: t })}
  onBlur={() => save({ tone: (voice.tone ?? "").trim() || null })}
  style={styles.toneInput}
/>
```

**Placeholder copy**: "A one-line personality snippet." — describes the
field rather than inviting the user into the voice. Compare with what
the architect's spec might have been: "How does this voice sound?" The
placeholder is correct but not warm; it's developer-default-grade
copy. Reading it doesn't make me think "oh I should write something
playful here," it makes me think "ah, a string input." This is the
M23 tone-of-voice gap re-surfacing inside the editor for tone-of-voice.

**maxLength visible counter**: NOT shipped. The `maxLength={80}` prop
silently truncates at the input layer. There's no "47/80" counter, no
visual feedback that 80 is the cap. A user typing a longer tone snippet
hits an invisible wall — keystrokes stop registering, and they don't
know why. On iOS this is especially confusing because the virtual
keyboard stays open and active. (This is FINDING-2 below.)

**Empty-state fallback**: graceful. `VoiceList.tsx:125` guards with
`{voice.tone && (...)}` so an empty tone simply omits the line; the
card layout doesn't reserve dead space. The `onBlur` handler at
`VoiceEditor.tsx:124` does `(voice.tone ?? "").trim() || null` — empty
or whitespace becomes literal `null` on disk, which is the right
representation. ConversationList row and SurfaceList row all do the
same `voice.tone &&` guard. Clean.

**Verdict: graceful empty-state, placeholder copy is meh, missing
char counter.**

## Onboarding flow as a product story

Three screens, read in order:

### Screen 1 — Welcome (`Onboarding.tsx:146-167`)

Title: **"voix listens when you talk to it."** Body: "Press, speak,
paste. Or hold to have a full conversation. voix is a push-to-talk
dictation and chat surface for your Home Assistant Voice PE — but it
also works on its own with the daemon you'll wire up in the next two
screens."

The **title** is excellent. Six words, present tense, action+behaviour.
Reads like the Info.plist string that I called out in M21 as voice-
first ("voix listens when you talk to it.") The brand carrying through
from the system to the splash screen — that's the kind of continuity
the guide asks for.

The **body** is two voices stitched together. The first sentence
("Press, speak, paste. Or hold to have a full conversation.") is on-
brand: concrete verbs, period-not-comma, no slop. The second sentence
("voix is a push-to-talk dictation and chat surface for your Home
Assistant Voice PE — but it also works on its own with the daemon
you'll wire up in the next two screens") collapses three pieces of
information into one wandering sentence AND has an em dash. The brand
guide is explicit about em dashes: *"NEVER · Em dashes in marketing
copy. Use hyphens or full stops. Em dashes are an AI tell."* The
Welcome screen is the most marketing-y surface the app ever has —
this is exactly where the rule applies. (FINDING-1 below.)

The screen also passes my "one sentence to explain voix" test
half-way. "voix listens when you talk to it" is a sentence that
explains voix. The body sentence then over-explains. I'd lose the
second sentence entirely and let the screens that follow be the
explanation.

### Screen 2 — Mic permission (`Onboarding.tsx:169-216`)

Title: "voix needs your microphone." Body switches on denied-state:
- Pre-prompt: "Tap allow on the system prompt. You can change this
  any time in Settings."
- Post-deny: "Won't work without microphone access. Open Settings,
  allow voix, then come back."

Both copies are tight. "Won't work without microphone access." is the
no-apology brand register; "come back" is concrete and human. Buttons
match: "Allow microphone" pre-prompt, "Open settings" + "Skip for now"
on deny.

The denied-state explicitly answers "why does voix need this?" by
implication ("Won't work without"). Good. The pre-prompt does NOT
answer "why" — it's just "tap allow." A first-time user who's wary of
permission prompts might pause here. A line like "voix listens through
the mic — it doesn't record anything else" would land. Not a finding,
a polish ask.

### Screen 3 — Daemon URL (`Onboarding.tsx:218-266`)

Title: **"Where's your daemon?"** Body: "voix talks to a small daemon
running on your network — usually the Home Assistant box. We've pre-
filled the dev address; edit if yours lives elsewhere."

Here's where the brief asks the hard question: does this feel like an
OOBE step or a tech exception?

It WANTS to feel OOBE. The title is conversational ("Where's your
daemon?"), the body explains the concept (one small server somewhere
on your network), the URL is pre-filled, the failure mode is graceful
(unreachable doesn't block "Done"; a soft warning instead). This is
genuinely well-shaped — most apps would have rendered a settings panel
here.

But: "daemon" is the wrong word for a first-launch screen. A daemon is
internal vocabulary. The user model is "the voix server on my Home
Assistant box" or "the voix box." Asking a user who just installed an
app "Where's your daemon?" makes the app feel like a sysadmin tool.
The brand guide voice has opinions but doesn't gatekeep — "daemon" is
gatekeeper word. (FINDING-3 below.)

Also: em dash in the body. Same brand-guide violation as Screen 1.

The flow is otherwise well-shaped. Skip-link on every screen
(dev-friendly; flagged in the comment for removal in prod), AppState
observer re-checks mic on resume, the StepDots at the bottom give
shape to the journey. The architect's Decision 4 is delivered as a
story; the story has two sentences in the wrong register.

## Findings, by severity

### FINDING-1 (medium) — Em dashes in onboarding body copy.

`Onboarding.tsx:155` (Welcome) and `Onboarding.tsx:240` (Daemon)
contain em dashes. The brand guide forbids them ("NEVER · Em dashes in
marketing copy. Use hyphens or full stops. Em dashes are an AI tell").
Onboarding is the most marketing-y surface the app has — first
impression, most likely to land in a screenshot — so the rule applies
hardest here.

Fixes:

- Welcome: drop the second sentence entirely. The title carries the
  promise; the screens that follow explain the rest. If keeping it,
  replace " — " with ". "
- Daemon: replace " — " with ". " ("voix talks to a small daemon on
  your network. Usually the Home Assistant box.")

Surface area: 2 string edits. Worth doing now, because once the first
M23 screenshot appears in a README or social post, the em dashes are
on screen forever.

### FINDING-2 (medium) — Tone editor has no visible character counter.

`VoiceEditor.tsx:121` sets `maxLength={80}` but renders no counter.
A user typing past 80 chars gets silent rejection — the iOS keyboard
keeps showing but their text stops appearing. On macOS the same hard
truncation, no feedback. The user has no model of the cap.

The brand guide says tone snippets are voice-identity copy. The user
is doing real writing work in this field — they need the same kind of
feedback as a Twitter/Bluesky text input.

Fix: render a small `47/80` counter at the trailing edge of the input,
greyed at low counts, HA-blue at 70+, danger at 80. Or simpler — only
render the counter once `len >= 60`, so the field is silent until the
user is approaching the limit. ~10 LOC + one selector hook.

The brief explicitly called this out: "Is the maxLength visible to the
user (e.g. '47/80')?" The implementer's report doesn't mention it.
This is a real gap, easy to close.

### FINDING-3 (low / polish) — "Daemon" is gatekeeper vocabulary on
the onboarding screen.

The Settings screen at `SettingsScreen.tsx:148` says "Daemon
connection" — that's fine, Settings is the technical surface. But
Onboarding's third screen ("Where's your daemon?") asks a first-time
user a question that pre-supposes they know what a daemon is.

The user model is closer to "the voix box on your network" or "where
voix runs." The Tauri install model (voix daemon = HA add-on) means
most users HAVE a daemon and don't know that word. Some pure-
client users on a Mac/iPhone have a local daemon and definitely don't
know that word.

Suggested copy: title "Where does voix run?" body "voix talks to a
small piece of software on your network. Usually it runs alongside
Home Assistant. We've pre-filled the dev address; edit if yours lives
elsewhere."

Counter-argument the architect might reasonably make: "users
installing voix know what a daemon is." Possibly true for v0.6 launch
audience; not true for the v1 launch. M23 is the place to lay the
copy track for v1. Cheap to fix now.

### FINDING-4 (low) — `"A calm conversational partner."` tone snippet
is the weakest of the six built-ins.

The other five built-in tones feel like they were written by someone
who'd read the brand guide. "A calm conversational partner" is
generic-AI-assistant copy. The voice is named Realtime; the user
already knows it's conversational. The snippet should add
*character*, not restate the category.

Suggested rewrites in the brand register:
- "Talks back. Knows when to shut up." (matches brand guide §07
  "Talk to it. It talks back." headline)
- "Speaks first. Listens longer."
- "Will end-session when you say goodbye. Not before."

Pick whatever lands; the current copy reads like the placeholder, not
the final.

Same softer ask for Email's `"Polite and professional. Always lands."`
— drop "polite and professional" (AI-tells per brand guide §09:
"intelligent", "powerful", "robust" sit in the same family). Keep
"Always lands." or replace with "Reads like you meant it."

### FINDING-5 (low) — Tone editor placeholder is descriptive, not
inviting.

`VoiceEditor.tsx:119` placeholder is `"A one-line personality
snippet."` It tells the user the *shape* of the field but doesn't
invite them into the voice.

Better placeholders:
- "How does this voice sound?" (the brief's suggestion — good)
- "Two beats. Concrete. Period not comma."
- "Snappy. Like the puck would say it."

This is the lowest-stakes finding but worth raising because the tone
editor is the one surface where a user is *being asked* to write in
voix's voice. The placeholder is the only nudge they get; it should
nudge.

## Watching briefs carried forward

- **Tone gap**: CLOSED at the structural level (field exists, built-ins
  seeded, three card surfaces render it). Carried forward as
  FINDING-1/4/5 polish, not a category. *Final close once
  FINDING-1 + FINDING-4 land.*
- **Intent gap (M21)**: CLOSED. Type-required + voice-derived. Watching
  brief: revisit when the keyboard extension lands (no-active-voice
  fallback re-frames as "Hold to dictate" not "Hold to talk to voix").
- **macOS hotkey rebind UI** (M23.5 per architect): NEW watching brief.
  Today the MacOverlay HUD hint displays "Hold ${chord} — release to
  send" where `${chord}` is the registered chord. There's an em dash
  in that string too — that's the third em-dash I've found and the
  pattern suggests the team has internalised dash as separator. The
  rebind UI when it lands needs a copy pass to drop them.
- **Onboarding "skip setup" in prod**: NEW watching brief. The
  Implementer comment at `Onboarding.tsx:18-19` flags it as
  "dev-friendly; drop in production builds." Don't forget to drop it
  before v1 ships, or wrap in `__DEV__`. A first-time user can skip
  past mic permission AND skip the daemon URL, landing in an app that
  doesn't know where its server is and can't hear them. The skip is
  legitimate for dev, dangerous for prod.
- **Settings screen "Daemon URL" placement**: per my brief task 5 — IA
  is right. Daemon URL is the FIRST section (not buried under
  "Advanced"), which is correct for a v0.6 audience where the URL is
  legitimately a setting most users will touch. When v1 ships with
  a stable installed daemon, this can move under an "Advanced"
  disclosure. Not a finding, a future trim.

## The one thing the brief should have anticipated but didn't

**That the onboarding screen is the brand audit, not the settings
screen.**

The brief asked me to evaluate Settings IA (Daemon URL placement,
Sample rate override). Those questions matter, but they're inside the
app. The user has already decided to keep voix by the time they're in
Settings. The thing M23 needed to be audited as a *brand surface* is
the three-screen onboarding flow — that's the only place in the entire
M23 stack where voix actively introduces itself.

The flow ships with two em dashes (brand-rule violation), one
gatekeeper word ("daemon"), and a body sentence that over-explains
itself. Each of these is a small thing. Aggregated, they are the
difference between "this app feels like it was made by people with
opinions" and "this app feels like it was made by people writing app
copy."

The brand guide §09 NEVER list is doctrinally explicit about this:
"Em dashes are an AI tell." "Harness, seamlessly, intelligent,
powerful, robust. The copy is specific or it's nothing." The
implementer is clearly TRYING to follow the guide — the tone snippets
prove they read it. But onboarding is where the guide applies most
acutely, and that's where it slipped.

The deeper insight: **the team needs a brand-copy lint step**, not a
brand-copy review step. A regex pass for em dashes, exclamation marks,
"harness", "seamlessly", "intelligent", "powerful", "robust" across
all user-facing strings in `packages/ui/src/` would catch these in
seconds. Same shape as the M21 finding about every-error-looks-like-a-
console-blob — the structural fix beats per-surface vigilance. Worth
spec'ing as a 30-line pre-commit hook before M24 ships.

---

## Verdict

M23 closes two of my most important watching briefs at the
*structural* level. The intent gap is closed clean and right — the
type-required prop is the cheapest possible enforcement, the
voice-derived consumer is the right architecture, the hint/label fork
covers both axes. The tone gap is closed with copy, not null, and the
copy is mostly the brand voice.

What slips is the *finishing polish*: two em dashes, one gatekeeper
word, one tone snippet that reads as placeholder, one missing
character counter, one descriptive-vs-inviting placeholder. None of
these block close; all five together would take an hour. They're the
difference between voix-on-first-launch reading as a brand and reading
as an app.

Recommend: land FINDING-1 (em dashes) and FINDING-4 (realtime/email
tones) BEFORE the first M23 screenshot makes it into a README or
social post. FINDING-2 (char counter) + FINDING-3 (daemon vocabulary)
+ FINDING-5 (placeholder) queue as M23.1 or roll into M24's polish
pass.

And spec a brand-copy lint before M24.
