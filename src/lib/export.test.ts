// ABOUTME: export tests — buildExportStream wires the audio tap; exportSong runs Transport + MediaRecorder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const destinationConnect = vi.fn();
const destinationDisconnect = vi.fn();
const transport = { start: vi.fn(), stop: vi.fn(), position: 0 };
vi.mock("tone", () => ({
  getDestination: vi.fn(() => ({
    connect: destinationConnect,
    disconnect: destinationDisconnect,
  })),
  getTransport: vi.fn(() => transport),
}));

import { buildExportStream, defaultExportFilename, exportSong } from "./export";

function makeCanvas(): HTMLCanvasElement {
  const videoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    captureStream: vi.fn(() => ({
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack],
    })),
  } as unknown as HTMLCanvasElement;
}
function makeAudioContext() {
  const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    createMediaStreamDestination: vi.fn(() => ({
      stream: { getAudioTracks: () => [audioTrack] },
    })),
  } as unknown as AudioContext;
}

describe("buildExportStream", () => {
  beforeEach(() => {
    destinationConnect.mockClear();
    destinationDisconnect.mockClear();
  });

  it("returns a stream with a video + audio track and cleanup disconnects the tap", () => {
    const { stream, cleanup } = buildExportStream(makeCanvas(), makeAudioContext());
    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
    expect(destinationConnect).toHaveBeenCalledTimes(1);
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
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
  });

  it("defaultExportFilename: default extension is .webm; .mp4 is honored when passed", () => {
    expect(defaultExportFilename()).toMatch(
      /^hyperactive-amateur-\d{4}\d{2}\d{2}-\d{2}\d{2}\.webm$/,
    );
    expect(defaultExportFilename("mp4")).toMatch(
      /^hyperactive-amateur-\d{4}\d{2}\d{2}-\d{2}\d{2}\.mp4$/,
    );
  });

  it("starts/stops the Transport, reports progress, and resolves with a Blob using the caller's mimeType", async () => {
    const onProgress = vi.fn();
    const blob = await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 240,
      mimeType: "video/webm; codecs=vp9,opus",
      onProgress,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toContain("video/webm");
    expect(transport.start).toHaveBeenCalled();
    expect(transport.stop).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(1);
  });

  it("exportSong honors a video/mp4 mimeType passed by the caller", async () => {
    const blob = await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 240,
      mimeType: "video/mp4",
    });
    expect(blob.type).toBe("video/mp4");
  });
});

