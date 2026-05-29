# Manual test scenarios — "the family test"

These are the scenarios a non-technical person should be able to walk
through with a Voice PE that has voix pre-installed. No YAML, no logs,
no entity IDs — just the puck, your voice, and your ears.

Quick reference (for the tester, not the user):

- Blue ring = **Assist** mode (normal Home Assistant — lights, timers).
- Amber ring = **Dictation** mode (it writes down what you say).
- Magenta/pink ring = **Realtime** mode (chatty back-and-forth AI).
- Wake words: "Hey Mycroft", "Hey Jarvis", "Okay Nabu" — any of them works.
- Center button (top of the puck) cycles modes:
  Assist -> Dictation -> Realtime -> Assist -> ...

---

## Scenario 1: First time plugging it in

**Given** I just unboxed the Voice PE and the voix integration is already
set up on the Home Assistant my partner runs.
**When** I plug the puck into a USB power adapter and put it on the
kitchen counter.
**Then** within about a minute the outer LED ring should settle into a
steady, soft colour (blue by default, because Assist is the starting
mode), and the device should be ready to respond to a wake word.

Pass criteria checklist:
- [ ] The ring lights up at some point during boot (any colour is fine
      during boot — I just want to see it's alive).
- [ ] After it settles, the ring shows a calm, steady blue glow — not
      flashing, not off, not red.
- [ ] If I say "Hey Mycroft, what time is it?" it answers with the
      current time.

> UX concern: a brand-new user has no way to know that "blue means
> Assist". The box should probably ship with a little card mapping
> colours to modes.

---

## Scenario 2: Asking the time in Realtime mode

**Given** the ring is glowing magenta/pink (Realtime mode).
**When** I say "Hey Mycroft, what time is it?" and then stop talking.
**Then** the ring should change to a "listening" animation while I'm
speaking, briefly change to a "thinking/replying" animation, and then
a friendly voice should answer through the speaker with the current
time. After the voice finishes, the ring should settle back to its
steady magenta glow.

Pass criteria checklist:
- [ ] I hear a short tone or see the ring animation change the moment
      it picks up the wake word.
- [ ] The ring visibly *moves* while I'm speaking (listening animation).
- [ ] The ring visibly *moves* while the voice is talking back
      (replying animation), and the moving animation matches what I
      hear coming out of the speaker.
- [ ] The answer is roughly correct (within a minute or two of the
      actual time).
- [ ] After the voice finishes, the ring goes back to a steady magenta.

---

## Scenario 3: Pressing the button to change mode

**Given** the ring is steady blue (Assist mode).
**When** I press the center button on top of the puck once.
**Then** the ring should change colour — to amber (Dictation) — and
stay there. There should be some kind of feedback that the press
"took" (the colour change itself counts).

Pass criteria checklist:
- [ ] A single press is enough — I don't have to hold it.
- [ ] The ring changes colour within about a second.
- [ ] The new colour is clearly different from the old colour, not a
      subtle shade tweak.
- [ ] The new colour stays — it doesn't snap back to blue after a
      moment.

---

## Scenario 4: Cycling through all three modes

**Given** the ring is steady blue (Assist).
**When** I press the center button three times, with a pause of about
a second between each press.
**Then** the ring should go blue -> amber -> magenta -> blue, ending
back where I started. That's three default modes, and the third press
wraps around.

Pass criteria checklist:
- [ ] First press: blue becomes amber.
- [ ] Second press: amber becomes magenta.
- [ ] Third press: magenta becomes blue again.
- [ ] No press is "lost" — three presses, three colour changes.
- [ ] If I keep pressing, it keeps cycling in the same order.

> UX concern: if I press the button five times in a row really fast,
> what happens? Does each press count, or does the device only act on
> the last one? Worth checking, but I've kept the pause in this
> scenario so the basic flow is clear.

---

## Scenario 5: Seeing magenta — what does that mean?

**Given** I walk into the kitchen and the puck's outer ring is glowing
magenta/pink.
**When** I say "Hey Mycroft, tell me a joke."
**Then** the device should have a conversational back-and-forth with
me — it tells me a joke in a natural voice, and I can immediately
follow up with "another one?" without saying the wake word again,
and it answers that too.

Pass criteria checklist:
- [ ] The ring tells me, at a glance, that I'm in the "chatty AI"
      mode (magenta = Realtime).
- [ ] The joke is spoken aloud, not just shown on a screen somewhere.
- [ ] I can ask a follow-up *without* repeating "Hey Mycroft" — the
      device stays in the conversation for a bit after replying.
- [ ] The follow-up gets a sensible answer.

---

## Scenario 6: Seeing blue — what does that mean?

**Given** I walk past the puck and the outer ring is glowing a calm
blue.
**When** I say "Hey Mycroft, turn on the living room lamp."
**Then** the device should treat this as a normal Home Assistant
command — the lamp turns on, and the device gives a short confirmation
("Turned on the living room lamp" or similar), not a chatty AI-style
reply.

Pass criteria checklist:
- [ ] Blue ring means the device is in Assist mode — boring, reliable,
      "do the thing" mode.
- [ ] The lamp actually turns on.
- [ ] The spoken confirmation is short and factual, not chatty.
- [ ] The ring goes back to steady blue after.

---

## Scenario 7: Asking Realtime mode to turn on a light

**Given** the ring is magenta (Realtime mode) and the kitchen light is off.
**When** I say "Hey Mycroft, turn on the kitchen light."
**Then** ideally the kitchen light should turn on, and the AI should
confirm it conversationally ("Done — kitchen light is on." or similar).
This tests whether the chatty mode can still control my home.

Pass criteria checklist:
- [ ] The kitchen light turns on within a few seconds.
- [ ] The AI acknowledges it out loud.
- [ ] The reply doesn't feel robotic — it's a natural sentence.
- [ ] If the AI *can't* control the light, it should say so out loud
      rather than silently doing nothing.

> UX concern: Realtime mode using a different "brain" (OpenAI) than
> Assist mode (Home Assistant's own) is invisible to the user, but
> it matters when things don't work. If Realtime can't actually
> control lights, a user will think "the device is broken" — not
> "the mode I'm in doesn't have access to my lights". Worth surfacing
> some way.

---

## Scenario 8: Saying nothing after the wake word

**Given** the ring is magenta (Realtime mode).
**When** I say "Hey Mycroft" and then stay completely silent for 15
seconds.
**Then** the device should give up listening on its own — the
"listening" animation should stop, the ring should settle back to its
steady magenta glow, and no charges should be racked up on the cloud
side. It absolutely must not stay "hot mic" forever.

Pass criteria checklist:
- [ ] The "listening" animation stops within roughly 30 seconds of
      silence.
- [ ] The ring goes back to steady magenta (idle).
- [ ] No spoken response (the device doesn't say "I didn't catch that"
      a minute later out of nowhere).
- [ ] If I now say "Hey Mycroft, what time is it?" it works normally
      again — the previous silent session didn't leave it stuck.

---

## Scenario 9: Interrupting the AI mid-sentence

**Given** the ring is magenta (Realtime mode) and I've just asked
"Hey Mycroft, tell me about the history of bicycles" — the AI is
several seconds into a long answer and the ring is showing the
"replying" animation.
**When** I start talking over it — "Wait, stop, I meant unicycles."
**Then** the AI should hear me, stop talking mid-sentence (or very
close to it), and respond to my new question instead. The ring should
visibly transition from "replying" to "listening" while I'm cutting in.

Pass criteria checklist:
- [ ] The AI stops talking within a second or two of me starting to
      talk over it — not after it finishes its current thought.
- [ ] The ring animation switches from "replying" to "listening"
      while I'm interrupting.
- [ ] The AI's *next* answer is about unicycles, not about bicycles.
- [ ] The audio cutoff is clean — no garbled fragments or talking
      over itself.

> UX concern: this is the single biggest selling point of Realtime
> mode over normal Assist. If interruption doesn't work, the whole
> mode feels broken even if everything else is fine.

---

## Scenario 10: Wi-Fi drops out mid-conversation

**Given** the ring is magenta (Realtime mode) and I'm in the middle of
a conversation — the AI is partway through a reply.
**When** I unplug the Wi-Fi router (or someone trips over the cable).
**Then** the device should fail gracefully. The AI voice should stop
(it can't get any more audio from the cloud), the ring should show
some visible "something is wrong" state (red flash, fading off, or
similar), and once Wi-Fi comes back the device should recover on its
own — I shouldn't have to unplug and re-plug the puck.

Pass criteria checklist:
- [ ] The voice stops within a few seconds of the Wi-Fi dropping.
- [ ] The ring shows some clearly different state — not just frozen
      mid-animation. A red flash, going dark, or fading off all
      count.
- [ ] When Wi-Fi comes back (say, within a minute), the ring returns
      to its steady idle colour on its own.
- [ ] After recovery, saying "Hey Mycroft, what time is it?" works
      normally.
- [ ] I never had to physically touch the puck to fix it.

---

## Scenario 11: Wake word said, but the device doesn't respond

**Given** I say "Hey Mycroft, what's the weather?" and... nothing
happens. No ring animation change, no listening sound, no reply.
**When** I look at the puck.
**Then** I should be able to figure out what's wrong from what I can
see and hear, without touching anything technical.

Possible explanations a user should be able to rule in/out:

- The ring is **off / dark** -> the device is unplugged, asleep, or
  has no power. -> Check the USB cable.
- The ring is showing some kind of **red or rapid flashing** state ->
  something's wrong (no Wi-Fi, can't reach Home Assistant). -> Wait a
  moment, check the router.
- The ring is **steady in a normal colour** (blue, amber, or magenta)
  but the device didn't react when I spoke -> probably it didn't hear
  the wake word. Try speaking louder, closer, or facing the puck.
- I'm too far away, or there's loud music playing.

Pass criteria checklist:
- [ ] An unpowered device has a totally dark ring (not faintly lit).
- [ ] A "can't reach Home Assistant" state is *visibly* different
      from a normal idle state — red, blinking, or fading — not just
      "looks normal but doesn't work".
- [ ] A normally-idle, well-lit ring with no response to my voice
      is a clue that the mic missed me, not that the device is broken.
- [ ] I can tell these three failure modes apart without opening any
      app.

> UX concern: this scenario is the one where I most want a printed
> cheat-sheet on the bottom of the device or in the box. Without it,
> "ring is red" tells me nothing.

---

## Scenario 12: The LED looks off or very dim — is it working?

**Given** I walk into the room and the puck's outer ring looks
basically dark, or so dim I can't tell what colour it is.
**When** I want to check whether the device is alive.
**Then** I should have a couple of easy options: (a) press the center
button — the ring should brighten/change as the mode cycles, proving
it's powered and responsive; or (b) say a wake word and listen for
any response.

Pass criteria checklist:
- [ ] Pressing the center button makes the ring visibly change colour
      (even from "looks off" to a clear blue/amber/magenta) — proving
      it's powered.
- [ ] If pressing the button does nothing visible, that's a real
      problem — the device is probably unpowered or frozen.
- [ ] Saying "Hey Mycroft, are you there?" should produce *some*
      audible or visible response if the device is healthy.
- [ ] In a dark room, the ring is unambiguously visible at its idle
      brightness. (40% default brightness should be enough — confirm.)

> UX concern: the idle brightness defaults to 40%. In a bright kitchen
> with sunlight, magenta and amber can look surprisingly similar at
> 40% — I've squinted at the puck more than once trying to tell which
> mode I'm in. Worth either bumping default brightness or making the
> three colours more obviously distinct (e.g. green for one of them).

---

## Scenario 13: Dictation mode captures what I say

**Given** the ring is amber (Dictation mode).
**When** I say "Hey Jarvis, remember that I need to buy milk, eggs,
and bread on the way home tomorrow."
**Then** the device should listen, the ring should show a listening
animation while I speak, and when I'm done it should NOT talk back to
me. Instead, my words should appear as transcribed text inside Home
Assistant (for now — eventually they'd land in a Mac app).

Pass criteria checklist:
- [ ] The listening animation runs while I'm talking.
- [ ] The device does NOT reply out loud at the end — dictation is
      silent capture.
- [ ] My transcribed words show up in Home Assistant somewhere I can
      look (the voix integration's text entity).
- [ ] The transcription is roughly accurate — "milk, eggs, and bread"
      is recognizable, even if the exact punctuation differs.
- [ ] The ring goes back to steady amber after capture.

---

## Scenario 14: Switching modes mid-life — does it take effect immediately?

**Given** the ring is steady blue (Assist mode) and I just finished
asking it to turn on a light.
**When** I press the center button once (ring becomes amber —
Dictation) and immediately say "Hey Jarvis, write down: pick up dry
cleaning."
**Then** the device should be in Dictation mode by the time I speak —
my words should be captured silently as a transcript, NOT acted on
as a Home Assistant command (it should not try to "turn on" anything).

Pass criteria checklist:
- [ ] The mode switch is fast enough that a wake word said immediately
      after the press lands in the new mode.
- [ ] The device captures the dictation silently — no spoken reply.
- [ ] The transcribed text shows up in Home Assistant.
- [ ] The ring stays amber afterwards (it doesn't snap back to blue).

---

## Scenario 15: Wake word works from across the room

**Given** the device is on the kitchen counter, ring steady at idle
(any mode). The room is moderately quiet — maybe a dishwasher
running in the background.
**When** I stand about 3-4 metres away (across the kitchen, near the
fridge) and say "Hey Mycroft, what's the weather?" at a normal,
indoor speaking volume.
**Then** the device should hear me, the ring should change to a
listening animation, and I should get a sensible answer at a volume
loud enough to hear from where I'm standing.

Pass criteria checklist:
- [ ] The wake word is picked up from 3-4 metres without me having
      to raise my voice.
- [ ] The listening animation triggers within roughly a second of
      me finishing the wake word.
- [ ] The spoken answer is audible from where I'm standing — not
      so quiet I have to walk over.
- [ ] Background noise (dishwasher, fan) doesn't cause it to mis-fire
      on its own (no spurious wake-ups in the previous 5 minutes).

> UX concern: I've left this one for last because it's the most
> environment-dependent. If it fails, it's not necessarily a software
> bug — could be mic placement, room acoustics, or background noise.
> Worth noting in the result, not just "pass/fail".
