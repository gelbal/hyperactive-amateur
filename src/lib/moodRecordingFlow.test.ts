// ABOUTME: moodRecordingFlow tests — pins the Mood "record the One" capture spine.
// ABOUTME: Mirrors Chop recording orchestration with mocked media and real Mood store actions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  context: {
    state: "running" as AudioContextState,
    currentTime: 5,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  getAudioContext: vi.fn(() => audioMocks.context),
}));

const toneMocks = vi.hoisted(() => ({
  start: vi.fn(),
}));

const mediaMocks = vi.hoisted(() => ({
  acquireRecordingStream: vi.fn(),
  releaseRecordingStream: vi.fn(),
  invalidatePendingAcquire: vi.fn(),
  requestMedia: vi.fn(),
}));

const recorderMocks = vi.hoisted(() => ({
  recordClip: vi.fn(),
  createRecordClipStopController: vi.fn(() => ({ stop: vi.fn() })),
}));

const autoTrimMocks = vi.hoisted(() => ({
  autoTrim: vi.fn(),
}));

const snapMocks = vi.hoisted(() => ({
  snapTake: vi.fn(),
}));

const posterMocks = vi.hoisted(() => ({
  captureFirstFrame: vi.fn(),
}));

const wavMocks = vi.hoisted(() => ({
  audioBufferToWav: vi.fn(),
}));

const autoSaveMocks = vi.hoisted(() => ({
  saveNow: vi.fn(),
}));

const installMocks = vi.hoisted(() => ({
  requestPersistence: vi.fn(),
}));

vi.mock("./audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
}));

vi.mock("tone", () => ({
  start: toneMocks.start,
}));

vi.mock("./media", () => ({
  acquireRecordingStream: mediaMocks.acquireRecordingStream,
  releaseRecordingStream: mediaMocks.releaseRecordingStream,
  invalidatePendingAcquire: mediaMocks.invalidatePendingAcquire,
  requestMedia: mediaMocks.requestMedia,
}));

vi.mock("./recorder", () => ({
  recordClip: recorderMocks.recordClip,
  createRecordClipStopController: recorderMocks.createRecordClipStopController,
}));

vi.mock("./autoTrim", () => ({
  autoTrim: autoTrimMocks.autoTrim,
}));

vi.mock("./moodTakeSnap", () => ({
  snapTake: snapMocks.snapTake,
}));

vi.mock("./posterFrame", () => ({
  captureFirstFrame: posterMocks.captureFirstFrame,
}));

vi.mock("./wavEncoder", () => ({
  audioBufferToWav: wavMocks.audioBufferToWav,
}));

vi.mock("./autoSave", () => ({
  saveNow: autoSaveMocks.saveNow,
}));

vi.mock("./install", () => ({
  requestPersistence: installMocks.requestPersistence,
}));

vi.mock("./aiClient", () => ({
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === "AbortError",
}));

import {
  __resetMoodRecordingFlowForTesting,
  cancelCurrentMoodTake,
  recordMoodTake,
  stopMoodTakeEarly,
} from "./moodRecordingFlow";
import { useAppStore } from "../store/useAppStore";
import { __resetAudioLifecycleForTesting } from "./audioLifecycle";
import { __resetPersistenceRequestForTesting } from "./recordingPersistence";
import {
  interruptActiveRecording,
  registerRecordingInterruptHandler,
} from "./recordingInterrupt";

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

function makeDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => res(value as T | PromiseLike<T>);
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function observeResolution(
  promise: Promise<boolean>,
): Promise<{ status: "resolved"; value: boolean } | { status: "pending" }> {
  let result: { status: "resolved"; value: boolean } | { status: "pending" } = {
    status: "pending",
  };
  void promise.then((value) => {
    result = { status: "resolved", value };
  });
  await flushMicrotasks();
  return result;
}

function makeTrack(kind: "audio" | "video"): MediaStreamTrack {
  return {
    kind,
    muted: false,
    readyState: "live",
  } as MediaStreamTrack;
}

