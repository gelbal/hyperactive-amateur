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
  triggerCountInClick: vi.fn(),
}));

const toneMocks = vi.hoisted(() => ({
  make() {
    let nextScheduleOnceId = 501;
    const scheduleOnceTimers = new Map<number, ReturnType<typeof setTimeout>>();
    const transportState = { seconds: 0 };
    const tone = {
      draw: {
        schedule: vi.fn((callback: () => void) => {
          callback();
          return 301;
        }),
      },
      now: vi.fn(() => audioMocks.context.currentTime),
      start: vi.fn(),
      transport: {
        cancel: vi.fn(),
        clear: vi.fn((eventId: number) => {
          const timer = scheduleOnceTimers.get(eventId);
          if (timer !== undefined) {
            clearTimeout(timer);
            scheduleOnceTimers.delete(eventId);
          }
        }),
        position: 0 as number | string,
        // Real Tone semantics: scheduleOnce's time argument is TRANSPORT time
        // (seconds since position 0), not absolute audio-clock time.
        get seconds() {
          return transportState.seconds;
        },
        set seconds(value: number) {
          transportState.seconds = value;
        },
        scheduleOnce: vi.fn((callback: (time: number) => void, time: number) => {
          const eventId = nextScheduleOnceId;
          nextScheduleOnceId += 1;
          const delayMs = Math.max(0, Math.round((time - transportState.seconds) * 1000));
          // Real Tone passes the callback ABSOLUTE AudioContext time, not the
          // transport position it was scheduled at.
          const absoluteTime =
            audioMocks.context.currentTime + (time - transportState.seconds);
          const timer = setTimeout(() => {
            scheduleOnceTimers.delete(eventId);
            callback(absoluteTime);
          }, delayMs);
          scheduleOnceTimers.set(eventId, timer);
          return eventId;
        }),
        scheduleRepeat: vi.fn(() => 401),
        start: vi.fn(),
        stop: vi.fn(),
      },
      resetScheduleOnceTimers() {
        for (const timer of scheduleOnceTimers.values()) {
          clearTimeout(timer);
        }
        scheduleOnceTimers.clear();
        nextScheduleOnceId = 501;
      },
    };
    return tone;
  },
}).make());

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

const moodSyncMocks = vi.hoisted(() => ({
  syncAssist: vi.fn(),
}));

const moodVideoPoolMocks = vi.hoisted(() => ({
  liveTakesFromSelections: vi.fn(() => []),
  prepareUpcoming: vi.fn(),
  setCaptureVideoPolicy: vi.fn(),
  syncPool: vi.fn(),
}));

vi.mock("./audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
  triggerCountInClick: audioMocks.triggerCountInClick,
}));

vi.mock("tone", () => ({
  getDraw: vi.fn(() => toneMocks.draw),
  getTransport: vi.fn(() => toneMocks.transport),
  now: toneMocks.now,
  start: toneMocks.start,
}));

