// ABOUTME: recordClip tests — happy path, decode failure, duration honored.
// ABOUTME: Mocks MediaRecorder via a tiny fake that fires events on a timer.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordClip } from "./recorder";
import * as streamLifecycle from "./streamLifecycle";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn<(mimeType: string) => boolean>(() => true);
  static stopCalls = 0;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(_stream: MediaStream, _opts?: MediaRecorderOptions) {}

  start() {
    this.state = "recording";
  }

  stop() {
    FakeMediaRecorder.stopCalls += 1;
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/webm" }),
      } as BlobEvent);
      this.onstop?.();
    });
  }
}

const fakeAudioBuffer = { duration: 1, sampleRate: 48000 } as AudioBuffer;

function makeAudioContext(decode: (buf: ArrayBuffer) => Promise<AudioBuffer>) {
  return { decodeAudioData: vi.fn(decode) } as unknown as AudioContext;
}

function makeCapturingAudioContext(decode: (buf: ArrayBuffer) => Promise<AudioBuffer>) {
  let processor:
    | {
        onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
      }
    | null = null;

  const ctx = {
    sampleRate: 48000,
    destination: {},
    decodeAudioData: vi.fn(decode),
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
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        duration: length / sampleRate,
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (channel: number) => data[channel],
      } as unknown as AudioBuffer;
    }),
  } as unknown as AudioContext & { decodeAudioData: ReturnType<typeof vi.fn> };

  return {
    ctx,
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

describe("recordClip", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    FakeMediaRecorder.stopCalls = 0;
    FakeMediaRecorder.isTypeSupported.mockImplementation(() => true);
    originalRecorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeMediaRecorder;
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    vi.useRealTimers();
  });

  it("resolves with blob, audioBuffer, and the input duration", async () => {
    const ctx = makeAudioContext(async () => fakeAudioBuffer);
    const stream = {} as MediaStream;
    const result = await recordClip(stream, 20, ctx);
    expect(result.durationMs).toBe(20);
    expect(result.audioBuffer).toBe(fakeAudioBuffer);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toContain("webm");
  });

  it("uses MP4 when that is the only supported recording MIME", async () => {
    FakeMediaRecorder.isTypeSupported.mockImplementation((mimeType: string) => mimeType === "video/mp4");
    const ctx = makeAudioContext(async () => fakeAudioBuffer);
    const result = await recordClip({} as MediaStream, 20, ctx);
    expect(result.blob.type).toBe("video/mp4");
  });

  it("uses the live Web Audio capture even when decoding the video container would fail", async () => {
    const { ctx, fireAudioProcess } = makeCapturingAudioContext(async () => {
      throw new Error("container decode failed");
    });
    const stream = {
      getAudioTracks: () => [
        {
          kind: "audio",
          getSettings: () => ({ channelCount: 1 }),
        },
      ],
    } as unknown as MediaStream;

    const promise = recordClip(stream, 20, ctx);
    fireAudioProcess(new Float32Array([0.25, -0.5, 0.75]));
    const result = await promise;

    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    expect(Array.from(result.audioBuffer.getChannelData(0))).toEqual([0.25, -0.5, 0.75]);
  });

  it("throws a clear error if decode fails", async () => {
    const ctx = makeAudioContext(async () => {
      throw new Error("boom");
    });
    const stream = {} as MediaStream;
    await expect(recordClip(stream, 20, ctx)).rejects.toThrow(
      /Failed to decode recorded audio.*boom/,
    );
  });

  it("on MediaRecorder.onerror, recordClip rejects AND notifies streamLifecycle.onMediaRecorderError with the stream", async () => {
    const spy = vi.spyOn(streamLifecycle, "onMediaRecorderError").mockImplementation(() => undefined);
    // Use a custom fake that fires onerror instead of stopping cleanly.
    class ErrorFake extends FakeMediaRecorder {
      start() {
        this.state = "recording";
        queueMicrotask(() => {
          const event = new Event("error") as Event & { error: Error };
          event.error = new Error("encoder died");
          this.onerror?.(event);
        });
      }
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = ErrorFake;
    const ctx = makeAudioContext(async () => fakeAudioBuffer);
    const stream = {} as MediaStream;
    await expect(recordClip(stream, 1000, ctx)).rejects.toThrow(/encoder died/);
    expect(spy).toHaveBeenCalledWith(stream, expect.any(Error));
    spy.mockRestore();
  });

  it("aborting the signal mid-record stops the recorder and rejects with AbortError (regression for Esc cancel)", async () => {
    const ctx = makeAudioContext(async () => fakeAudioBuffer);
    const stream = {} as MediaStream;
    const controller = new AbortController();
    // Fire abort after the recorder has been started but before its timer.
    queueMicrotask(() => controller.abort());
    await expect(
      recordClip(stream, 1000, ctx, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeMediaRecorder.stopCalls).toBeGreaterThan(0);
  });
});
