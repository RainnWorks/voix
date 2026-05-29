/**
 * Minimal WAV reader — the inverse of `wav.ts`.
 *
 * Reads a mono PCM16 LE WAV (sample rate of caller's choice; we don't
 * resample). Used by:
 *   • scripts/vad-bench.ts — feed recorded mic into the VAD for tuning
 *   • future test fixtures — synthetic WAVs as golden inputs
 *
 * Only as much WAV-spec coverage as we need. Specifically:
 *   • RIFF / WAVE container
 *   • fmt chunk: format code 1 (PCM), bits_per_sample = 16, channels = 1
 *   • data chunk: raw PCM16 LE samples
 *   • Any extra chunks (LIST/INFO etc.) between fmt and data are
 *     skipped politely
 *
 * Rejects: non-PCM formats (ADPCM, float), stereo files, 8/24/32-bit
 * depths. The encoder we write is mono PCM16 so anything else is "this
 * isn't a recording we made."
 */

export type WavInfo = {
  sampleRateHz: number;
  channels: 1;
  bitsPerSample: 16;
  pcm: Buffer;
};

function readChunkHeader(buf: Buffer, offset: number): { id: string; size: number } {
  const id = buf.toString("ascii", offset, offset + 4);
  const size = buf.readUInt32LE(offset + 4);
  return { id, size };
}

/**
 * Parse a mono PCM16 LE WAV file. Throws on malformed or unsupported
 * inputs — the caller is a CLI tool, so a thrown Error with a
 * descriptive message is more useful than a Result type.
 */
export function readWav(buf: Buffer): WavInfo {
  if (buf.length < 44) throw new Error("wav: too short to be a WAV file");
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("wav: missing RIFF header");
  if (buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("wav: missing WAVE marker");

  // Walk chunks starting at offset 12.
  let pos = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  let pcm: Buffer | null = null;

  while (pos + 8 <= buf.length) {
    const { id, size } = readChunkHeader(buf, pos);
    pos += 8;
    if (id === "fmt ") {
      if (size < 16) throw new Error(`wav: fmt chunk too small (${size})`);
      const formatCode = buf.readUInt16LE(pos);
      if (formatCode !== 1) {
        throw new Error(`wav: unsupported format code ${formatCode} (need 1=PCM)`);
      }
      fmt = {
        channels: buf.readUInt16LE(pos + 2),
        sampleRate: buf.readUInt32LE(pos + 4),
        bitsPerSample: buf.readUInt16LE(pos + 14),
      };
    } else if (id === "data") {
      pcm = buf.subarray(pos, pos + size);
    }
    // RIFF chunks are word-aligned — odd-sized data chunks have one
    // pad byte after them. round-up to the next even byte.
    pos += size + (size & 1);
    if (pcm && fmt) break;
  }

  if (!fmt) throw new Error("wav: no fmt chunk found");
  if (!pcm) throw new Error("wav: no data chunk found");
  if (fmt.channels !== 1) {
    throw new Error(`wav: need mono (channels=1), got ${fmt.channels}`);
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`wav: need 16-bit PCM, got ${fmt.bitsPerSample}-bit`);
  }

  return {
    sampleRateHz: fmt.sampleRate,
    channels: 1,
    bitsPerSample: 16,
    pcm,
  };
}
