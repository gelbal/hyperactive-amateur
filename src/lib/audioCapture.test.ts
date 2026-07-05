// ABOUTME: Tests for live Web Audio sidecar capture windowing and channel assembly.
// ABOUTME: Drives ScriptProcessor callbacks directly with tiny browser API fakes.
import { describe, expect, it, vi } from "vitest";
import { startAudioBufferCapture } from "./audioCapture";

function makeTrack(): MediaStreamTrack {
  return {
    kind: "audio",
    getSettings: () => ({ channelCount: 1 }),
  } as unknown as MediaStreamTrack;
}

function makeStream(track = makeTrack()): MediaStream {
  return {
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

function makeAudioContext(sampleRate = 48_000) {
  let processor:
    | {
        onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
      }
    | null = null;

  const context = {
    sampleRate,
    destination: {},
    createMediaStreamSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createScriptProcessor: vi.fn(() => {
      processor = {
        onaudioprocess: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      return processor;
    }),
    createBuffer: vi.fn((channels: number, length: number, bufferSampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        duration: length / bufferSampleRate,
        length,
        numberOfChannels: channels,
        sampleRate: bufferSampleRate,
        getChannelData: (channel: number) => data[channel],
      } as unknown as AudioBuffer;
    }),
  } as unknown as AudioContext;

  return {
    context,
    fireAudioProcess(samples: Float32Array) {
      processor?.onaudioprocess?.({
        inputBuffer: {
          length: samples.length,
          numberOfChannels: 1,
          getChannelData: () => samples,
        },
        outputBuffer: {
          numberOfChannels: 1,
          getChannelData: () => new Float32Array(samples.length),
        },
      } as unknown as AudioProcessingEvent);
    },
  };
}

describe("startAudioBufferCapture", () => {
  it("crops over-collected samples to maxDurationMs", () => {
    const { context, fireAudioProcess } = makeAudioContext();
    const capture = startAudioBufferCapture(makeStream(), context, { maxDurationMs: 20 });
    expect(capture).not.toBeNull();

    fireAudioProcess(new Float32Array(700).fill(0.25));
    fireAudioProcess(new Float32Array(700).fill(-0.5));

    const buffer = capture?.stop();
    expect(buffer).not.toBeNull();
    expect(buffer?.length).toBe(960);
    expect(buffer?.duration).toBe(0.02);
    expect(buffer?.getChannelData(0)[0]).toBe(0.25);
    expect(buffer?.getChannelData(0)[699]).toBe(0.25);
    expect(buffer?.getChannelData(0)[700]).toBe(-0.5);
    expect(buffer?.getChannelData(0)[959]).toBe(-0.5);
  });

  it("keeps an under-collected capture at its actual length", () => {
    const { context, fireAudioProcess } = makeAudioContext();
    const capture = startAudioBufferCapture(makeStream(), context, { maxDurationMs: 20 });
    expect(capture).not.toBeNull();

    fireAudioProcess(new Float32Array([0.25, -0.5, 0.75]));

    const buffer = capture?.stop();
    expect(buffer).not.toBeNull();
    expect(buffer?.length).toBe(3);
    expect(Array.from(buffer?.getChannelData(0) ?? [])).toEqual([0.25, -0.5, 0.75]);
  });
});
