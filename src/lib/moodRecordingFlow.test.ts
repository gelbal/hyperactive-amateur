// ABOUTME: moodRecordingFlow tests — pins the Mood "record the One" capture spine.
// ABOUTME: Mirrors Chop recording orchestration with mocked media and real Mood store actions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  context: {
    state: "running" as AudioContextState,
    currentTime: 5,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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
  },
  getAudioContext: vi.fn(() => audioMocks.context),
  triggerMoodCountInTick: vi.fn(),
}));

const { toneHarness, toneSpies } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return {
    toneHarness: createToneHarness(),
    toneSpies: { transportCancel: vi.fn() },
  };
});

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

const moodFxMocks = vi.hoisted(() => ({
  suspendMoodPadsForCapture: vi.fn(),
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

const moodSyncMocks = vi.hoisted(() => ({
  syncAssist: vi.fn(),
}));

const moodPartMocks = vi.hoisted(() => ({
  classifyPart: vi.fn(),
}));

const moodVideoPoolMocks = vi.hoisted(() => ({
  liveTakesFromSelections: vi.fn(() => []),
  prepareUpcoming: vi.fn(),
  restartVideosAtPeriodBoundary: vi.fn(),
  setCaptureVideoPolicy: vi.fn(),
  syncPool: vi.fn(),
}));

vi.mock("./audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
  triggerMoodCountInTick: audioMocks.triggerMoodCountInTick,
}));

vi.mock("tone", () => {
  const toneModule = toneHarness.createToneModule();
  const transport = toneModule.getTransport();
  Object.defineProperty(transport, "cancel", { value: toneSpies.transportCancel });
  return {
    ...toneModule,
    getTransport: () => transport,
  };
});

vi.mock("./moodPlayers", () => ({
  livePlayerIsStale: () => false,
  playerSyncOffsetMs: () => null,
  scheduleMoodPlayerSwap: vi.fn(),
  setCaptureGain: vi.fn(),
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

vi.mock("./moodFx", () => ({
  initializeMoodFxForPerformance: vi.fn(),
  resetMoodDropFilter: vi.fn(),
  scheduleMoodDropFilter: vi.fn(),
  suspendMoodPadsForCapture: moodFxMocks.suspendMoodPadsForCapture,
}));

vi.mock("./moodVideoPool", () => ({
  liveTakesFromSelections: moodVideoPoolMocks.liveTakesFromSelections,
  prepareUpcoming: moodVideoPoolMocks.prepareUpcoming,
  restartVideosAtPeriodBoundary: moodVideoPoolMocks.restartVideosAtPeriodBoundary,
  setCaptureVideoPolicy: moodVideoPoolMocks.setCaptureVideoPolicy,
  syncPool: moodVideoPoolMocks.syncPool,
}));

vi.mock("./media", () => ({
  ACQUIRE_FAILED_COPY: "Camera unavailable — try again.",
  CAMERA_DENIED_COPY: "Camera blocked — allow camera and microphone access in your browser, then reload.",
  isPermissionDenial: (err: unknown) => {
    const name =
      typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
    return name === "NotAllowedError" || name === "SecurityError";
  },
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

vi.mock("./moodSyncAssist", () => ({
  syncAssist: moodSyncMocks.syncAssist,
}));

vi.mock("./moodPartTag", () => ({
  classifyPart: moodPartMocks.classifyPart,
}));

vi.mock("./aiClient", () => ({
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === "AbortError",
}));

import {
  __resetMoodRecordingFlowForTesting,
  backfillMoodOneClassification,
  cancelCurrentMoodTake,
  recordMoodTake,
  registerMoodRecordingInterrupt,
  stopMoodTakeEarly,
} from "./moodRecordingFlow";
import { setCaptureGain, stopAllMoodPlayers, syncMoodPlayers } from "./moodPlayers";
import { setCaptureVideoPolicy } from "./moodVideoPool";
import { clearLogs, getLogs, logger, LOG_EVENTS } from "./logger";
import { useAppStore } from "../store/useAppStore";
import { MOOD_HEADPHONES_STORAGE_KEY } from "../store/initialState";
import { makeMoodTake } from "../test-utils/moodFixtures";
import { __resetAudioLifecycleForTesting } from "./audioLifecycle";
import { installNavigatorAudioSession } from "../test-utils/audioContextStub";
import {
  __resetMoodTransportForTesting,
  startMoodPerformance,
} from "./moodTransport";
import { applyDueCommits } from "./moodCommits";
import { __resetPersistenceRequestForTesting } from "./recordingPersistence";
import {
  interruptActiveRecording,
  registerRecordingInterruptHandler,
} from "./recordingInterrupt";
import { registerStreamLifecycle, releaseMediaStream } from "./streamLifecycle";

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

async function flushMicrotasks(times = 5): Promise<void> {
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
  return Object.assign(new EventTarget(), {
    kind,
    muted: false,
    readyState: "live",
    stop: vi.fn(),
  }) as unknown as MediaStreamTrack;
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
  const now = audioMocks.context.currentTime;
  audioMocks.context.currentTime = deadline;
  toneHarness.setImmediate(deadline);
  while (toneHarness.transport.onceCallbacks.length > 0) {
    toneHarness.transport.fireOnce(0);
  }
  await vi.advanceTimersByTimeAsync(Math.ceil(Math.max(0, deadline - now) * 1000));
  await flushMicrotasks();
}

function seedMoodCycle(cycleSeconds = 2): void {
  const samples = new Float32Array(Math.max(1, Math.round(cycleSeconds * 1000)));
  useAppStore.getState().actions.setMoodTake(
    "mic-0",
    makeMoodTake({
      id: "the-one",
      audioBlob: new Blob([new Uint8Array([2])], { type: "audio/wav" }),
      audioBuffer: {
        duration: cycleSeconds,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 1000,
        getChannelData: () => samples,
      } as unknown as AudioBuffer,
      trimEndMs: Math.round(cycleSeconds * 1000),
      durationSeconds: cycleSeconds,
    }),
  );
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
    clearLogs();
    __resetAudioLifecycleForTesting();
    __resetMoodRecordingFlowForTesting();
    __resetMoodTransportForTesting();
    __resetPersistenceRequestForTesting();
    window.localStorage.removeItem(MOOD_HEADPHONES_STORAGE_KEY);
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setAppMode("mood");
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    audioMocks.context.state = "running";
    audioMocks.context.currentTime = 5;
    toneHarness.setImmediate(5);
    toneHarness.setLookahead(0);
    audioMocks.context.createBuffer.mockClear();
    toneHarness.start.mockReset();
    toneHarness.start.mockResolvedValue(undefined);
    toneHarness.draw.reset();
    toneHarness.transport.reset();
    toneSpies.transportCancel.mockClear();
    audioMocks.triggerMoodCountInTick.mockClear();
    mediaMocks.acquireRecordingStream.mockReset();
    mediaMocks.acquireRecordingStream.mockResolvedValue(makeStream());
    mediaMocks.releaseRecordingStream.mockReset();
    mediaMocks.requestMedia.mockReset();
    vi.mocked(setCaptureGain).mockClear();
    vi.mocked(stopAllMoodPlayers).mockClear();
    vi.mocked(syncMoodPlayers).mockClear();
    vi.mocked(setCaptureVideoPolicy).mockClear();
    moodFxMocks.suspendMoodPadsForCapture.mockClear();
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
    moodSyncMocks.syncAssist.mockReset();
    moodSyncMocks.syncAssist.mockResolvedValue(null);
    moodPartMocks.classifyPart.mockReset();
    moodPartMocks.classifyPart.mockResolvedValue(null);
  });

  afterEach(() => {
    cancelCurrentMoodTake();
    __resetMoodRecordingFlowForTesting();
    __resetMoodTransportForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    vi.useRealTimers();
  });

  it("refuses to start while export is active", async () => {
    useAppStore.getState().actions.setIsExporting(true);

    await expect(recordMoodTake("mic-0")).resolves.toBe(false);

    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
    expect(toneHarness.start).not.toHaveBeenCalled();
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("reports a fixed line and reopens the gate when acquisition fails outside cancellation", async () => {
    const onError = vi.fn();
    mediaMocks.acquireRecordingStream.mockRejectedValue(
      new DOMException(
        "AudioSession category is not compatible with audio capture.",
        "InvalidStateError",
      ),
    );

    await expect(recordMoodTake("mic-0", { onError })).resolves.toBe(false);

    expect(mediaMocks.requestMedia).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Camera unavailable — try again.");
    expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/AudioSession/));
    expect(useAppStore.getState().recording.state).toBe("idle");
  });

  it("reports the denied line when the acquire itself was a permission denial", async () => {
    const onError = vi.fn();
    mediaMocks.acquireRecordingStream.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    await expect(recordMoodTake("mic-0", { onError })).resolves.toBe(false);

    expect(onError).toHaveBeenCalledWith(
      "Camera blocked — allow camera and microphone access in your browser, then reload.",
    );
  });

  it("claims preparing and hot mic before awaiting audio startup", async () => {
    useAppStore.getState().actions.setLastTakeReceipt({ kind: "too-short" });
    const audioStarted = makeDeferred<undefined>();
    toneHarness.start.mockReturnValue(audioStarted.promise);

    const promise = recordMoodTake("mic-1");

    expect(useAppStore.getState().recording).toEqual({
      state: "preparing",
      activeTrackId: null,
      countdownEndsAt: null,
      captureEndsAt: null,
      error: null,
      lastTakeReceipt: null,
    });
    expect(useAppStore.getState().mood.performance.hotMicId).toBe("mic-1");
    expect(moodFxMocks.suspendMoodPadsForCapture).toHaveBeenCalledTimes(1);
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();

    cancelCurrentMoodTake();
    audioStarted.resolve();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance.hotMicId).toBeNull();
  });

  it("shows interrupted copy only after the muted-track grace elapses", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const audioTrack = makeTrack("audio");
    Object.assign(audioTrack, { muted: true });
    mediaMocks.acquireRecordingStream.mockResolvedValue(
      makeStream([audioTrack, makeTrack("video")]),
    );

    const promise = recordMoodTake("mic-0", { onError });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_999);

    expect(useAppStore.getState().recording.state).toBe("preparing");
    expect(useAppStore.getState().recording.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
    expect(onError).toHaveBeenCalledWith(INTERRUPTION_COPY);
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
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
    const oneTakeId = useAppStore.getState().mood.piece?.oneTakeId;
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe(oneTakeId);
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBeNull();
  });

  it("snaps a first Click take longer than one cycle to the cycles it spans", async () => {
    vi.useFakeTimers();
    const { snapTake } =
      await vi.importActual<typeof import("./moodTakeSnap")>("./moodTakeSnap");
    snapMocks.snapTake.mockImplementation(snapTake);
    useAppStore.getState().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 8000 }));
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 8000 });

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    expect(snapMocks.snapTake).toHaveBeenCalledWith(8, 4);
    const piece = useAppStore.getState().mood.piece;
    expect(piece).toMatchObject({ cycleSeconds: 4, oneMicId: "mic-0" });
    expect(piece?.mics[0].takes[0]).toMatchObject({
      id: piece?.oneTakeId,
      durationSeconds: 8,
      cycleMultiple: 2,
      trimEndMs: 8000,
    });
  });

  it("schedules a 3-beat first-take count-in on the audio clock and accents beat 1", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.countdownEndsAt).toBe(6.5);
    expect(audioMocks.triggerMoodCountInTick.mock.calls).toEqual([
      [5, { beatsRemaining: 3, accent: false }],
      [5.5, { beatsRemaining: 2, accent: false }],
      [6, { beatsRemaining: 1, accent: true }],
    ]);

    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    expect(audioMocks.triggerMoodCountInTick).not.toHaveBeenCalledWith(
      6.5,
      expect.anything(),
    );
    expect(audioMocks.triggerMoodCountInTick).toHaveBeenCalledTimes(3);
  });

  it("mutes the capture gain only for the capture window when headphone monitoring is off", async () => {
    vi.useFakeTimers();
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(setCaptureGain).not.toHaveBeenCalled();

    await advanceCountdownToDeadline();

    expect(useAppStore.getState().recording.state).toBe("recording");
    expect(setCaptureGain).toHaveBeenCalledTimes(1);
    expect(setCaptureGain).toHaveBeenLastCalledWith(true);

    capture.resolve(makeRecordResult());
    await expect(promise).resolves.toBe(true);

    expect(vi.mocked(setCaptureGain).mock.calls).toEqual([[true], [false]]);
  });

  it("sets the mood cap deadline at punch-in and clears it in finally", async () => {
    vi.useFakeTimers();
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    const countdownEndsAt = useAppStore.getState().recording.countdownEndsAt;
    if (countdownEndsAt === null) throw new Error("missing countdown deadline");

    await advanceCountdownToDeadline();

    expect(useAppStore.getState().recording.captureEndsAt).toBe(countdownEndsAt + 20);
    expect(useAppStore.getState().recording.state).toBe("recording");

    capture.resolve(makeRecordResult());
    await expect(promise).resolves.toBe(true);

    expect(useAppStore.getState().recording.captureEndsAt).toBeNull();
  });

  it("opens and closes the capture video pause policy without touching audio players", async () => {
    vi.useFakeTimers();
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();

    expect(setCaptureVideoPolicy).toHaveBeenCalledTimes(1);
    expect(setCaptureVideoPolicy).toHaveBeenLastCalledWith(true, null);
    expect(stopAllMoodPlayers).not.toHaveBeenCalled();
    expect(syncMoodPlayers).not.toHaveBeenCalled();

    await advanceCountdownToDeadline();
    capture.resolve(makeRecordResult());
    await expect(promise).resolves.toBe(true);

    expect(vi.mocked(setCaptureVideoPolicy).mock.calls).toEqual([
      [true, null],
      [false],
    ]);
    expect(stopAllMoodPlayers).not.toHaveBeenCalled();
    expect(syncMoodPlayers).not.toHaveBeenCalled();
  });

  it("keeps capture gain open during capture when headphone monitoring is on", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.setMonitorWithHeadphones(true);
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    expect(setCaptureGain).not.toHaveBeenCalled();

    await advanceCountdownToDeadline();

    expect(setCaptureGain).toHaveBeenCalledTimes(1);
    expect(setCaptureGain).toHaveBeenLastCalledWith(false);

    capture.resolve(makeRecordResult());
    await expect(promise).resolves.toBe(true);

    expect(vi.mocked(setCaptureGain).mock.calls).toEqual([[false], [false]]);
  });

  it("restores capture gain in the recording-state finally after a capture abort", async () => {
    vi.useFakeTimers();
    recorderMocks.recordClip.mockImplementation(makeAbortableRecordClip());

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    expect(useAppStore.getState().recording.state).toBe("recording");
    expect(setCaptureGain).toHaveBeenCalledWith(true);

    cancelCurrentMoodTake();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(vi.mocked(setCaptureGain).mock.calls).toEqual([[true], [false]]);
  });

  it("declares capture intent before unlocking audio so the session type never passes through playback", async () => {
    vi.useFakeTimers();
    const audioSession = installNavigatorAudioSession();
    const stream = makeStream();
    const typesAtAcquire: string[] = [];
    mediaMocks.acquireRecordingStream.mockImplementation(async () => {
      typesAtAcquire.push(navigator.audioSession?.type ?? "missing");
      registerStreamLifecycle(stream);
      useAppStore
        .getState()
        .actions.setMedia({ stream, status: "granted", error: null });
      return stream;
    });
    mediaMocks.releaseRecordingStream.mockImplementation((heldStream: MediaStream) => {
      releaseMediaStream(heldStream);
    });

    try {
      const promise = recordMoodTake("mic-0");
      await flushMicrotasks(10);

      expect(typesAtAcquire).toEqual(["play-and-record"]);
      expect(audioSession.types).toEqual(["play-and-record"]);

      await advanceCountdownToDeadline();
      await expect(promise).resolves.toBe(true);

      expect(audioSession.types).toEqual(["play-and-record", "playback"]);
    } finally {
      audioSession.uninstall();
    }
  });

  it("counts down to the next cycle boundary when it has at least one beat of lead", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = 16.6;
    toneHarness.setImmediate(16.6);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(useAppStore.getState().recording.countdownEndsAt).toBe(18);
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
  });

  it("skips to the following cycle boundary when the next One is closer than one beat", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = 17.75;
    toneHarness.setImmediate(17.75);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(useAppStore.getState().recording.countdownEndsAt).toBe(22);
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
    // The ticks sit on the loops' beat grid (epoch 10, beat 0.5), counted
    // back from the punch-in at 22: the accented one is the last beat before
    // it. Transport positions are the ticks' audio times from 17.75.
    expect(toneHarness.transport.scheduleOnce.mock.calls.map((call) => call[1])).toEqual([
      0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75,
    ]);

    const scheduledCallbacks = toneHarness.transport.scheduleOnce.mock.calls.map(
      ([callback]) => callback,
    );
    scheduledCallbacks.forEach((callback, index) => callback(18 + index * 0.5));
    expect(audioMocks.triggerMoodCountInTick.mock.calls).toEqual([
      [18, { beatsRemaining: 8, accent: false }],
      [18.5, { beatsRemaining: 7, accent: false }],
      [19, { beatsRemaining: 6, accent: false }],
      [19.5, { beatsRemaining: 5, accent: false }],
      [20, { beatsRemaining: 4, accent: false }],
      [20.5, { beatsRemaining: 3, accent: false }],
      [21, { beatsRemaining: 2, accent: false }],
      [21.5, { beatsRemaining: 1, accent: true }],
    ]);

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
  });

  it("auto-starts a stopped cycle after claiming recording while public starts stay blocked", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    const audioStarted = makeDeferred<undefined>();
    toneHarness.start.mockReturnValueOnce(audioStarted.promise);

    const promise = recordMoodTake("mic-1");

    expect(useAppStore.getState().recording.state).toBe("preparing");
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);

    await startMoodPerformance();
    expect(toneHarness.transport.start).not.toHaveBeenCalled();

    audioStarted.resolve();
    await vi.dynamicImportSettled();
    await flushMicrotasks(10);

    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: true,
      epoch: 5,
      hotMicId: "mic-1",
    });
    expect(toneHarness.transport.scheduleRepeat).toHaveBeenCalledWith(expect.any(Function), 2);
    expect(toneHarness.transport.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().recording.state).toBe("countdown");

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
    expect(toneHarness.transport.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps an auto-started performance running after a successful overdub", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
      trimTo: 2,
    });

    const promise = recordMoodTake("mic-1");
    await vi.dynamicImportSettled();
    await flushMicrotasks(10);
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
    expect(toneHarness.transport.stop).not.toHaveBeenCalled();
  });

  it("never stops a user-started performance when the recording flow fails", async () => {
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    mediaMocks.acquireRecordingStream.mockRejectedValue(new Error("camera permission denied"));

    await expect(recordMoodTake("mic-1", { onError: vi.fn() })).resolves.toBe(false);

    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
    expect(toneHarness.transport.stop).not.toHaveBeenCalled();
  });

  it("records an overdub with the cycle cap, snap multiple, save boundary, and auto-arm", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 4100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 4,
      cycleMultiple: 2,
      trimTo: 4,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 4200 }));

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);

    expect(recorderMocks.recordClip).toHaveBeenCalledWith(
      expect.anything(),
      8_000,
      audioMocks.context,
      expect.anything(),
    );
    expect(autoTrimMocks.autoTrim).toHaveBeenCalledWith(expect.anything(), 8_000);
    expect(snapMocks.snapTake).toHaveBeenCalledWith(4.1, 2);
    expect(autoSaveMocks.saveNow).toHaveBeenCalledWith("mood");
    const savedTake = useAppStore.getState().mood.piece?.mics[1].takes[0];
    expect(savedTake).toMatchObject({
      durationSeconds: 4,
      cycleMultiple: 2,
      trimStartMs: 0,
      trimEndMs: 4000,
    });
    expect(useAppStore.getState().mood.performance.armed["mic-1"]).toBe(savedTake?.id);
    expect(useAppStore.getState().mood.performance.selections["mic-1"]).toBe("off");
    expect(toneHarness.transport.stop).not.toHaveBeenCalled();
    expect(toneSpies.transportCancel).not.toHaveBeenCalled();
    expect(toneHarness.transport.clear).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
    expect(useAppStore.getState().recording.lastTakeReceipt).toEqual({
      kind: "kept",
      seconds: 4,
      multiple: 2,
    });
  });

  it("leaves a too-short receipt when snap rejects the take", async () => {
    vi.useFakeTimers();
    snapMocks.snapTake.mockReturnValue({
      ok: false,
      reason: "too-short",
      minDurationSeconds: 0.25,
    });

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.lastTakeReceipt).toEqual({
      kind: "too-short",
    });
    expect(useAppStore.getState().mood.piece?.mics[0].takes).toHaveLength(0);
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
  });

  it("fires sync assist after save and poster kickoff without awaiting it, then applies current results", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 2200 }));
    const poster = makeDeferred<Blob | null>();
    const sync = makeDeferred<{ offsetMs: number; confidence: number } | null>();
    const order: string[] = [];
    autoSaveMocks.saveNow.mockImplementation(async () => {
      order.push("save");
      return true;
    });
    posterMocks.captureFirstFrame.mockImplementation(() => {
      order.push("poster");
      return poster.promise;
    });
    moodSyncMocks.syncAssist.mockImplementation(() => {
      order.push("sync");
      return sync.promise;
    });

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    expect(order).toEqual(["save", "poster", "sync"]);
    const savedTake = useAppStore.getState().mood.piece?.mics[1].takes[0];
    expect(savedTake?.syncOffsetMs).toBe(0);
    expect(moodSyncMocks.syncAssist).toHaveBeenCalledWith(
      expect.objectContaining({ id: savedTake?.id }),
      expect.anything(),
      2,
      undefined,
      expect.any(AbortSignal),
    );

    sync.resolve({ offsetMs: 96, confidence: 0.93 });
    await flushMicrotasks(5);

    expect(useAppStore.getState().mood.piece?.mics[1].takes[0].syncOffsetMs).toBe(96);
    poster.resolve(null);
  });

  it("logs one quiet miss when the One's reference audio is unavailable", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    // The One rehydrated without decodable audio: sidecar kept, buffer gone.
    useAppStore.setState((current) => ({
      mood: {
        ...current.mood,
        piece: current.mood.piece
          ? {
              ...current.mood.piece,
              mics: current.mood.piece.mics.map((mic, index) =>
                index === 0
                  ? {
                      ...mic,
                      takes: mic.takes.map((take) => ({
                        ...take,
                        audioStatus: "unavailable" as const,
                        audioBuffer: null,
                      })),
                    }
                  : mic,
              ),
            }
          : current.mood.piece,
      },
    }));
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 2200 }));

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    expect(moodSyncMocks.syncAssist).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      LOG_EVENTS.MOOD_SYNC_MISS,
      expect.objectContaining({ reason: "missing-reference-audio" }),
    );
    warn.mockRestore();
  });

  it("re-arms the live selection at the boundary so an applied offset reaches the players", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 2200 }));
    const sync = makeDeferred<{ offsetMs: number; confidence: number } | null>();
    moodSyncMocks.syncAssist.mockImplementation(() => sync.promise);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    // Drain the auto-arm commit so nothing is armed when the result lands.
    applyDueCommits(9);
    expect(useAppStore.getState().mood.performance.armed["mic-1"]).toBeNull();
    vi.mocked(syncMoodPlayers).mockClear();

    sync.resolve({ offsetMs: 96, confidence: 0.93 });
    await flushMicrotasks(5);
    expect(useAppStore.getState().mood.piece?.mics[1].takes[0].syncOffsetMs).toBe(96);

    // The landed offset only reaches audio on a rebuild: the flow re-armed
    // the CURRENT selection, so the next boundary drain rebuilds in phase.
    applyDueCommits(11);
    expect(vi.mocked(syncMoodPlayers)).toHaveBeenCalled();
    const lastCall = vi.mocked(syncMoodPlayers).mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          take: expect.objectContaining({ syncOffsetMs: 96 }),
        }),
      ]),
    );
  });

  it("does not re-arm when the performance is stopped", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 2200 }));
    const sync = makeDeferred<{ offsetMs: number; confidence: number } | null>();
    moodSyncMocks.syncAssist.mockImplementation(() => sync.promise);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    useAppStore.getState().actions.setMoodPerforming(false);
    vi.mocked(syncMoodPlayers).mockClear();
    sync.resolve({ offsetMs: 96, confidence: 0.93 });
    await flushMicrotasks(5);

    expect(useAppStore.getState().mood.piece?.mics[1].takes[0].syncOffsetMs).toBe(96);
    applyDueCommits(999);
    expect(vi.mocked(syncMoodPlayers)).not.toHaveBeenCalled();
  });

  it("fires part classification after save without awaiting it, then applies ai parts", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 2200 }));
    const poster = makeDeferred<Blob | null>();
    const sync = makeDeferred<{ offsetMs: number; confidence: number } | null>();
    const part = makeDeferred<{ part: "beatbox"; confidence: number } | null>();
    const order: string[] = [];
    autoSaveMocks.saveNow.mockImplementation(async () => {
      order.push("save");
      return true;
    });
    posterMocks.captureFirstFrame.mockImplementation(() => {
      order.push("poster");
      return poster.promise;
    });
    moodSyncMocks.syncAssist.mockImplementation(() => {
      order.push("sync");
      return sync.promise;
    });
    moodPartMocks.classifyPart.mockImplementation(() => {
      order.push("part");
      return part.promise;
    });

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    expect(order).toEqual(["save", "poster", "sync", "part"]);
    const savedTake = useAppStore.getState().mood.piece?.mics[1].takes[0];
    expect(savedTake?.part).toBeNull();
    expect(moodPartMocks.classifyPart).toHaveBeenCalledWith(
      expect.objectContaining({ id: savedTake?.id }),
      false,
      undefined,
      expect.any(AbortSignal),
    );

    part.resolve({ part: "beatbox", confidence: 0.9 });
    await flushMicrotasks(5);

    const taggedTake = useAppStore.getState().mood.piece?.mics[1].takes[0];
    expect(taggedTake?.part).toBe("beatbox");
    expect(taggedTake?.partSource).toBe("ai");
    sync.resolve(null);
    poster.resolve(null);
  });

  it("keeps the One checking until enriched classification settles across an overdub bump", async () => {
    vi.useFakeTimers();
    const part = makeDeferred<{
      part: "lead";
      confidence: number;
      artDirection: {
        fxPreset: "wash";
        creditPalette: "heat";
        source: "ai";
      };
      keyEstimate: { key: "A"; mode: "minor"; confidence: number };
    } | null>();
    moodPartMocks.classifyPart.mockReturnValue(part.promise);

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    const oneTakeId = useAppStore.getState().mood.piece?.oneTakeId;
    expect(oneTakeId).toBeTruthy();
    expect(moodPartMocks.classifyPart).toHaveBeenCalledWith(
      expect.objectContaining({ id: oneTakeId }),
      true,
      undefined,
      expect.any(AbortSignal),
    );
    expect(useAppStore.getState().mood.partCheckingTakeIds).toEqual([oneTakeId]);

    useAppStore.getState().actions.setMoodTake(
      "mic-1",
      makeMoodTake({ id: "later-overdub" }),
    );
    part.resolve({
      part: "lead",
      confidence: 0.92,
      artDirection: { fxPreset: "wash", creditPalette: "heat", source: "ai" },
      keyEstimate: { key: "A", mode: "minor", confidence: 0.87 },
    });
    await flushMicrotasks(6);

    expect(useAppStore.getState().mood.partCheckingTakeIds).toEqual([]);
    expect(useAppStore.getState().mood.piece?.artDirection).toEqual({
      fxPreset: "wash",
      creditPalette: "heat",
      source: "ai",
    });
    expect(useAppStore.getState().mood.piece?.keyEstimate).toEqual({
      key: "A",
      mode: "minor",
      confidence: 0.87,
    });
  });

  it("backfills missing One enrichment once without replacing an existing AI part", async () => {
    const classification = makeDeferred<{
      part: "harmony";
      confidence: number;
      artDirection: {
        fxPreset: "sweep";
        creditPalette: "print";
        source: "ai";
      };
      keyEstimate: { key: "C"; mode: "major"; confidence: number };
    } | null>();
    moodPartMocks.classifyPart.mockReturnValue(classification.promise);
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "saved-one", part: "bass", partSource: "ai" }),
    );

    backfillMoodOneClassification();
    backfillMoodOneClassification();

    expect(moodPartMocks.classifyPart).toHaveBeenCalledTimes(1);
    expect(moodPartMocks.classifyPart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved-one" }),
      true,
      undefined,
      expect.any(AbortSignal),
    );
    expect(useAppStore.getState().mood.partCheckingTakeIds).toEqual(["saved-one"]);

    classification.resolve({
      part: "harmony",
      confidence: 0.91,
      artDirection: { fxPreset: "sweep", creditPalette: "print", source: "ai" },
      keyEstimate: { key: "C", mode: "major", confidence: 0.89 },
    });
    await flushMicrotasks(6);

    expect(useAppStore.getState().mood.piece?.mics[0].takes[0]).toMatchObject({
      id: "saved-one",
      part: "bass",
      partSource: "ai",
    });
    expect(useAppStore.getState().mood.piece).toMatchObject({
      artDirection: { fxPreset: "sweep", creditPalette: "print", source: "ai" },
      keyEstimate: { key: "C", mode: "major", confidence: 0.89 },
    });
    expect(useAppStore.getState().mood.partCheckingTakeIds).toEqual([]);
  });

  it("retries a missed One backfill later in the same session", async () => {
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "saved-one" }),
    );
    moodPartMocks.classifyPart.mockResolvedValue(null);

    backfillMoodOneClassification();
    await flushMicrotasks(6);
    backfillMoodOneClassification();

    expect(moodPartMocks.classifyPart).toHaveBeenCalledTimes(2);
  });

  it("keeps an aborted One backfill marked instead of retrying it", async () => {
    const first = makeDeferred<null>();
    const replacement = makeDeferred<null>();
    moodPartMocks.classifyPart
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(replacement.promise);
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "saved-one" }),
    );

    backfillMoodOneClassification();
    const firstSignal = moodPartMocks.classifyPart.mock.calls[0]?.[3] as AbortSignal;
    useAppStore.getState().actions.scratchMoodPiece();
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "replacement-one" }),
    );
    backfillMoodOneClassification();
    expect(firstSignal.aborted).toBe(true);

    first.resolve(null);
    await flushMicrotasks(6);
    useAppStore.getState().actions.scratchMoodPiece();
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "saved-one" }),
    );
    backfillMoodOneClassification();

    expect(moodPartMocks.classifyPart).toHaveBeenCalledTimes(2);
    replacement.resolve(null);
  });

  it("does not launch or spend a One backfill while exporting", () => {
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "saved-one" }),
    );
    useAppStore.getState().actions.setIsExporting(true);

    backfillMoodOneClassification();

    expect(moodPartMocks.classifyPart).not.toHaveBeenCalled();
    useAppStore.getState().actions.setIsExporting(false);
    backfillMoodOneClassification();
    expect(moodPartMocks.classifyPart).toHaveBeenCalledTimes(1);
  });

  it("does not spend the backfill attempt until the One has decoded audio", async () => {
    const unavailableTake = makeMoodTake({
      id: "saved-one",
      audioStatus: "unavailable",
      audioBuffer: null,
    });
    useAppStore.getState().actions.setMoodTake("mic-0", unavailableTake);

    backfillMoodOneClassification();

    expect(moodPartMocks.classifyPart).not.toHaveBeenCalled();

    const restoredBuffer = makeRecordResult().audioBuffer;
    useAppStore
      .getState()
      .actions.restoreMoodTakeAudio("mic-0", "saved-one", restoredBuffer, undefined, unavailableTake);
    backfillMoodOneClassification();

    expect(moodPartMocks.classifyPart).toHaveBeenCalledTimes(1);
  });

  it("skips complete enrichment, aborts a prior backfill, and resets its session guard", () => {
    useAppStore.getState().actions.setMoodTake("mic-0", makeMoodTake({ id: "saved-one" }));
    const sessionId = useAppStore.getState().session.moodSessionId;
    useAppStore.getState().actions.applyMoodArtDirectionIfCurrent(
      "saved-one",
      { fxPreset: "neutral", creditPalette: "signal", source: "ai" },
      sessionId,
    );
    useAppStore.getState().actions.applyMoodKeyEstimateIfCurrent(
      "saved-one",
      { key: "G", mode: "minor", confidence: 0.8 },
      sessionId,
    );

    backfillMoodOneClassification();
    expect(moodPartMocks.classifyPart).not.toHaveBeenCalled();

    const piece = useAppStore.getState().mood.piece;
    if (!piece) throw new Error("Expected Mood piece");
    useAppStore.getState().actions.hydrateMoodPiece({ ...piece, keyEstimate: undefined });

    backfillMoodOneClassification();
    const firstSignal = moodPartMocks.classifyPart.mock.calls[0]?.[3] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    useAppStore.getState().actions.scratchMoodPiece();
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake(
      "mic-0",
      makeMoodTake({ id: "replacement-one" }),
    );
    backfillMoodOneClassification();

    const secondSignal = moodPartMocks.classifyPart.mock.calls[1]?.[3] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);

    __resetMoodRecordingFlowForTesting();
    expect(secondSignal.aborted).toBe(true);
    backfillMoodOneClassification();
    expect(moodPartMocks.classifyPart).toHaveBeenCalledTimes(3);
  });

  it("drops stale sync assist results through the real moodRevision guard", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    useAppStore.getState().actions.setMoodPerforming(true, 5);
    autoTrimMocks.autoTrim.mockReturnValue({ trimStartMs: 0, trimEndMs: 2100 });
    snapMocks.snapTake.mockReturnValue({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 2200 }));
    const sync = makeDeferred<{ offsetMs: number; confidence: number } | null>();
    moodSyncMocks.syncAssist.mockReturnValue(sync.promise);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    const capturedRevision = useAppStore.getState().session.moodRevision;
    useAppStore.getState().actions.deleteMoodTake("mic-0", "the-one");
    expect(useAppStore.getState().session.moodRevision).toBeGreaterThan(capturedRevision);

    sync.resolve({ offsetMs: 123, confidence: 0.95 });
    await flushMicrotasks(5);

    expect(useAppStore.getState().mood.piece?.mics[1].takes[0].syncOffsetMs).toBe(0);
  });

  it("aborts an overdub mid-wait without stopping performance or saving", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = 16.6;
    toneHarness.setImmediate(16.6);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("countdown");

    cancelCurrentMoodTake();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: true,
      epoch: 10,
    });
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece?.mics[1].takes).toHaveLength(0);
    expect(toneHarness.transport.stop).not.toHaveBeenCalled();
    expect(toneSpies.transportCancel).not.toHaveBeenCalled();
  });

  it("places overdub count-in ticks at their audio times on the real lookahead clock", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    toneHarness.setLookahead(0.1);
    audioMocks.context.currentTime = 17.75;
    toneHarness.setImmediate(17.75);
    // The performance owns a running transport.
    toneHarness.transport.start();

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    // transport.seconds reads 0.1 ahead here; converting from it would put
    // every tick 100 ms late.
    expect(toneHarness.transport.scheduleOnce.mock.calls.map((call) => call[1])).toEqual([
      0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75,
    ]);

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
  });

  it.each([
    [17.75, 8],
    [16.6, 2],
  ])("records how many count-in ticks it plays (tap at %s)", async (tapTime, ticks) => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = tapTime;
    toneHarness.setImmediate(tapTime);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    expect(useAppStore.getState().mood.countInTicks).toBe(ticks);
    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
  });

  it("records a first take's three count-in ticks even when the audio clock moves between reads", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
    let clock = 5;
    Object.defineProperty(audioMocks.context, "currentTime", {
      configurable: true,
      get: () => (clock += 0.001),
      set: (value: number) => {
        clock = value;
      },
    });

    try {
      const promise = recordMoodTake("mic-0");
      await flushMicrotasks();
      expect(useAppStore.getState().mood.countInTicks).toBe(3);
      cancelCurrentMoodTake();
      await expect(promise).resolves.toBe(false);
    } finally {
      Object.defineProperty(audioMocks.context, "currentTime", {
        configurable: true,
        writable: true,
        value: 5,
      });
    }
  });

  it("plays an overdub count-in tick already inside the lookahead on the audio clock", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    toneHarness.setLookahead(0.1);
    audioMocks.context.currentTime = 17.4;
    toneHarness.setImmediate(17.4);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    // Punch-in at 18; the tick at 17.5 is closer than the lookahead, where the
    // transport may already have passed its position.
    expect(useAppStore.getState().recording.countdownEndsAt).toBe(18);
    expect(audioMocks.triggerMoodCountInTick.mock.calls).toEqual([
      [17.5, { beatsRemaining: 1, accent: true }],
    ]);
    expect(toneHarness.transport.scheduleOnce).not.toHaveBeenCalled();

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
  });

  it("cancels overdub count-in ticks when an abort lands mid-count-in", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = 16.6;
    toneHarness.setImmediate(16.6);
    // Transport time and audio-clock time have different origins: the
    // transport was re-positioned to 0 at performance start. Ticks must be
    // scheduled TRANSPORT-relative or they fire late by the epoch offset.
    toneHarness.transport.seconds = 100;
    toneHarness.transport.scheduleOnce.mockReturnValueOnce(601).mockReturnValueOnce(602);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(toneHarness.transport.scheduleOnce).toHaveBeenCalledTimes(2);
    // Ticks on the grid at audio times 17 and 17.5 (the punch-in is at 18)
    // land at transport positions 100.4 and 100.9.
    expect(toneHarness.transport.scheduleOnce.mock.calls.map((call) => call[1])).toEqual([
      100.4, 100.9,
    ]);
    expect(audioMocks.triggerMoodCountInTick).not.toHaveBeenCalled();

    cancelCurrentMoodTake();

    await expect(promise).resolves.toBe(false);
    expect(toneHarness.transport.clear.mock.calls).toEqual([[601], [602]]);

    const scheduledCallbacks = toneHarness.transport.scheduleOnce.mock.calls.map(
      ([callback]) => callback,
    );
    scheduledCallbacks.forEach((callback, index) => callback(17 + index * 0.5));

    expect(audioMocks.triggerMoodCountInTick).not.toHaveBeenCalled();
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
    audioMocks.context.currentTime = 9.25;
    expect(stopMoodTakeEarly()).toBe(true);
    expect(useAppStore.getState().recording.captureEndsAt).toBe(9.25);
    expect(stop).toHaveBeenCalledTimes(1);

    capture.resolve(makeRecordResult());
    await expect(promise).resolves.toBe(true);
    expect(stopMoodTakeEarly()).toBe(false);
  });

  it("turns an instant punch-out decode failure into the too-short receipt", async () => {
    vi.useFakeTimers();
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    const stop = vi.fn();
    const onError = vi.fn();
    recorderMocks.createRecordClipStopController.mockReturnValue({ stop });
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0", { onError });
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    audioMocks.context.currentTime += 0.1;

    expect(stopMoodTakeEarly()).toBe(true);
    capture.reject(new Error("Failed to decode recorded audio: empty fragment"));

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.lastTakeReceipt).toEqual({ kind: "too-short" });
    expect(onError).not.toHaveBeenCalled();
    expect(
      getLogs().some((entry) => entry.event === LOG_EVENTS.MOOD_TAKE_FAILED),
    ).toBe(false);
  });

  it("surfaces and logs a decode failure after a real-length capture", async () => {
    vi.useFakeTimers();
    const capture = makeDeferred<ReturnType<typeof makeRecordResult>>();
    const stop = vi.fn();
    const onError = vi.fn();
    recorderMocks.createRecordClipStopController.mockReturnValue({ stop });
    recorderMocks.recordClip.mockReturnValue(capture.promise);

    const promise = recordMoodTake("mic-0", { onError });
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    audioMocks.context.currentTime += 0.3;

    expect(stopMoodTakeEarly()).toBe(true);
    capture.reject(new Error("Failed to decode recorded audio: bad container"));

    await expect(promise).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith("Failed to decode recorded audio: bad container");
    expect(getLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: LOG_EVENTS.MOOD_TAKE_FAILED,
          payload: { reason: "Failed to decode recorded audio: bad container" },
        }),
      ]),
    );
  });

  it("surfaces and logs media permission failures", async () => {
    const onError = vi.fn();
    mediaMocks.acquireRecordingStream.mockRejectedValue(
      new DOMException("camera permission denied", "NotAllowedError"),
    );

    await expect(recordMoodTake("mic-0", { onError })).resolves.toBe(false);

    const deniedCopy =
      "Camera blocked — allow camera and microphone access in your browser, then reload.";
    expect(onError).toHaveBeenCalledWith(deniedCopy);
    expect(getLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: LOG_EVENTS.MOOD_TAKE_FAILED,
          payload: { reason: deniedCopy },
        }),
      ]),
    );
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
    expect(vi.mocked(setCaptureVideoPolicy).mock.calls.at(-1)).toEqual([false]);
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece?.mics[0].takes).toHaveLength(0);
  });

  it("coexists with another interrupt handler and only handles interrupts while active", async () => {
    vi.useFakeTimers();
    let otherActive = false;
    const otherInterrupt = vi.fn();
    const unregisterMood = registerMoodRecordingInterrupt();
    const unregisterOther = registerRecordingInterruptHandler({
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
      unregisterOther();
      unregisterMood();
      cancelCurrentMoodTake();
      await promise.catch(() => false);
    }
  });

  it("logs poster extraction failures under the poster capture event", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    posterMocks.captureFirstFrame.mockRejectedValue(new Error("mood poster failed"));

    const promise = recordMoodTake("mic-0");
    try {
      await flushMicrotasks();
      await advanceCountdownToDeadline();
      await expect(promise).resolves.toBe(true);
      await flushMicrotasks();

      expect(warn).toHaveBeenCalledWith(LOG_EVENTS.POSTER_CAPTURE_ERROR, {
        phase: "mood-poster",
        message: "mood poster failed",
      });
    } finally {
      warn.mockRestore();
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