vi.mock("./moodPlayers", () => ({
  setCaptureGain: vi.fn(),
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

vi.mock("./moodVideoPool", () => ({
  liveTakesFromSelections: moodVideoPoolMocks.liveTakesFromSelections,
  prepareUpcoming: moodVideoPoolMocks.prepareUpcoming,
  setCaptureVideoPolicy: moodVideoPoolMocks.setCaptureVideoPolicy,
  syncPool: moodVideoPoolMocks.syncPool,
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

vi.mock("./moodSyncAssist", () => ({
  syncAssist: moodSyncMocks.syncAssist,
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
import { setCaptureGain, stopAllMoodPlayers, syncMoodPlayers } from "./moodPlayers";
import { setCaptureVideoPolicy } from "./moodVideoPool";
import { useAppStore } from "../store/useAppStore";
import { MOOD_HEADPHONES_STORAGE_KEY } from "../store/initialState";
import { __resetAudioLifecycleForTesting } from "./audioLifecycle";
import { installNavigatorAudioSession } from "../test-utils/audioContextStub";
import {
  __resetMoodTransportForTesting,
  startMoodPerformance,
} from "./moodTransport";
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
  await vi.advanceTimersByTimeAsync(Math.ceil(Math.max(0, deadline - now) * 1000));
  await flushMicrotasks();
}

function seedMoodCycle(cycleSeconds = 2): void {
  const samples = new Float32Array(Math.max(1, Math.round(cycleSeconds * 1000)));
  useAppStore.getState().actions.setMoodTake(
    "mic-0",
    {
      id: "the-one",
      videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      audioBlob: new Blob([new Uint8Array([2])], { type: "audio/wav" }),
      posterBlob: null,
      url: "blob:test/the-one",
      audioBuffer: {
        duration: cycleSeconds,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 1000,
        getChannelData: () => samples,
      } as unknown as AudioBuffer,
      audioStatus: "ok",
      posterUrl: null,
      trimStartMs: 0,
      trimEndMs: Math.round(cycleSeconds * 1000),
      durationSeconds: cycleSeconds,
      cycleMultiple: 1,
      syncOffsetMs: 0,
      part: null,
      partSource: null,
      recordedAt: 1,
    },
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
    audioMocks.context.createBuffer.mockClear();
    toneMocks.start.mockReset();
    toneMocks.start.mockResolvedValue(undefined);
    toneMocks.now.mockReset();
    toneMocks.now.mockImplementation(() => audioMocks.context.currentTime);
    toneMocks.draw.schedule.mockClear();
    toneMocks.transport.cancel.mockClear();
    toneMocks.transport.clear.mockClear();
    toneMocks.transport.position = 0;
    toneMocks.transport.seconds = 0;
    toneMocks.resetScheduleOnceTimers();
    toneMocks.transport.scheduleOnce.mockClear();
    toneMocks.transport.scheduleRepeat.mockClear();
    toneMocks.transport.start.mockClear();
    toneMocks.transport.stop.mockClear();
    audioMocks.triggerCountInClick.mockClear();
    mediaMocks.acquireRecordingStream.mockReset();
    mediaMocks.acquireRecordingStream.mockResolvedValue(makeStream());
    mediaMocks.releaseRecordingStream.mockReset();
    mediaMocks.requestMedia.mockReset();
    vi.mocked(setCaptureGain).mockClear();
    vi.mocked(stopAllMoodPlayers).mockClear();
    vi.mocked(syncMoodPlayers).mockClear();
    vi.mocked(setCaptureVideoPolicy).mockClear();
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
    const oneTakeId = useAppStore.getState().mood.piece?.oneTakeId;
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe(oneTakeId);
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBeNull();
  });

  it("schedules count-in synth clicks on the audio clock and stops before punch-in", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });

    const promise = recordMoodTake("mic-0");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.countdownEndsAt).toBe(6.5);
    expect(audioMocks.triggerCountInClick.mock.calls).toEqual([[5], [5.5], [6]]);

    await advanceCountdownToDeadline();
    await expect(promise).resolves.toBe(true);

    expect(audioMocks.triggerCountInClick).not.toHaveBeenCalledWith(6.5);
    expect(audioMocks.triggerCountInClick).toHaveBeenCalledTimes(3);
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

  it("moves the audio session into play-and-record while the mood flow holds the mic", async () => {
    vi.useFakeTimers();
    const audioSession = installNavigatorAudioSession();
    const stream = makeStream();
    mediaMocks.acquireRecordingStream.mockImplementation(async () => {
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

      expect(audioSession.types).toEqual(["playback", "play-and-record"]);

      await advanceCountdownToDeadline();
      await expect(promise).resolves.toBe(true);

      expect(audioSession.types).toEqual(["playback", "play-and-record", "playback"]);
    } finally {
      audioSession.uninstall();
    }
  });

  it("counts down to the next cycle boundary when it has at least one beat of lead", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = 16.6;

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

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(useAppStore.getState().recording.countdownEndsAt).toBe(22);
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
    expect(autoSaveMocks.saveNow).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
  });

  it("auto-starts a stopped cycle after claiming recording while public starts stay blocked", async () => {
    vi.useFakeTimers();
    seedMoodCycle(2);
    const audioStarted = makeDeferred();
    toneMocks.start.mockReturnValueOnce(audioStarted.promise);

    const promise = recordMoodTake("mic-1");

    expect(useAppStore.getState().recording.state).toBe("preparing");
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);

    await startMoodPerformance();
    expect(toneMocks.transport.start).not.toHaveBeenCalled();

    audioStarted.resolve();
    await vi.dynamicImportSettled();
    await flushMicrotasks(10);

    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: true,
      epoch: 5,
    });
    expect(toneMocks.transport.scheduleRepeat).toHaveBeenCalledWith(expect.any(Function), 2);
    expect(toneMocks.transport.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().recording.state).toBe("countdown");

    cancelCurrentMoodTake();
    await expect(promise).resolves.toBe(false);
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
    expect(toneMocks.transport.stop).not.toHaveBeenCalled();
    expect(toneMocks.transport.cancel).not.toHaveBeenCalled();
    expect(toneMocks.transport.clear).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
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
    expect(toneMocks.transport.stop).not.toHaveBeenCalled();
    expect(toneMocks.transport.cancel).not.toHaveBeenCalled();
  });

  it("cancels overdub count-in ticks when an abort lands mid-count-in", async () => {
    vi.useFakeTimers();
    seedMoodCycle(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    audioMocks.context.currentTime = 16.6;
    // Transport time and audio-clock time have different origins: the
    // transport was re-positioned to 0 at performance start. Ticks must be
    // scheduled TRANSPORT-relative or they fire late by the epoch offset.
    toneMocks.transport.seconds = 100;
    toneMocks.transport.scheduleOnce
      .mockReturnValueOnce(601)
      .mockReturnValueOnce(602)
      .mockReturnValueOnce(603);

    const promise = recordMoodTake("mic-1");
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(toneMocks.transport.scheduleOnce).toHaveBeenCalledTimes(3);
    // Ticks intended for audio times 16.6/17.1/17.6 land at transport
    // positions 100/100.5/101.
    expect(toneMocks.transport.scheduleOnce.mock.calls.map((call) => call[1])).toEqual([
      100, 100.5, 101,
    ]);
    expect(audioMocks.triggerCountInClick).not.toHaveBeenCalled();

    cancelCurrentMoodTake();

    await expect(promise).resolves.toBe(false);
    expect(toneMocks.transport.clear.mock.calls).toEqual([[601], [602], [603]]);

    const scheduledCallbacks = toneMocks.transport.scheduleOnce.mock.calls.map(([callback]) => callback);
    scheduledCallbacks.forEach((callback, index) => callback(16.6 + index * 0.5));

    expect(audioMocks.triggerCountInClick).not.toHaveBeenCalled();
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
    expect(vi.mocked(setCaptureVideoPolicy).mock.calls.at(-1)).toEqual([false]);
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
