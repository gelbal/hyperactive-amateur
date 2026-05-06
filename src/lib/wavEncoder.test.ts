// ABOUTME: wavEncoder tests — header layout + sample count + stereo→mono mixdown.
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
  const buffer = await blob.arrayBuffer();
  return new DataView(buffer);
}

function readMagic(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("audioBufferToWav", () => {
  it("encodes a 1s 440Hz sine to 96044 bytes (header + 48k samples * 2)", async () => {
    const sr = 48000;
    const buf = fakeBuffer({
      sampleRate: sr,
      channels: 1,
      length: sr,
      fill: (_c, i) => Math.sin((2 * Math.PI * 440 * i) / sr),
    });
    const blob = audioBufferToWav(buf);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + sr * 2);
  });

  it("writes a valid RIFF/WAVE header", async () => {
    const sr = 48000;
    const buf = fakeBuffer({ sampleRate: sr, channels: 1, length: sr });
    const view = await readView(audioBufferToWav(buf));
    expect(readMagic(view, 0, 4)).toBe("RIFF");
    expect(readMagic(view, 8, 4)).toBe("WAVE");
    expect(readMagic(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sr); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readMagic(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(sr * 2);
  });

  it("downmixes stereo to mono by averaging channels", async () => {
    const sr = 8;
    const buf = fakeBuffer({
      sampleRate: sr,
      channels: 2,
      length: 4,
      fill: (c, i) => (c === 0 ? 0.5 : -0.5) * (i % 2 === 0 ? 1 : 0),
    });
    const view = await readView(audioBufferToWav(buf));
    // Output is mono, header reports 1 channel.
    expect(view.getUint16(22, true)).toBe(1);
    // Averaged samples should all be 0 (0.5 + -0.5)/2 — even index — and 0 odd.
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0);
  });

  it("handles an empty buffer with a valid 44-byte header", () => {
    const buf = fakeBuffer({ sampleRate: 48000, channels: 1, length: 0 });
    const blob = audioBufferToWav(buf);
    expect(blob.size).toBe(44);
  });
});
