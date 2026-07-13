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

import {
  buildExportStream,
  defaultExportFilename,
  downloadBlob,
  exportSong,
  MOOD_EXPORT_MAX_MS,
} from "./export";
import {
  abortActiveExport,
  getActiveExportSession,
  __resetExportSessionForTesting,
} from "./exportSession";
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

interface WakeLockSentinelStub extends EventTarget {
  released: boolean;
  release: () => Promise<void>;
}

interface WakeLockStub {
  request: (type: "screen") => Promise<WakeLockSentinelStub>;
}

type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockStub };

function installWakeLockStub(onRequest?: () => void): {
  request: ReturnType<typeof vi.fn<(type: "screen") => Promise<WakeLockSentinelStub>>>;
  sentinels: WakeLockSentinelStub[];
} {
  const sentinels: WakeLockSentinelStub[] = [];
  const request = vi.fn(async (_type: "screen") => {
    onRequest?.();
    const sentinel = new EventTarget() as WakeLockSentinelStub;
    sentinel.released = false;
    sentinel.release = vi.fn(async () => {
      sentinel.released = true;
      sentinel.dispatchEvent(new Event("release"));
    });
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
  return { request, sentinels };
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
  let originalWakeLock: WakeLockStub | undefined;

  class FakeMediaRecorder {
    static isTypeSupported = vi.fn(() => true);
    static startSpy = vi.fn();
    state: "inactive" | "recording" = "inactive";
    mimeType = "";
    ondataavailable: ((e: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(_stream: MediaStream, _opts: MediaRecorderOptions) {}
    start() {
      this.state = "recording";
      FakeMediaRecorder.startSpy();
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
    originalWakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeMediaRecorder;
    FakeMediaRecorder.startSpy.mockReset();
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
    if (originalWakeLock) {
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: originalWakeLock,
      });
    } else {
      Reflect.deleteProperty(navigator, "wakeLock");
    }
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

  it("defaultExportFilename: mood exports get the mood- prefix", () => {
    expect(defaultExportFilename("webm", "mood-")).toMatch(
      /^mood-hyperactive-amateur-\d{4}\d{2}\d{2}-\d{2}\d{2}\.webm$/,
    );
  });

  it("exports the Mood stop-signal cap as three minutes", () => {
    expect(MOOD_EXPORT_MAX_MS).toBe(180_000);
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

  it("resolves stop-signal exports without touching the chop transport by default", async () => {
    vi.useFakeTimers();
    let stopTake: () => void = () => undefined;
    const stopSignal = new Promise<void>((resolve) => {
      stopTake = resolve;
    });

    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      stopSignal,
      maxDurationMs: 1000,
      mimeType: "video/webm",
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeMediaRecorder.startSpy).toHaveBeenCalledTimes(1);
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
    expect(toneMocks.transport.stop).not.toHaveBeenCalled();

    stopTake();
    const blob = await promise;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.capped).toBe(false);
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
    expect(toneMocks.transport.stop).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("runs supplied drive hooks around a stop-signal export", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    FakeMediaRecorder.startSpy.mockImplementation(() => order.push("recorder-start"));
    let stopTake: () => void = () => undefined;
    const stopSignal = new Promise<void>((resolve) => {
      stopTake = resolve;
    });

    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      stopSignal,
      maxDurationMs: 1000,
      mimeType: "video/webm",
      drive: {
        prepare: vi.fn(() => {
          order.push("prepare");
        }),
        start: vi.fn(() => {
          order.push("start");
        }),
        cleanup: vi.fn(() => {
          order.push("cleanup");
        }),
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    stopTake();
    const blob = await promise;

    expect(blob.capped).toBe(false);
    expect(order).toEqual(["prepare", "recorder-start", "start", "cleanup"]);
  });

  it("flags stop-signal exports that reach the hard cap", async () => {
    vi.useFakeTimers();
    const onProgress = vi.fn();
    const neverStop = new Promise<void>(() => undefined);

    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      stopSignal: neverStop,
      maxDurationMs: 50,
      mimeType: "video/webm",
      onProgress,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(50);
    const blob = await promise;

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.capped).toBe(true);
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(1);
  });

  it("lets an active abort beat a same-tick stop signal", async () => {
    vi.useFakeTimers();
    let stopTake: () => void = () => undefined;
    const stopSignal = new Promise<void>((resolve) => {
      stopTake = resolve;
    });
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      stopSignal,
      maxDurationMs: 1000,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/page hidden/);

    await vi.advanceTimersByTimeAsync(10);
    stopTake();
    expect(abortActiveExport("page hidden")).toBe(true);

    await rejection;
    expect(toneMocks.destinationDisconnect).toHaveBeenCalled();
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("keeps the recorder stop watchdog for stop-signal exports", async () => {
    class StuckMediaRecorder extends FakeMediaRecorder {
      stop() {
        this.state = "inactive";
      }
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = StuckMediaRecorder;

    vi.useFakeTimers();
    let stopTake: () => void = () => undefined;
    const stopSignal = new Promise<void>((resolve) => {
      stopTake = resolve;
    });
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      stopSignal,
      maxDurationMs: 1000,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/did not finish export/);

    await vi.advanceTimersByTimeAsync(10);
    stopTake();
    await vi.advanceTimersByTimeAsync(5000);

    await rejection;
    expect(toneMocks.destinationDisconnect).toHaveBeenCalled();
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("keeps the zero-chunk guard for stop-signal exports", async () => {
    class EmptyMediaRecorder extends FakeMediaRecorder {
      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob([], { type: "video/webm" }),
          } as BlobEvent);
          this.onstop?.();
        });
      }
    }
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = EmptyMediaRecorder;

    vi.useFakeTimers();
    let stopTake: () => void = () => undefined;
    const stopSignal = new Promise<void>((resolve) => {
      stopTake = resolve;
    });
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      stopSignal,
      maxDurationMs: 1000,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/without producing data/);

    await vi.advanceTimersByTimeAsync(10);
    stopTake();

    await rejection;
    expect(toneMocks.destinationDisconnect).toHaveBeenCalled();
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("rejects export starts while recording is active", async () => {
    useAppStore.getState().actions.setRecordingState("recording", 1);

    await expect(
      exportSong(makeCanvas(), makeAudioContext(), {
        bars: 1,
        bpm: 24000,
        mimeType: "video/webm",
      }),
    ).rejects.toThrow(/Cannot export while recording/);

    expect(FakeMediaRecorder.startSpy).not.toHaveBeenCalled();
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
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

  it("requests a screen wake lock after session registration and before rendering", async () => {
    const order: string[] = [];
    FakeMediaRecorder.startSpy.mockImplementation(() => order.push("render"));
    const { request, sentinels } = installWakeLockStub(() => {
      order.push("wake-lock");
      expect(getActiveExportSession()).not.toBeNull();
      expect(useAppStore.getState().playback.isExporting).toBe(true);
    });

    await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/webm",
    });

    expect(request).toHaveBeenCalledWith("screen");
    expect(order).toEqual(["wake-lock", "render"]);
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("releases the screen wake lock when an active export is aborted", async () => {
    vi.useFakeTimers();
    const { sentinels } = installWakeLockStub();
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      bars: 8,
      bpm: 60,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/page hidden/);

    await vi.advanceTimersByTimeAsync(10);
    expect(sentinels).toHaveLength(1);
    expect(abortActiveExport("page hidden")).toBe(true);

    await rejection;
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("rejects with the abort reason when aborted while the wake-lock request is pending", async () => {
    const canvas = makeCanvas();
    let resolveRequest: (sentinel: WakeLockSentinelStub) => void = () => undefined;
    const sentinel = new EventTarget() as WakeLockSentinelStub;
    sentinel.released = false;
    sentinel.release = vi.fn(async () => {
      sentinel.released = true;
      sentinel.dispatchEvent(new Event("release"));
    });
    const request = vi.fn(
      (_type: "screen") =>
        new Promise<WakeLockSentinelStub>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    const promise = exportSong(canvas, makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/aborted during setup/);

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(abortActiveExport("aborted during setup")).toBe(true);

    await rejection;
    expect(useAppStore.getState().playback.isExporting).toBe(false);
    expect(abortActiveExport("after failure")).toBe(false);
    expect(canvas.captureStream).not.toHaveBeenCalled();
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.startSpy).not.toHaveBeenCalled();

    // A wake lock granted after the abort must still be released.
    resolveRequest(sentinel);
    await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalledTimes(1));
  });

  it("rejects with the abort reason when aborted while audio startup is pending", async () => {
    installWakeLockStub();
    const canvas = makeCanvas();
    let resolveAudio: () => void = () => undefined;
    audioLifecycleMocks.ensureAudioRunning.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAudio = () => resolve();
      }),
    );

    const promise = exportSong(canvas, makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/aborted during setup/);

    await vi.waitFor(() =>
      expect(audioLifecycleMocks.ensureAudioRunning).toHaveBeenCalledTimes(1),
    );
    expect(abortActiveExport("aborted during setup")).toBe(true);

    await rejection;
    expect(useAppStore.getState().playback.isExporting).toBe(false);
    expect(abortActiveExport("after failure")).toBe(false);
    expect(canvas.captureStream).not.toHaveBeenCalled();
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.startSpy).not.toHaveBeenCalled();

    // Audio resuming after the abort must not restart any export work.
    resolveAudio();
    await Promise.resolve();
    expect(canvas.captureStream).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.isExporting).toBe(false);
  });

  it("does not require wakeLock support to render", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");

    const blob = await exportSong(makeCanvas(), makeAudioContext(), {
      bars: 1,
      bpm: 24000,
      mimeType: "video/webm",
    });

    expect(blob.size).toBeGreaterThan(0);
  });

  it("re-requests the screen wake lock on visible while an export is still rendering", async () => {
    vi.useFakeTimers();
    const { request, sentinels } = installWakeLockStub();
    const promise = exportSong(makeCanvas(), makeAudioContext(), {
      bars: 8,
      bpm: 60,
      mimeType: "video/webm",
    });
    const rejection = expect(promise).rejects.toThrow(/page hidden/);

    await vi.advanceTimersByTimeAsync(10);
    expect(request).toHaveBeenCalledTimes(1);
    await sentinels[0]?.release();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(abortActiveExport("page hidden")).toBe(true);
    await rejection;
    expect(sentinels[1]?.release).toHaveBeenCalledTimes(1);
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
  it("returns the created object URL and leaves revocation to the caller", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/download");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    try {
      const url = downloadBlob(new Blob(["x"], { type: "video/webm" }), "beat.webm");

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(url).toBe("blob:test/download");
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      click.mockRestore();
    }
  });
});
