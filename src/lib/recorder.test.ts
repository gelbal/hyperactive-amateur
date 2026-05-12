// ABOUTME: recordClip tests — happy path, decode failure, duration honored.
// ABOUTME: Mocks MediaRecorder via a tiny fake that fires events on a timer.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordClip } from "./recorder";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  static stopCalls = 0;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(_stream: MediaStream, _opts: MediaRecorderOptions) {}

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

describe("recordClip", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  beforeEach(() => {
    FakeMediaRecorder.stopCalls = 0;
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

  it("throws a clear error if decode fails", async () => {
    const ctx = makeAudioContext(async () => {
      throw new Error("boom");
    });
    const stream = {} as MediaStream;
    await expect(recordClip(stream, 20, ctx)).rejects.toThrow(
      /Failed to decode recorded audio.*boom/,
    );
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
