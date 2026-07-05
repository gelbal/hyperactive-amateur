// ABOUTME: export tests — buildExportStream wires the audio tap; exportSong runs Transport + MediaRecorder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toneMocks = vi.hoisted(() => {
  const destinationConnect = vi.fn();
  const destinationDisconnect = vi.fn();
  const toneStart = vi.fn().mockResolvedValue(undefined);
  const transport = { start: vi.fn(), stop: vi.fn(), position: 0 };
  const rawContext = {
    state: "running",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as AudioContext;
  return { destinationConnect, destinationDisconnect, toneStart, transport, rawContext };
});

const audioLifecycleMocks = vi.hoisted(() => {
  class TestAudioUnavailableError extends Error {
    constructor(message = "Audio unavailable") {
      super(message);
      this.name = "AudioUnavailableError";
    }
  }

  return {
    ensureAudioRunning: vi.fn(),
    AudioUnavailableError: TestAudioUnavailableError,
  };
});

vi.mock("tone", () => ({
  start: toneMocks.toneStart,
  getDestination: vi.fn(() => ({
    connect: toneMocks.destinationConnect,
    disconnect: toneMocks.destinationDisconnect,
  })),
  getTransport: vi.fn(() => toneMocks.transport),
  getContext: vi.fn(() => ({ rawContext: toneMocks.rawContext })),
}));

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import { buildExportStream, defaultExportFilename, downloadBlob, exportSong } from "./export";
import { abortActiveExport, __resetExportSessionForTesting } from "./exportSession";
import { useAppStore } from "../store/useAppStore";
import { AudioUnavailableError } from "./audioLifecycle";

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
    mimeType = "";
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
    audioLifecycleMocks.ensureAudioRunning.mockReset();
    audioLifecycleMocks.ensureAudioRunning.mockResolvedValue(undefined);
    useAppStore.getState().actions.reset();
    __resetExportSessionForTesting();
  });

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalRecorder;
    __resetExportSessionForTesting();
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
    expect(audioLifecycleMocks.ensureAudioRunning).toHaveBeenCalled();
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

  it("uses the MediaRecorder-reported MIME for the export blob when present", async () => {
    class ReportingMediaRecorder extends FakeMediaRecorder {
      mimeType = "video/webm";
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = ReportingMediaRecorder;

    const blob = await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/webm; codecs=vp9,opus",
    });

    expect(blob.type).toBe("video/webm");
  });

  it("falls back to the requested MIME when MediaRecorder reports none", async () => {
    const blob = await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/mp4",
    });

    expect(blob.type).toBe("video/mp4");
  });

  it("rejects and clears export session when audio startup is unavailable", async () => {
    const audioError = new AudioUnavailableError("Audio blocked");
    audioLifecycleMocks.ensureAudioRunning.mockRejectedValue(audioError);

    await expect(
      exportSong(makeCanvas(), makeAudioContext(), {
        bars: 1,
        bpm: 24000,
        mimeType: "video/webm",
      }),
    ).rejects.toBe(audioError);

    expect(useAppStore.getState().playback.isExporting).toBe(false);
    expect(abortActiveExport("after failure")).toBe(false);
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
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

  it("rejects and cleans up when the active export session is aborted", async () => {
    vi.useFakeTimers();
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      bars: 8,
      bpm: 60,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/page hidden/);

    await vi.advanceTimersByTimeAsync(10);
    expect(abortActiveExport("page hidden")).toBe(true);

    await rejection;
    expect(toneMocks.destinationDisconnect).toHaveBeenCalled();
    expect(toneMocks.transport.stop).toHaveBeenCalled();
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("rejects overlapping export attempts without aborting the active export", async () => {
    vi.useFakeTimers();
    const first = exportSong(makeCanvas(), makeAudioContext(), {
      bars: 8,
      bpm: 60,
      mimeType: "video/webm",
    });

    await expect(
      exportSong(makeCanvas(), makeAudioContext(), {
        bars: 1,
        bpm: 24000,
        mimeType: "video/webm",
      }),
    ).rejects.toThrow(/Cannot export|Another export/);

    expect(useAppStore.getState().playback.isExporting).toBe(true);
    expect(abortActiveExport("page hidden")).toBe(true);
    await expect(first).rejects.toThrow(/page hidden/);
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });
});

describe("downloadBlob", () => {
  it("delays object URL revocation until after the synthetic click has been dispatched", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/download");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    try {
      downloadBlob(new Blob(["x"], { type: "video/webm" }), "beat.webm");

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runOnlyPendingTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/download");
    } finally {
      vi.useRealTimers();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      click.mockRestore();
    }
  });
});
