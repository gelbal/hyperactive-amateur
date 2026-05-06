// ABOUTME: wavEncoder — encode an AudioBuffer to a 16-bit PCM mono WAV blob.
// ABOUTME: Pure function, no dependencies. Used to send recorded clips to Gemini for auto-tagging.

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1; // we always emit mono

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

// Mix down to a single mono channel by averaging.
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const samples = toMono(buffer);
  const sampleRate = buffer.sampleRate;
  const dataBytes = samples.length * (BITS_PER_SAMPLE / 8);
  const out = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(out);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // file size - 8
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // subchunk1 size (PCM = 16)
  view.setUint16(20, 1, true); // audio format (PCM = 1)
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true); // byte rate
  view.setUint16(32, NUM_CHANNELS * (BITS_PER_SAMPLE / 8), true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  // Interleaved (single channel here) 16-bit PCM samples.
  let offset = HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([out], { type: "audio/wav" });
}
