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
  getContext: vi.fn(() => ({ rawContext: toneMocks.rawContext, lookAhead: 0.1 })),
  now: vi.fn(() => 10),
}));

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import {
  COVER_WAIT_MS,
  buildExportStream,
  defaultExportFilename,
  downloadBlob,
  exportSong,
  getRecordedHoldSec,
} from "./export";
import {
  abortActiveExport,
  getActiveExportSession,
  __resetExportSessionForTesting,
} from "./exportSession";
import { useAppStore } from "../store/useAppStore";
import { AudioUnavailableError } from "./audioLifecycle";
import { LOG_EVENTS, logger } from "./logger";
import { drawCurrentFrame, hasLiveFrame } from "./videoEngine";

function makeCanvas(): HTMLCanvasElement {
  const videoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    captureStream: vi.fn(() => ({
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack],
    })),
  } as unknown as HTMLCanvasElement;
}
// A 480 px render canvas whose 2D context records draws.
function makeCanvasWithContext(): HTMLCanvasElement & { drawImage: ReturnType<typeof vi.fn> } {
  const canvas = makeCanvas() as HTMLCanvasElement & { drawImage: ReturnType<typeof vi.fn> };
  const drawImage = vi.fn();
  Object.assign(canvas, {
    width: 480,
    height: 480,
    drawImage,
    getContext: vi.fn(() => ({ drawImage })),
  });
  return canvas;
}

function makeCard(): HTMLCanvasElement {
  const card = document.createElement("canvas");
  card.width = 480;
  card.height = 480;
  return card;
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

  describe("share card", () => {
    afterEach(() => {
      toneMocks.transport.stop.mockReset();
      toneMocks.transport.start.mockReset();
      vi.restoreAllMocks();
    });

    it("holds the card before recording and starts the transport one beat later", async () => {
      const order: string[] = [];
      const card = makeCard();
      const canvas = makeCanvasWithContext();
      toneMocks.transport.stop.mockImplementation(() => order.push("stop"));
      canvas.drawImage.mockImplementation((source: unknown) => {
        if (source === card) order.push(hasLiveFrame() ? "paint held card" : "paint");
      });
      FakeMediaRecorder.startSpy.mockImplementation(() => order.push("record"));
      toneMocks.transport.start.mockImplementation(() => order.push("transport"));

      await exportSong(canvas, makeAudioContext(), {
        bars: 1,
        bpm: 24000,
        mimeType: "video/webm",
        cover: Promise.resolve(card),
      });

      expect(order.slice(0, 4)).toEqual(["stop", "paint held card", "record", "transport"]);
      expect(canvas.drawImage).toHaveBeenCalledWith(card, 0, 0, 480, 480);
      expect(toneMocks.transport.start).toHaveBeenCalledWith(10 + 60 / 24000);
    });

    it("rejects on an abort while the cover is pending, before any stream, recorder or hold", async () => {
      const canvas = makeCanvasWithContext();
      const promise = exportSong(canvas, makeAudioContext(), {
        bars: 1,
        bpm: 120,
        mimeType: "video/webm",
        cover: new Promise<HTMLCanvasElement>(() => undefined),
      });
      const rejection = expect(promise).rejects.toThrow(/page hidden/);

      await vi.waitFor(() => expect(audioLifecycleMocks.ensureAudioRunning).toHaveBeenCalled());
      expect(abortActiveExport("page hidden")).toBe(true);

      await rejection;
      expect(canvas.captureStream).not.toHaveBeenCalled();
      expect(FakeMediaRecorder.startSpy).not.toHaveBeenCalled();
      expect(toneMocks.transport.start).not.toHaveBeenCalled();
      expect(hasLiveFrame()).toBe(false);
    });

    it("releases the card when the export is aborted during the hold", async () => {
      vi.useFakeTimers();
      const promise = exportSong(makeCanvasWithContext(), makeAudioContext(), {
        bars: 1,
        bpm: 60,
        mimeType: "video/webm",
        cover: Promise.resolve(makeCard()),
      });
      const rejection = expect(promise).rejects.toThrow(/page hidden/);

      await vi.advanceTimersByTimeAsync(500);
      expect(hasLiveFrame()).toBe(true);
      expect(abortActiveExport("page hidden")).toBe(true);
      await rejection;

      expect(hasLiveFrame()).toBe(false);
      const ctx = {
        canvas: { width: 480, height: 480 },
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
      drawCurrentFrame(ctx, 0);
      expect(ctx.fillStyle).toBe("#0a0a0a");
      expect(ctx.drawImage).not.toHaveBeenCalled();
    });

    it("renders the bars plus the hold and reports progress over both", async () => {
      vi.useFakeTimers();
      const onProgress = vi.fn();
      const promise = exportSong(makeCanvasWithContext(), makeAudioContext(), {
        bars: 1,
        bpm: 60,
        mimeType: "video/webm",
        onProgress,
        cover: Promise.resolve(makeCard()),
      });

      await vi.advanceTimersByTimeAsync(2500);
      expect(onProgress.mock.calls.at(-1)?.[0]).toBeCloseTo(0.5, 1);
      await vi.advanceTimersByTimeAsync(2400);
      expect(useAppStore.getState().playback.isExporting).toBe(true);
      await vi.advanceTimersByTimeAsync(200);

      await expect(promise).resolves.toBeInstanceOf(Blob);
      expect(onProgress.mock.calls.at(-1)?.[0]).toBe(1);
    });

    it("a late cover renders the flat fallback card with the hold", async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const fallback = makeCard();
      const canvas = makeCanvasWithContext();
      const promise = exportSong(canvas, makeAudioContext(), {
        bars: 1,
        bpm: 120,
        mimeType: "video/webm",
        cover: new Promise<HTMLCanvasElement>(() => undefined),
        coverFallback: fallback,
      });

      await vi.advanceTimersByTimeAsync(COVER_WAIT_MS);
      expect(warn).toHaveBeenCalledWith(LOG_EVENTS.COVER_LATE, { waitedMs: COVER_WAIT_MS });
      expect(canvas.drawImage).toHaveBeenCalledWith(fallback, 0, 0, 480, 480);
      expect(toneMocks.transport.start).toHaveBeenCalledWith(10.5);

      await vi.advanceTimersByTimeAsync(2600);
      await expect(promise).resolves.toBeInstanceOf(Blob);
    });

    it("a late cover without a fallback renders as before", async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const promise = exportSong(makeCanvasWithContext(), makeAudioContext(), {
        bars: 1,
        bpm: 120,
        mimeType: "video/webm",
        cover: new Promise<HTMLCanvasElement>(() => undefined),
      });

      await vi.advanceTimersByTimeAsync(COVER_WAIT_MS);
      expect(warn).toHaveBeenCalledWith(LOG_EVENTS.COVER_LATE, { waitedMs: COVER_WAIT_MS });
      expect(toneMocks.transport.start).toHaveBeenCalledWith();
      expect(hasLiveFrame()).toBe(false);

      await vi.advanceTimersByTimeAsync(2100);
      await expect(promise).resolves.toBeInstanceOf(Blob);
    });
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

describe("getRecordedHoldSec", () => {
  it("is the beat plus Tone's lookahead", () => {
    expect(getRecordedHoldSec(120)).toBeCloseTo(0.6);
    expect(getRecordedHoldSec(60)).toBeCloseTo(1.1);
  });
});
