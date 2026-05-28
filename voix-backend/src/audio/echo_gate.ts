/**
 * Energy-based echo gate — drops mic chunks that look like the model's
 * own speech bleeding back through the puck's speaker.
 *
 * Not a true AEC. No signal subtraction, no clock-domain alignment.
 * Just compares mic RMS against a predicted echo level derived from
 * recently-sent speaker output. Imperfect: when echo and real speech
 * overlap closely, may drop or pass either way. But it never produces
 * "fake user turns" from the model's own voice, which is the actual
 * failure mode that derails OpenAI Realtime sessions — the model says
 * "Sounds good", the mic picks it up, semantic_vad fires, OpenAI
 * generates a reply to "Sounds good", and the session loops forever.
 *
 * Why this works on the Voice PE:
 *   • XMOS DSP already does hardware AEC (~25 dB residual).
 *   • Echo at the mic is therefore ~-25 dB below speaker output level.
 *   • User speech into the mic at conversational distance is much
 *     louder than the residual echo (typically 20–30 dB above).
 *   • So an energy threshold cleanly separates "just echo" from
 *     "user is talking over the model".
 *
 * Reference window covers the worst-case speaker→mic delay (puck
 * speaker queue + DMA latency + a margin). Peak RMS in that window
 * predicts the current echo level at the mic.
 *
 * Ported from the HA-side Python `_EchoGate` in `ws_view.py` — same
 * constants, same algorithm. Once we have field data from real
 * sessions we'll tighten ECHO_PATH_GAIN per device.
 */

/** Post-AEC residual gain. Field tuning: Voice PE's XMOS at the
 *  speaker volumes used in practice leaves a residual closer to
 *  -10 dB than the spec'd -25 dB. Bumping ECHO_PATH_GAIN means we
 *  predict a louder echo and gate more aggressively. */
const ECHO_PATH_GAIN = 0.32;
/** Real-speech threshold: mic RMS must exceed predicted echo by this
 *  factor to forward. Dropped from 4× → 2× because the previous
 *  setting still let mid-volume echo through, producing fake user
 *  turns ("아하", "Metallica Club") that confused the model. */
const INTERRUPT_THRESHOLD = 2.0;
/** Refs are timestamped at PLAYBACK time (future, when the puck
 *  actually emits the audio). Lookup looks BACK from "now" to find
 *  refs whose playback is recent. Window covers worst-case puck
 *  speaker queue + DMA latency (~700ms per CLAUDE.md) with margin.
 *  Bigger than the HA-side equivalent (3s) because we no longer rely
 *  on a paced sender to spread the timestamps. */
const WINDOW_S = 1.5;
/** Sample rate of speaker audio from OpenAI. PCM16 mono at 24 kHz. */
const SAMPLE_RATE_HZ = 24000;

type Ref = { sentAtMs: number; rms: number };

export class EchoGate {
  private refs: Ref[] = [];
  private forwarded = 0;
  private dropped = 0;

  /**
   * RMS of a PCM16 little-endian buffer. Square root of mean of squares
   * across all int16 samples. Matches Python's `audioop.rms` for a
   * mono PCM16 stream.
   */
  static rms(pcm16: Buffer): number {
    if (pcm16.length < 2) return 0;
    const n = Math.floor(pcm16.length / 2);
    // Sum-of-squares fits in a regular number for chunks up to a few MB
    // — Number.MAX_SAFE_INTEGER swallows n * (32768^2) for n up to 8e9
    // samples. We're nowhere close.
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const s = pcm16.readInt16LE(i * 2);
      sumSq += s * s;
    }
    return Math.sqrt(sumSq / n);
  }

  /**
   * Tell the gate about a chunk we just sent to the puck's speaker so
   * it can predict the resulting echo on incoming mic data.
   *
   * For large bursts (OpenAI sometimes streams a whole sentence —
   * hundreds of KB — in a single `response.output_audio.delta`), we
   * split into ~50ms segments and timestamp each at its expected
   * playback time. Without this, a 4-second burst gets one ref logged
   * at receive-time, the puck plays it over 4 seconds, and by the
   * time the second-half echo arrives at the mic our 3-second
   * lookback window has already expired against the single ref — so
   * the gate forwards the echo as user speech. That's exactly the
   * "model hears itself, generates a reply to its own voice" loop we
   * spent two debugging sessions on.
   */
  observeSpeaker(pcm16: Buffer): void {
    if (pcm16.length === 0) return;
    const now = Date.now();
    // 24 kHz mono PCM16 = 48 KB/s. 50 ms ≈ 2400 bytes per segment.
    const SEGMENT_MS = 50;
    const segmentBytes = (SAMPLE_RATE_HZ * 2 * SEGMENT_MS) / 1000;
    let offset = 0;
    let segmentIdx = 0;
    while (offset < pcm16.length) {
      const end = Math.min(offset + segmentBytes, pcm16.length);
      const segment = pcm16.subarray(offset, end);
      // Timestamp = when this segment will PLAY at the puck, not
      // when we received it. Real time of receive plus the offset
      // into the burst. Echo arrives shortly after each segment plays.
      const playAtMs = now + segmentIdx * SEGMENT_MS;
      this.refs.push({ sentAtMs: playAtMs, rms: EchoGate.rms(segment) });
      offset = end;
      segmentIdx++;
    }
    this.gc(now);
  }

  /**
   * Decide whether to forward this mic chunk to OpenAI. Returns
   * { forward, micRms, peakRefRms } so the caller can log decisions.
   */
  shouldForward(micPcm16: Buffer): {
    forward: boolean;
    micRms: number;
    peakRefRms: number;
  } {
    if (micPcm16.length === 0) {
      return { forward: true, micRms: 0, peakRefRms: 0 };
    }
    const micRms = EchoGate.rms(micPcm16);
    const now = Date.now();
    this.gc(now);
    if (this.refs.length === 0) {
      // No recent model speech → can't be echo. Forward.
      this.forwarded++;
      return { forward: true, micRms, peakRefRms: 0 };
    }
    let peakRefRms = 0;
    for (const r of this.refs) {
      if (r.rms > peakRefRms) peakRefRms = r.rms;
    }
    const predictedEcho = peakRefRms * ECHO_PATH_GAIN;
    const threshold = predictedEcho * INTERRUPT_THRESHOLD;
    if (micRms > threshold) {
      this.forwarded++;
      return { forward: true, micRms, peakRefRms };
    }
    this.dropped++;
    return { forward: false, micRms, peakRefRms };
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
