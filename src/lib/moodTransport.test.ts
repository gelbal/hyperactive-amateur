// ABOUTME: Mood transport tests — pins gate discipline, Transport ownership, and boundary staging.
// ABOUTME: Uses mocked Tone and audio unlocks so Mood scheduling stays deterministic in JSDOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RepeatCallback = (time: number) => void;

const toneMocks = vi.hoisted(() => {
  const transport = {
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    scheduleRepeat: vi.fn<(callback: RepeatCallback, interval: number) => number>(() => 101),
    position: 0 as number | string,
  };
  const draw = {
    schedule: vi.fn((callback: () => void) => {
      callback();
      return 201;
    }),
  };
  return {
    draw,
    now: vi.fn(() => 0),
    transport,
  };
});

const audioLifecycleMocks = vi.hoisted(() => ({
  ensureAudioRunning: vi.fn(),
}));

const moodVideoPoolMocks = vi.hoisted(() => ({
  liveTakesFromSelections: vi.fn(() => []),
  prepareUpcoming: vi.fn(),
  syncPool: vi.fn(),
}));

vi.mock("tone", () => ({
  getDraw: vi.fn(() => toneMocks.draw),
  getTransport: vi.fn(() => toneMocks.transport),
  now: toneMocks.now,
}));

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
}));

vi.mock("./moodVideoPool", () => ({
  liveTakesFromSelections: moodVideoPoolMocks.liveTakesFromSelections,
  prepareUpcoming: moodVideoPoolMocks.prepareUpcoming,
  syncPool: moodVideoPoolMocks.syncPool,
}));

import {
  __resetMoodTransportForTesting,
  armMoodSelectionCommit,
  consumeDueCommits,
  startMoodPerformance,
  stopMoodPerformance,
} from "./moodTransport";
import {
  __resetPendingAudibleClaimForTesting,
  canStartAudibleAction,
} from "./audibleActionGate";
import { useAppStore } from "../store/useAppStore";
import type { MoodTake } from "../types";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMoodTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "take-1";
  const durationSeconds = overrides.durationSeconds ?? 2;
  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: durationSeconds, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: durationSeconds * 1000,
    durationSeconds,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

function createMoodWithCycle(cycleSeconds = 2) {
  const actions = useAppStore.getState().actions;
  actions.createMoodPiece("row", "pocket");
  actions.setMoodTake(
    "mic-0",
    makeMoodTake({ id: "the-one", durationSeconds: cycleSeconds }),
  );
  actions.setAppMode("mood");
}

