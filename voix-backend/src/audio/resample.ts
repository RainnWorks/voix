/**
 * Linear PCM16 resampler with state threading between chunks.
 *
 * The Voice PE mic is 16 kHz mono PCM16; OpenAI Realtime requires
 * ≥ 24 kHz. We upsample 16 → 24 by a factor of 3/2 using linear
 * interpolation, threading the trailing sample across calls so chunk
 * boundaries don't introduce clicks (the HA-side Python equivalent
 * used `audioop.ratecv`; this matches its behaviour).
 *
 * Why linear and not a polyphase / sinc filter: dictation + realtime
 * speech survives linear-interp upsampling fine at this ratio and the
 * cost is ~free. Going to a proper filter is a tunable later if the
 * model ever complains about quality.
 *
 * State: holds the last input sample so the next chunk can interpolate
 * across the boundary. Discarding state would leave a step
 * discontinuity at every WS frame, audible as a buzz at the buffer
 * rate.
 */

export type ResampleState = {
  inRate: number;
  outRate: number;
  /** Last sample of the previous input chunk. Carried across calls so
   *  interpolation at the boundary uses the right anchor. */
  lastIn: number;
  /** Fractional position into the input stream — units of input
   *  samples. 0 means "next output sample lines up with the start of
   *  this input chunk". */
  fracPos: number;
};

export function createResampler(inRate: number, outRate: number): ResampleState {
  return { inRate, outRate, lastIn: 0, fracPos: 0 };
}

/**
 * Resample one chunk of mono PCM16. Returns the output chunk and
 * advances the state in-place. Empty input returns empty output.
 *
 * Math: output sample N's source position is `N * inRate / outRate`
 * input samples from the chunk start. We start at `state.fracPos`
 * (which carries over from the previous chunk) and step by
 * `inRate / outRate` per output sample. Each output sample is a
 * linear interpolation between the two surrounding input samples.
 */
export function resampleChunk(pcm16: Buffer, state: ResampleState): Buffer {
  if (pcm16.length === 0) return Buffer.alloc(0);
  if (pcm16.length % 2 !== 0) {
    throw new Error(`resampleChunk: odd byte count ${pcm16.length} — not PCM16-aligned`);
  }
  if (state.inRate === state.outRate) {
    // Update lastIn so any future rate change still has continuity.
    state.lastIn = pcm16.readInt16LE(pcm16.length - 2);
    return Buffer.from(pcm16);
  }

  const inSamples = pcm16.length / 2;
  // Read all input samples into a typed array — cheaper than per-sample
  // Buffer.readInt16LE calls (~10× faster on Bun in microbench).
  const input = new Int16Array(inSamples);
  for (let i = 0; i < inSamples; i++) {
    input[i] = pcm16.readInt16LE(i * 2);
  }

  const step = state.inRate / state.outRate;
  // Upper bound on output sample count for this chunk. We may emit one
  // fewer if the next interpolation point falls past the chunk end —
  // its anchor sample is reserved for the next call (carried via
  // lastIn).
  const maxOut = Math.ceil((inSamples - state.fracPos) / step) + 1;
  const out = new Int16Array(maxOut);
  let outIdx = 0;

  let pos = state.fracPos;
  while (pos < inSamples) {
    const i0 = Math.floor(pos);
    const i1 = i0 + 1;
    const frac = pos - i0;
    // Source samples: prefer the chunk's own samples; fall back to
    // state.lastIn when i0 is just before the chunk start (only
    // possible on the very first call where fracPos can be 0 — guarded
    // anyway).
    const s0 = i0 < 0 ? state.lastIn : (input[i0] as number);
    if (i1 >= inSamples) {
      // The "right" anchor sample is in the NEXT chunk. Stop here and
      // carry pos forward so the next call resumes at exactly the right
      // position relative to the new chunk's start.
      break;
    }
    const s1 = input[i1] as number;
    out[outIdx++] = Math.round(s0 + (s1 - s0) * frac);
    pos += step;
  }

  // Update state for the next call. The new fracPos is measured
  // relative to where the NEXT chunk begins, so subtract the consumed
  // samples (= inSamples, since we processed the whole chunk worth of
  // input positions).
  state.fracPos = pos - inSamples;
  state.lastIn = (input[inSamples - 1] as number) ?? state.lastIn;

  // Pack into a Buffer for WS send. Slicing the underlying buffer is
  // cheap; we don't need to memcpy.
  const outBytes = Buffer.alloc(outIdx * 2);
  for (let i = 0; i < outIdx; i++) {
    outBytes.writeInt16LE(out[i] as number, i * 2);
  }
  return outBytes;
}
