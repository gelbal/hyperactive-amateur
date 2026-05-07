// ABOUTME: export tests — buildExportStream + exportSong with a fake MediaRecorder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const destinationConnect = vi.fn();
const destinationDisconnect = vi.fn();
const transport = {
  start: vi.fn(),
  stop: vi.fn(),
  position: 0,
};
vi.mock("tone", () => ({
  getDestination: vi.fn(() => ({
    connect: destinationConnect,
    disconnect: destinationDisconnect,
  })),
  getTransport: vi.fn(() => transport),
}));

import { buildExportStream, exportSong, defaultExportFilename } from "./export";

function makeCanvas(): HTMLCanvasElement {
  const videoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  const canvas = {
    captureStream: vi.fn(() => ({
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack],
    })),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function makeAudioContext() {
  const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    createMediaStreamDestination: vi.fn(() => ({
      stream: {
        getAudioTracks: () => [audioTrack],
      },
    })),
  } as unknown as AudioContext;
}

describe("buildExportStream", () => {
  beforeEach(() => {
    destinationConnect.mockClear();
    destinationDisconnect.mockClear();
  });

  it("returns a MediaStream with a video and audio track", () => {
    const canvas = makeCanvas();
    const ctx = makeAudioContext();
    const { stream, cleanup } = buildExportStream(canvas, ctx);
    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
    expect(destinationConnect).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("cleanup disconnects the destination tap", () => {
    const canvas = makeCanvas();
    const ctx = makeAudioContext();
    const { cleanup } = buildExportStream(canvas, ctx);
    cleanup();
    expect(destinationDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe("exportSong", () => {
  let originalRecorder: typeof MediaRecorder | undefined;

  class FakeMediaRecorder {
    static isTypeSupported = vi.fn(() => true);
    state: "inactive" | "recording" = "inactive";
    ondataavailable: ((e: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(_stream: MediaStream, _opts: MediaRecorderOptions) {}
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([9, 8, 7])], { type: "video/webm" }),
        } as BlobEvent);
        this.onstop?.();
      });
    }
  }

  beforeEach(() => {
    originalRecorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeMediaRecorder;
    transport.start.mockClear();
    transport.stop.mockClear();
    transport.position = 0;
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
  });

  it("resolves with a Blob and reports progress", async () => {
    const canvas = makeCanvas();
    const ctx = makeAudioContext();
    const onProgress = vi.fn();
    const blob = await exportSong(canvas, ctx, { bars: 1, bpm: 240, onProgress });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalled();
    // Always called with 1 at the end.
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(1);
  });

  it("starts and stops the Transport", async () => {
    const canvas = makeCanvas();
    const ctx = makeAudioContext();
    await exportSong(canvas, ctx, { bars: 1, bpm: 240 });
    expect(transport.start).toHaveBeenCalled();
    expect(transport.stop).toHaveBeenCalled();
  });
});

describe("defaultExportFilename", () => {
  it("matches the hyperactive-amateur-YYYYMMDD-HHmm.webm shape", () => {
    expect(defaultExportFilename()).toMatch(/^hyperactive-amateur-\d{8}-\d{4}\.webm$/);
  });
});
