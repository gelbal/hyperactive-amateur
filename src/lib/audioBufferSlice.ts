// ABOUTME: audioBufferSlice — pure helper that copies a [startMs, endMs] window of an AudioBuffer.
// ABOUTME: Used so the AI tagger sees only the trimmed sound, not the surrounding silence captured in the 2 s recording.
import { getAudioContext } from "./audio";

// Copy a [startMs, endMs] window of `buffer` into a fresh AudioBuffer
// allocated from the shared AudioContext. Channels and sample rate are
// preserved. Out-of-range / inverted windows clamp to the source bounds;
// a zero-length window still returns a valid (empty) buffer so downstream
// encoders don't need to special-case it.
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const totalSamples = buffer.length;

  const rawStart = Math.floor((startMs / 1000) * sampleRate);
  const rawEnd = Math.ceil((endMs / 1000) * sampleRate);
  const startSample = Math.max(0, Math.min(totalSamples, rawStart));
  const endSample = Math.max(startSample, Math.min(totalSamples, rawEnd));
  const length = endSample - startSample;

  const ctx = getAudioContext();
  // createBuffer requires length >= 1, so guarantee a single silent sample
  // for empty windows; the caller still gets a usable AudioBuffer.
  const out = ctx.createBuffer(buffer.numberOfChannels, Math.max(1, length), sampleRate);

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      dst[i] = src[startSample + i];
    }
  }
  return out;
}
