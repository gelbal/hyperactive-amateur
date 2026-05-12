// ABOUTME: audioBufferSlice tests — sample-accurate window copies + clamping behavior.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sliceAudioBuffer } from "./audioBufferSlice";

// The slice helper depends on getAudioContext() for createBuffer; vi.mock
// short-circuits that so tests don't need a real WebAudio context.
vi.mock("./audio", () => ({
  getAudioContext: () => fakeContext,
}));

const fakeContext = {
  createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      sampleRate,
      length,
      duration: length / sampleRate,
      numberOfChannels: channels,
      channels: data,
      getChannelData: (c: number) => data[c],
    } as unknown as AudioBuffer;
  }),
} as unknown as AudioContext;

function makeBuffer(
  sampleRate: number,
  channels: number,
  fill: (channel: number, sampleIndex: number) => number,
  length: number,
): AudioBuffer {
  const data = Array.from({ length: channels }, (_, c) => {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) arr[i] = fill(c, i);
    return arr;
  });
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels,
    getChannelData: (c: number) => data[c],
  } as unknown as AudioBuffer;
}

describe("sliceAudioBuffer", () => {
  beforeEach(() => {
    (fakeContext.createBuffer as ReturnType<typeof vi.fn>).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("copies the requested window with sample-accurate length and preserves the source values", () => {
    const sr = 48000;
    // Fill the source with the sample index so we can assert which samples landed in the slice.
    const src = makeBuffer(sr, 1, (_c, i) => i, sr * 2);
    const out = sliceAudioBuffer(src, 50, 1000);
    // 50 ms → 2400, 1000 ms → 48000, so length is 45600.
    expect(out.length).toBe(45600);
    expect(out.sampleRate).toBe(sr);
    expect(out.numberOfChannels).toBe(1);
    const slice = out.getChannelData(0);
    expect(slice[0]).toBe(2400); // first sample of the window
    expect(slice[slice.length - 1]).toBe(48000 - 1);
  });

  it("clamps an out-of-range window to the source bounds and still returns a valid buffer", () => {
    const sr = 48000;
    const src = makeBuffer(sr, 2, (c, i) => (c === 0 ? i : -i), sr);
    const out = sliceAudioBuffer(src, -500, 5000);
    // Clamped to [0, sr] → length 48000.
    expect(out.length).toBe(48000);
    expect(out.numberOfChannels).toBe(2);
    // Float32Array initializes to +0; channel 1's fill is -i, so sample 0
    // is -0 — assert by absolute value to keep IEEE-754 sign noise out.
    expect(Math.abs(out.getChannelData(0)[0])).toBe(0);
    expect(Math.abs(out.getChannelData(1)[0])).toBe(0);
  });
});