function makeStream(
  tracks: MediaStreamTrack[] = [makeTrack("audio"), makeTrack("video")],
): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
}

function makeRecordResult({ durationMs = 2000 }: { durationMs?: number } = {}) {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBuffer: {
      duration: durationMs / 1000,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(durationMs),
    } as unknown as AudioBuffer,
    durationMs,
  };
}

async function advanceCountdownToDeadline(): Promise<void> {
  const deadline = useAppStore.getState().recording.countdownEndsAt;
  if (deadline === null) throw new Error("missing countdown deadline");
  audioMocks.context.currentTime = deadline;
  await vi.advanceTimersByTimeAsync(Math.ceil((deadline - 5) * 1000));
  await flushMicrotasks();
}

function makeAbortableRecordClip() {
  return (
    _stream: MediaStream,
    _durationMs: number,
    _context: AudioContext,
    options: { signal?: AbortSignal },
  ) =>
    new Promise<never>((_resolve, reject) => {
      const signal = options.signal;
      if (!signal) return;
      const rejectAbort = () => reject(new DOMException("Aborted during record", "AbortError"));
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
}

describe("moodRecordingFlow", () => {
  beforeEach(() => {
    __resetAudioLifecycleForTesting();
    __resetMoodRecordingFlowForTesting();
    __resetPersistenceRequestForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setAppMode("mood");
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    audioMocks.context.state = "running";
    audioMocks.context.currentTime = 5;
    toneMocks.start.mockReset();
    toneMocks.start.mockResolvedValue(undefined);
    mediaMocks.acquireRecordingStream.mockReset();
    mediaMocks.acquireRecordingStream.mockResolvedValue(makeStream());
    mediaMocks.releaseRecordingStream.mockReset();
    mediaMocks.requestMedia.mockReset();
    recorderMocks.recordClip.mockReset();
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult());
    recorderMocks.createRecordClipStopController.mockReset();
    recorderMocks.createRecordClipStopController.mockImplementation(() => ({ stop: vi.fn() }));
    autoTrimMocks.autoTrim.mockReset();
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 100, trimEndMs: 1350 });
    snapMocks.snapTake.mockReset();
    snapMocks.snapTake.mockReturnValue({ ok: true, isOne: true, durationSeconds: 1.25 });
    posterMocks.captureFirstFrame.mockReset();
    posterMocks.captureFirstFrame.mockResolvedValue(null);
    wavMocks.audioBufferToWav.mockReset();
    wavMocks.audioBufferToWav.mockReturnValue(new Blob([new Uint8Array([2])], { type: "audio/wav" }));
    autoSaveMocks.saveNow.mockReset();
    autoSaveMocks.saveNow.mockResolvedValue(true);
    installMocks.requestPersistence.mockReset();
    installMocks.requestPersistence.mockResolvedValue("best-effort");
  });

  afterEach(() => {
    cancelCurrentMoodTake();
    __resetMoodRecordingFlowForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    vi.useRealTimers();
  });

  it("refuses to start while export is active", async () => {
    useAppStore.getState().actions.setIsExporting(true);

    await expect(recordMoodTake("mic-0")).resolves.toBe(false);

    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
    expect(toneMocks.start).not.toHaveBeenCalled();
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("claims preparing and hot mic before awaiting audio startup", async () => {
    const audioStarted = makeDeferred();
    toneMocks.start.mockReturnValue(audioStarted.promise);

    const promise = recordMoodTake("mic-1");

    expect(useAppStore.getState().recording).toEqual({
      state: "preparing",
      activeTrackId: null,
      countdownEndsAt: null,
      error: null,
    });
    expect(useAppStore.getState().mood.performance.hotMicId).toBe("mic-1");
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();

    cancelCurrentMoodTake();
    audioStarted.resolve();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
  });

  it("records the One in trim-snap-store-save-poster order", async () => {
    vi.useFakeTimers();
    const save = makeDeferred<boolean>();
    const poster = makeDeferred<Blob | null>();
    const posterBlob = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    const order: string[] = [];
    const actions = useAppStore.getState().actions;
    const originalSetMoodTake = actions.setMoodTake;
    const setMoodTake = vi.spyOn(actions, "setMoodTake").mockImplementation((...args) => {
      order.push("store");
      return originalSetMoodTake(...args);
    });
    autoTrimMocks.autoTrim.mockImplementation(() => {
      order.push("trim");
      return { trimStartMs: 100, trimEndMs: 1350 };
    });
    snapMocks.snapTake.mockImplementation(() => {
      order.push("snap");
      return { ok: true, isOne: true, durationSeconds: 1.25 };
    });
    autoSaveMocks.saveNow.mockImplementation(() => {
      order.push("save");
      return save.promise;
    });
    posterMocks.captureFirstFrame.mockImplementation(() => {
      order.push("poster");
      return poster.promise;
    });

    const promise = recordMoodTake("mic-0");
    try {
      await flushMicrotasks();

      expect(useAppStore.getState().recording.state).toBe("countdown");
      expect(useAppStore.getState().recording.countdownEndsAt).toBe(7);
      expect(mediaMocks.acquireRecordingStream).toHaveBeenCalledWith({ w: 1, h: 1 });
      expect(recorderMocks.recordClip).not.toHaveBeenCalled();

      await advanceCountdownToDeadline();
      await flushMicrotasks();

      expect(recorderMocks.recordClip).toHaveBeenCalledWith(
        expect.anything(),
        20_000,
        audioMocks.context,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          stopController: expect.objectContaining({ stop: expect.any(Function) }),
        }),
      );
      expect(autoTrimMocks.autoTrim).toHaveBeenCalledWith(
        expect.anything(),
        20_000,
      );
      expect(snapMocks.snapTake).toHaveBeenCalledWith(1.25, null);
      expect(autoSaveMocks.saveNow).toHaveBeenCalledWith("mood");
      expect(order).toEqual(["trim", "snap", "store", "save"]);
      expect(useAppStore.getState().mood.piece?.mics[0].takes).toHaveLength(1);
      expect(useAppStore.getState().mood.piece).toMatchObject({
        cycleSeconds: 1.25,
        oneMicId: "mic-0",
      });
      expect(posterMocks.captureFirstFrame).not.toHaveBeenCalled();

      save.resolve(true);
      await expect(promise).resolves.toBe(true);
      expect(order).toEqual(["trim", "snap", "store", "save", "poster"]);
      expect(useAppStore.getState().recording.state).toBe("idle");
      expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
      const savedTake = useAppStore.getState().mood.piece?.mics[0].takes[0];
      expect(savedTake).toMatchObject({
        audioStatus: "ok",
        durationSeconds: 1.25,
        trimStartMs: 100,
        trimEndMs: 1350,
        cycleMultiple: 1,
        syncOffsetMs: 0,
        part: null,
        partSource: null,
      });
      expect(savedTake?.audioBlob?.type).toBe("audio/wav");
      expect(savedTake?.posterBlob).toBeNull();

      poster.resolve(posterBlob);
      await flushMicrotasks(5);

      expect(useAppStore.getState().mood.piece?.mics[0].takes[0].posterBlob).toBe(posterBlob);
    } finally {
      poster.resolve(null);
      save.resolve(false);
      await promise.catch(() => false);
      setMoodTake.mockRestore();
    }
  });

  it("uses Click bpm for the first count-in and locks the cycle through setMoodTake", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 3000 });
    snapMocks.snapTake.mockReturnValue({ ok: true, isOne: true, durationSeconds: 3 });

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.countdownEndsAt).toBe(6.5);
    expect(mediaMocks.acquireRecordingStream).toHaveBeenCalledWith({ w: 9, h: 16 });

    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    expect(recorderMocks.recordClip).toHaveBeenCalledWith(
      expect.anything(),
      16_000,
      audioMocks.context,
      expect.anything(),
    );
    expect(autoTrimMocks.autoTrim).toHaveBeenCalledWith(expect.anything(), 16_000);
    expect(useAppStore.getState().mood.piece).toMatchObject({
      cycleSeconds: 4,
      oneMicId: "mic-0",
    });
  });

  it("exposes tap-to-stop through the active recordClip stop controller", async () => {
    vi.useFakeTimers();
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    const stop = vi.fn();
    recorderMocks.createRecordClipStopController.mockReturnValue({ stop });
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    expect(useAppStore.getState().recording.state).toBe("recording");
    expect(stopMoodTakeEarly()).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);

    capture.resolve(makeRecordResult());
    await expect(promise).resolves.toBe(true);
    expect(stopMoodTakeEarly()).toBe(false);
  });

  it("aborts during stream acquisition without saving and releases late streams", async () => {
    const acquisition = makeDeferred<MediaStream>();
    const stream = makeStream();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("preparing");

    cancelCurrentMoodTake();
    await expect(observeResolution(promise)).resolves.toEqual({
      status: "resolved",
      value: false,
    });
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece?.mics[0].takes).toHaveLength(0);

    acquisition.resolve(stream);
    await flushMicrotasks();
    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledWith(stream);
  });

  it("aborts during countdown without saving and restores idle", async () => {
    vi.useFakeTimers();

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("countdown");

    cancelCurrentMoodTake();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece?.mics[0].takes).toHaveLength(0);
  });

  it("aborts during capture without saving and restores idle", async () => {
    vi.useFakeTimers();
    recorderMocks.recordClip.mockImplementation(makeAbortableRecordClip());

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    expect(useAppStore.getState().recording.state).toBe("recording");

    cancelCurrentMoodTake();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece?.mics[0].takes).toHaveLength(0);
  });

  it("coexists with another interrupt handler and only handles interrupts while active", async () => {
    vi.useFakeTimers();
    let otherActive = false;
    const otherInterrupt = vi.fn();
    const unregister = registerRecordingInterruptHandler({
      isActive: () => otherActive,
      interrupt: otherInterrupt,
    });

    const promise = recordMoodTake("mic-0");
    try {
      await flushMicrotasks();
      expect(useAppStore.getState().recording.state).toBe("countdown");

      expect(interruptActiveRecording("interrupted")).toBe(true);

      await expect(promise).resolves.toBe(false);
      expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
      expect(otherInterrupt).not.toHaveBeenCalled();

      otherActive = true;
      expect(interruptActiveRecording("interrupted")).toBe(true);
      expect(otherInterrupt).toHaveBeenCalledWith("interrupted");
    } finally {
      unregister();
      cancelCurrentMoodTake();
      await promise.catch(() => false);
    }
  });

  it("revokes the poster URL when the take is gone before the poster attaches", async () => {
    vi.useFakeTimers();
    const poster = makeDeferred<Blob | null>();
    const posterBlob = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    posterMocks.captureFirstFrame.mockReturnValue(poster.promise);
    const create = vi.spyOn(URL, "createObjectURL");
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    const promise = recordMoodTake("mic-0");
    try {
      await flushMicrotasks();
      await advanceCountdownToDeadline();
      await expect(promise).resolves.toBe(true);

      const take = useAppStore.getState().mood.piece?.mics[0].takes[0];
      if (!take) throw new Error("expected a saved take");
      useAppStore.getState().actions.deleteMoodTake("mic-0", take.id);

      poster.resolve(posterBlob);
      await flushMicrotasks(5);

      const posterUrl = create.mock.results.at(-1)?.value as string;
      expect(posterUrl).not.toBe(take.url);
      expect(revoke).toHaveBeenCalledWith(posterUrl);
    } finally {
      poster.resolve(null);
      await promise.catch(() => false);
    }
  });
});
