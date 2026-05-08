// ABOUTME: autoTrim tests — RMS-based onset detection on synthesized AudioBuffers.
import { describe, it, expect } from "vitest";
import { autoTrim } from "./autoTrim";

interface FakeOpts {
  sampleRate?: number;
  durationMs: number;
  pulseAtMs?: number;
  pulseDurationMs?: number;
  pulseAmplitude?: number;
}

function makeFakeBuffer({
  sampleRate = 48000,
  durationMs,
  pulseAtMs,
  pulseDurationMs = 20,
  pulseAmplitude = 0.8,
}: FakeOpts): AudioBuffer {
  const length = Math.floor((durationMs / 1000) * sampleRate);
  const data = new Float32Array(length);
  if (pulseAtMs !== undefined) {
    const start = Math.floor((pulseAtMs / 1000) * sampleRate);
    const pulseSamples = Math.floor((pulseDurationMs / 1000) * sampleRate);
    for (let i = 0; i < pulseSamples; i++) {
      const t = i / pulseSamples;
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * t));
      const idx = start + i;
      if (idx < length)
        data[idx] = pulseAmplitude * w * Math.sin(2 * Math.PI * 1000 * (i / sampleRate));
    }
  }
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

describe("autoTrim", () => {
  it("locates a click at 500ms with ~50ms pre-roll, clamps end at buffer duration", () => {
    const buffer = makeFakeBuffer({ durationMs: 2000, pulseAtMs: 500 });
    const { trimStartMs, trimEndMs } = autoTrim(buffer);
    expect(trimStartMs).toBeGreaterThanOrEqual(440);
    expect(trimStartMs).toBeLessThanOrEqual(470);
    expect(trimEndMs).toBe(2000);
  });

  it("returns the full range for pure silence", () => {
    const { trimStartMs, trimEndMs } = autoTrim(makeFakeBuffer({ durationMs: 1000 }));
    expect(trimStartMs).toBe(0);
    expect(trimEndMs).toBe(1000);
  });

  it("caps content at 1500ms after the peak when buffer is long enough", () => {
    const { trimEndMs } = autoTrim(makeFakeBuffer({ durationMs: 4000, pulseAtMs: 200 }));
    expect(trimEndMs).toBeLessThanOrEqual(200 + 1500);
  });
});