describe("moodTransport", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    __resetPendingAudibleClaimForTesting();
    __resetMoodTransportForTesting();
    audioLifecycleMocks.ensureAudioRunning.mockReset();
    audioLifecycleMocks.ensureAudioRunning.mockResolvedValue(undefined);
    toneMocks.now.mockReset();
    toneMocks.now.mockReturnValue(0);
    toneMocks.transport.start.mockClear();
    toneMocks.transport.stop.mockClear();
    toneMocks.transport.clear.mockClear();
    toneMocks.transport.scheduleRepeat.mockClear();
    toneMocks.transport.position = 0;
    toneMocks.draw.schedule.mockClear();
    moodVideoPoolMocks.liveTakesFromSelections.mockReset();
    moodVideoPoolMocks.liveTakesFromSelections.mockReturnValue([]);
    moodVideoPoolMocks.prepareUpcoming.mockReset();
    moodVideoPoolMocks.syncPool.mockReset();
  });

  afterEach(() => {
    stopMoodPerformance();
    __resetMoodTransportForTesting();
    __resetPendingAudibleClaimForTesting();
  });

  it("claims the audible gate before awaiting audio unlock and starts after the recheck", async () => {
    createMoodWithCycle(2.5);
    toneMocks.now.mockReturnValueOnce(8);
    const audioStarted = deferred();
    audioLifecycleMocks.ensureAudioRunning.mockReturnValueOnce(audioStarted.promise);

    const promise = startMoodPerformance();

    expect(audioLifecycleMocks.ensureAudioRunning).toHaveBeenCalledTimes(1);
    expect(canStartAudibleAction(useAppStore.getState())).toBe(false);
    expect(toneMocks.transport.scheduleRepeat).not.toHaveBeenCalled();

    audioStarted.resolve();
    await promise;

    expect(toneMocks.transport.scheduleRepeat).toHaveBeenCalledWith(
      expect.any(Function),
      2.5,
    );
    expect(toneMocks.transport.position).toBe(0);
    expect(toneMocks.transport.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: true,
      epoch: 8,
      cycleCount: 0,
    });
  });

  it("rechecks store state after audio unlock before owning the Transport", async () => {
    createMoodWithCycle();
    const audioStarted = deferred();
    audioLifecycleMocks.ensureAudioRunning.mockReturnValueOnce(audioStarted.promise);

    const promise = startMoodPerformance();
    useAppStore.getState().actions.setRecordingState("recording", 0);

    audioStarted.resolve();
    await promise;

    expect(toneMocks.transport.scheduleRepeat).not.toHaveBeenCalled();
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);

    useAppStore.getState().actions.setRecordingState("idle", null);
    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
  });

  it("refuses to start without a cycle or outside Mood mode", async () => {
    const actions = useAppStore.getState().actions;
    actions.setAppMode("mood");
    actions.createMoodPiece("row", "pocket");

    await startMoodPerformance();

    expect(audioLifecycleMocks.ensureAudioRunning).not.toHaveBeenCalled();

    createMoodWithCycle();
    actions.setAppMode("chop");

    await startMoodPerformance();

    expect(audioLifecycleMocks.ensureAudioRunning).not.toHaveBeenCalled();
  });

  it("refuses to start while Chop playback owns sound", async () => {
    createMoodWithCycle();
    useAppStore.getState().actions.setIsPlaying(true);

    await startMoodPerformance();

    expect(audioLifecycleMocks.ensureAudioRunning).not.toHaveBeenCalled();
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
  });

  it("stages boundary commits for paint-path consumption exactly once", async () => {
    createMoodWithCycle(2);
    toneMocks.now.mockReturnValueOnce(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "take-a" }, 12);

    const boundaryCallback = toneMocks.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
    expect(consumeDueCommits(11.99)).toEqual([]);
    expect(consumeDueCommits(12)).toEqual([
      { type: "selection", micId: "mic-0", entry: "take-a", boundaryTime: 12 },
    ]);
    expect(consumeDueCommits(99)).toEqual([]);
    expect(toneMocks.draw.schedule).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.cycleCount).toBe(1);
  });

  it("stages armed selections without syncing or pruning the video pool", async () => {
    createMoodWithCycle(2);
    toneMocks.now.mockReturnValueOnce(10);
    await startMoodPerformance();
    moodVideoPoolMocks.liveTakesFromSelections.mockClear();
    moodVideoPoolMocks.syncPool.mockClear();
    moodVideoPoolMocks.prepareUpcoming.mockClear();
    armMoodSelectionCommit({ micId: "mic-0", entry: "the-one" }, 12);

    const boundaryCallback = toneMocks.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);

    expect(consumeDueCommits(12)).toEqual([
      { type: "selection", micId: "mic-0", entry: "the-one", boundaryTime: 12 },
    ]);
    expect(moodVideoPoolMocks.liveTakesFromSelections).not.toHaveBeenCalled();
    expect(moodVideoPoolMocks.syncPool).not.toHaveBeenCalled();
    expect(moodVideoPoolMocks.prepareUpcoming).not.toHaveBeenCalled();
  });

  it("stop cancels the repeat, resets flags, and preserves the mix", async () => {
    createMoodWithCycle();
    await startMoodPerformance();
    const actions = useAppStore.getState().actions;
    actions.commitMoodSelections([{ micId: "mic-0", entry: "take-a" }]);
    actions.setMoodDrop(true);
    actions.setMoodHotMic("mic-0");
    actions.setMoodCycleCount(7);
    armMoodSelectionCommit({ micId: "mic-1", entry: "take-b" }, 4);

    stopMoodPerformance();

    expect(toneMocks.transport.clear).toHaveBeenCalledWith(101);
    expect(toneMocks.transport.stop).toHaveBeenCalledTimes(1);
    expect(toneMocks.transport.position).toBe(0);
    expect(consumeDueCommits(99)).toEqual([]);
    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: false,
      epoch: null,
      selections: { "mic-0": "take-a", "mic-1": "off" },
      dropActive: false,
      hotMicId: null,
      cycleCount: 0,
    });
  });

  it("switching back to Chop stops Mood performance ownership", async () => {
    createMoodWithCycle();
    await startMoodPerformance();

    useAppStore.getState().actions.setAppMode("chop");

    expect(useAppStore.getState().appMode).toBe("chop");
    expect(toneMocks.transport.clear).toHaveBeenCalledWith(101);
    expect(toneMocks.transport.stop).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
  });
});
