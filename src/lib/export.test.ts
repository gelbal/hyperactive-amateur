// ABOUTME: export tests — buildExportStream wires the audio tap; exportSong runs Transport + MediaRecorder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toneMocks = vi.hoisted(() => {
  const destinationConnect = vi.fn();
  const destinationDisconnect = vi.fn();
  const toneStart = vi.fn().mockResolvedValue(undefined);
  const transport = { start: vi.fn(), stop: vi.fn(), position: 0 };
  return { destinationConnect, destinationDisconnect, toneStart, transport };
});

vi.mock("tone", () => ({
  start: toneMocks.toneStart,
  getDestination: vi.fn(() => ({
    connect: toneMocks.destinationConnect,
    disconnect: toneMocks.destinationDisconnect,
  })),
  getTransport: vi.fn(() => toneMocks.transport),
}));

import { buildExportStream, defaultExportFilename, exportSong } from "./export";
import { useAppStore } from "../store/useAppStore";

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
    toneMocks.destinationConnect.mockClear();
    toneMocks.destinationDisconnect.mockClear();
  });

  it("returns a stream with a video + audio track and cleanup disconnects the tap", () => {
    const { stream, cleanup } = buildExportStream(makeCanvas(), makeAudioContext());
    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(stream.getAudioTracks()).toHaveLength(1);
    expect(toneMocks.destinationConnect).toHaveBeenCalledTimes(1);
    cleanup();
    expect(toneMocks.destinationDisconnect).toHaveBeenCalledTimes(1);
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
    requestData() {}
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
    toneMocks.transport.start.mockClear();
    toneMocks.transport.stop.mockClear();
    toneMocks.transport.position = 0;
    toneMocks.toneStart.mockClear();
    toneMocks.destinationDisconnect.mockClear();
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    vi.useRealTimers();
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
      bpm: 24000,
      mimeType: "video/webm; codecs=vp9,opus",
      onProgress,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toContain("video/webm");
    expect(toneMocks.transport.start).toHaveBeenCalled();
    expect(toneMocks.transport.stop).toHaveBeenCalled();
    expect(toneMocks.toneStart).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(1);
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("exportSong honors a video/mp4 mimeType passed by the caller", async () => {
    const blob = await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/mp4",
    });
    expect(blob.type).toBe("video/mp4");
  });

  it("rejects and cleans up when MediaRecorder never finishes after stop", async () => {
    class StuckMediaRecorder extends FakeMediaRecorder {
      stop() {
        this.state = "inactive";
      }
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = StuckMediaRecorder;

    vi.useFakeTimers();
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/did not finish export/);

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(5000);

    await rejection;
    expect(toneMocks.destinationDisconnect).toHaveBeenCalled();
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });
});
