// ABOUTME: wavEncoder tests — header bytes + size + stereo→mono mixdown.
import { describe, it, expect } from "vitest";
import { audioBufferToWav } from "./wavEncoder";

interface FakeOpts {
  sampleRate: number;
  channels: number;
  length: number;
  fill?: (channel: number, sampleIndex: number) => number;
}

function fakeBuffer({ sampleRate, channels, length, fill }: FakeOpts): AudioBuffer {
  const data = Array.from({ length: channels }, (_, c) => {
    const arr = new Float32Array(length);
    if (fill) for (let i = 0; i < length; i++) arr[i] = fill(c, i);
    return arr;
  });
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels,
    getChannelData: (c: number) => data[c],
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

async function readView(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}
function readMagic(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("audioBufferToWav", () => {
  it("encodes a 1s 48kHz mono buffer with a valid RIFF/WAVE header at the expected size", async () => {
    const sr = 48000;
    const buf = fakeBuffer({
      sampleRate: sr,
      channels: 1,
      length: sr,
      fill: (_c, i) => Math.sin((2 * Math.PI * 440 * i) / sr),
    });
    const blob = audioBufferToWav(buf);
    expect(blob.size).toBe(44 + sr * 2);
    const view = await readView(blob);
    expect(readMagic(view, 0, 4)).toBe("RIFF");
    expect(readMagic(view, 8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sr); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("downmixes stereo to mono by averaging the channels", async () => {
    const buf = fakeBuffer({
      sampleRate: 8,
      channels: 2,
      length: 4,
      fill: (c, i) => (c === 0 ? 0.5 : -0.5) * (i % 2 === 0 ? 1 : 0),
    });
    const view = await readView(audioBufferToWav(buf));
    expect(view.getUint16(22, true)).toBe(1);
    // (0.5 + -0.5) / 2 = 0 across all samples.
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0);
  });
});
