/**
 * Echo gate — drops mic chunks while the model is currently speaking.
 *
 * Goes half-duplex during model output. No RMS comparison, no
 * thresholds. The question this gate answers is purely:
 *
 *     "Did we send speaker audio to the puck recently enough that
 *      the echo from it might still be reaching the mic right now?"
 *
 * If yes, drop the mic chunk. If no, forward.
 *
 * **Why not energy-based**: RMS thresholds are calibrated against
 * speaker volume. Turn the volume up and real user speech becomes
 * quieter than echo; turn it down and the threshold rejects real
 * speech. There's no fixed ratio that works across setups, and
 * matching the threshold to each user's volume is a tuning loop we'd
 * never finish.
 *
 * **Why not let OpenAI sort it out**: the realtime API's
 * `semantic_vad` only sees the input buffer. The output audio
 * channel is independent — VAD can't tell "this incoming audio is the
 * model's own voice bouncing back". Whatever gets past us into the
 * input buffer, OpenAI treats as user speech.
 *
 * **Why not real AEC**: the Voice PE's XMOS XU316 has hardware AEC
 * on paper, but its reference signal input isn't wired on the VPE
 * PCB — the speaker output goes straight to the DAC without looping
 * back to XMOS as the AEC reference, so the chip has no signal to
 * subtract. HA's own stock voice assistant doesn't attempt AEC on
 * this hardware either; it goes half-duplex (Wake → Listen → Speak)
 * for the same reason. Reference:
 * https://community.home-assistant.io/t/help-needed-xmos-xu316-aec-not-working-on-voice-preview-edition-vpe/975285
 *
 * **Cost of this design**: no barge-in. Saying "stop" mid-response
 * won't interrupt the model. Same trade-off Alexa/Google make at the
 * platform level. We match what HA's stock assistant does.
 *
 * **How refs work**: every speaker chunk we send to the puck is
 * recorded with a timestamp at its predicted playback time (future,
 * not now — the puck takes hundreds of ms to drain its queue plus the
 * burst plays over its duration). gc() drops refs older than
 * WINDOW_S after playback. Mic forwards iff refs is empty.
 */

/** How long after the last speaker audio "plays" we keep gating mic.
 *  Has to cover puck speaker queue latency + room reverb tail. 1.0s
 *  is generous — most rooms decay below noise floor in 200-400 ms. */
const WINDOW_S = 1.0;
/** Sample rate of speaker audio from OpenAI. PCM16 mono at 24 kHz. */
const SAMPLE_RATE_HZ = 24000;

/** A scheduled-playback marker. We only need the time it expires; no
 *  RMS, no payload. Keeping the array tiny keeps gc cheap. */
type Ref = { sentAtMs: number };

export class EchoGate {
  private refs: Ref[] = [];
  private forwarded = 0;
  private dropped = 0;

  /**
   * Tell the gate that a chunk just went out to the puck's speaker.
   * One ref per chunk, expiring `WINDOW_S` after the chunk's last
   * sample finishes playing. While any ref is unexpired the gate is
   * "closed" — mic chunks are dropped.
   *
   * The chunk size from OpenAI varies wildly — sometimes 1 KB,
   * sometimes hundreds of KB in one `response.output_audio.delta`.
   * Using ONE ref per chunk with the playback duration baked into
   * the timestamp handles all sizes uniformly: a small chunk closes
   * the gate briefly, a big chunk closes it for the burst duration
   * plus the echo tail. No segmentation needed.
   */
  observeSpeaker(pcm16: Buffer): void {
    if (pcm16.length === 0) return;
    const now = Date.now();
    // 24 kHz mono PCM16 = 48 000 bytes/s. Each byte advances playback
    // by 1 / 48 000 s. The LAST sample of this chunk plays at:
    //   now + (chunk_bytes / 48000) seconds.
    // We only need ONE ref per chunk (the last sample's playback
    // time) — gc treats it as "the moment the speaker stream ends".
    // While that ref hasn't expired, mic stays gated. Per-chunk
    // granularity vs per-segment doesn't matter for a state-based
    // gate; only the LATEST playback time controls the gate state.
    const chunkDurationMs = (pcm16.length / (SAMPLE_RATE_HZ * 2)) * 1000;
    this.refs.push({ sentAtMs: now + chunkDurationMs });
    this.gc(now);
  }

  /**
   * Decide whether to forward this mic chunk. Half-duplex rule: if
   * we have any active speaker reference (recently sent audio, still
   * in the playback + echo-tail window), drop.
   */
  shouldForward(micPcm16: Buffer): { forward: boolean } {
    if (micPcm16.length === 0) return { forward: true };
    this.gc(Date.now());
    if (this.refs.length === 0) {
      this.forwarded++;
      return { forward: true };
    }
    this.dropped++;
    return { forward: false };
  }

  stats(): string {
    const total = this.forwarded + this.dropped;
    if (total === 0) return "echo_gate: idle";
    const pct = ((100 * this.dropped) / total).toFixed(1);
    return `echo_gate: forwarded=${this.forwarded} dropped=${this.dropped} (${pct}% dropped)`;
  }

  private gc(now: number): void {
    const cutoff = now - WINDOW_S * 1000;
    while (this.refs.length > 0 && (this.refs[0]?.sentAtMs ?? 0) < cutoff) {
      this.refs.shift();
    }
  }
}
