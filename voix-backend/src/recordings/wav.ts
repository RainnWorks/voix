/**
 * Minimal WAV file writer for mono PCM16.
 *
 * Spec: RIFF / WAVE / fmt + data, format code 1 (uncompressed PCM),
 * num_channels = 1, bits_per_sample = 16. Sample rate comes from the
 * caller — we use 16 kHz for puck mic captures and 24 kHz for the
 * speaker stream OpenAI sends us.
 *
 * Why not stream chunks straight to disk via a header rewrite: WAV
 * headers include the total data size up front, which means a true
 * streaming writer has to seek back at end-of-write. Sessions are
 * short (seconds to a few minutes) and PCM16 mono fits easily in
 * memory — a 5-minute mic recording is 4.8 MB at 16 kHz. We buffer
 * the whole thing and write once at session close. Simpler, no
 * file-descriptor leaks if the session crashes.
 */

/** WAV header for mono PCM16 at the given sample rate + sample count. */
function buildHeader(sampleRate: number, sampleCount: number): Buffer {
  const channels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataSize = sampleCount * bytesPerSample;
  const riffSize = 36 + dataSize;

  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(riffSize, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM format
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bytesPerSample * 8, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataSize, 40);
  return h;
}

/**
 * Concatenate raw PCM16 chunks and produce a complete WAV file as
 * one Buffer. Caller writes that buffer to disk atomically.
 */
export function encodeWav(pcmChunks: readonly Buffer[], sampleRateHz: number): Buffer {
  let total = 0;
  for (const c of pcmChunks) total += c.length;
  if (total % 2 !== 0) {
    throw new Error(`encodeWav: odd byte count ${total} — not PCM16-aligned`);
  }
  const sampleCount = total / 2;
  const header = buildHeader(sampleRateHz, sampleCount);
  return Buffer.concat([header, ...pcmChunks], header.length + total);
}
