// ABOUTME: autoTrim tests — synthesizes AudioBuffers with click pulses, asserts trim window.
// ABOUTME: Edge cases: pure silence, ultra-short buffers, late-onset clamps to clip duration.
import { describe, it, expect } from "vitest";
import { autoTrim } from "./autoTrim";

interface FakeAudioBufferOpts {
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
}: FakeAudioBufferOpts): AudioBuffer {
  const length = Math.floor((durationMs / 1000) * sampleRate);
  const data = new Float32Array(length);

  if (pulseAtMs !== undefined) {
    const startSample = Math.floor((pulseAtMs / 1000) * sampleRate);
    const pulseSamples = Math.floor((pulseDurationMs / 1000) * sampleRate);
    for (let i = 0; i < pulseSamples; i++) {
      const t = i / pulseSamples;
      // Simple Hann-windowed pulse.
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * t));
      const idx = startSample + i;
      if (idx < length) data[idx] = pulseAmplitude * w * Math.sin(2 * Math.PI * 1000 * (i / sampleRate));
    }
  }

  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: 1,
    getChannelData: (_channel: number) => data,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

describe("autoTrim", () => {
  it("locates a click at 500ms in 2s of silence and applies pre-roll", () => {
    const buffer = makeFakeBuffer({ durationMs: 2000, pulseAtMs: 500 });
    const { trimStartMs, trimEndMs } = autoTrim(buffer);
    expect(trimStartMs).toBeGreaterThanOrEqual(440);
    expect(trimStartMs).toBeLessThanOrEqual(470);
    expect(trimEndMs).toBe(2000);
  });

  it("clamps end to buffer duration when peak is late", () => {
    const buffer = makeFakeBuffer({ durationMs: 2000, pulseAtMs: 1500 });
    const { trimEndMs } = autoTrim(buffer);
    expect(trimEndMs).toBe(2000);
  });

  it("returns full range for pure silence", () => {
    const buffer = makeFakeBuffer({ durationMs: 1000 });
    const { trimStartMs, trimEndMs } = autoTrim(buffer);
    expect(trimStartMs).toBe(0);
    expect(trimEndMs).toBe(1000);
  });

  it("returns full range for ultra-short buffers", () => {
    const buffer = makeFakeBuffer({ durationMs: 30 });
    const { trimStartMs, trimEndMs } = autoTrim(buffer);
    expect(trimStartMs).toBe(0);
    expect(trimEndMs).toBeCloseTo(30, 0);
  });

  it("end is at most onset + 1500ms when buffer is long enough", () => {
    const buffer = makeFakeBuffer({ durationMs: 4000, pulseAtMs: 200 });
    const { trimEndMs } = autoTrim(buffer);
    expect(trimEndMs).toBeLessThanOrEqual(200 + 1500);
  });
});
