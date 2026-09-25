// ABOUTME: Mood transport tests — pins gate discipline, Transport ownership, and boundary staging.
// ABOUTME: Uses mocked Tone and audio unlocks so Mood scheduling stays deterministic in JSDOM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  const toneHarness = createToneHarness();
  const captureRepeat = toneHarness.transport.scheduleRepeat.getMockImplementation();
  toneHarness.transport.scheduleRepeat.mockImplementation((callback, interval, startTime) => {
    captureRepeat?.(callback, interval, startTime);
    return 101;
  });
  return { toneHarness };
});

const audioLifecycleMocks = vi.hoisted(() => ({
  ensureAudioRunning: vi.fn(),
}));

const moodPlayersMocks = vi.hoisted(() => ({
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

const moodFxMocks = vi.hoisted(() => ({
  initializeMoodFxForPerformance: vi.fn(),
  resetMoodDropFilter: vi.fn(),
}));

const moodVideoPoolMocks = vi.hoisted(() => ({
  liveTakesFromSelections: vi.fn(() => []),
  prepareUpcoming: vi.fn(),
  restartVideosAtPeriodBoundary: vi.fn(),
  syncPool: vi.fn(),
}));

vi.mock("tone", () => toneHarness.createToneModule());

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
}));

vi.mock("./moodPlayers", () => ({
  stopAllMoodPlayers: moodPlayersMocks.stopAllMoodPlayers,
  syncMoodPlayers: moodPlayersMocks.syncMoodPlayers,
}));

vi.mock("./moodFx", () => ({
  initializeMoodFxForPerformance: moodFxMocks.initializeMoodFxForPerformance,
  resetMoodDropFilter: moodFxMocks.resetMoodDropFilter,
}));

vi.mock("./moodVideoPool", () => ({
  liveTakesFromSelections: moodVideoPoolMocks.liveTakesFromSelections,
  prepareUpcoming: moodVideoPoolMocks.prepareUpcoming,
  restartVideosAtPeriodBoundary: moodVideoPoolMocks.restartVideosAtPeriodBoundary,
  syncPool: moodVideoPoolMocks.syncPool,
}));

import {
  __resetMoodTransportForTesting,
  armMoodLensCommit,
  armMoodSelectionCommit,
  consumeDueCommits,
  registerMoodPerformanceInterrupt,
  startMoodPerformance,
  startMoodPerformanceForExportFlow,
  stopMoodPerformance,
} from "./moodTransport";
import { interruptActivePerformance } from "./performanceInterrupt";
import {
  __resetPendingAudibleClaimForTesting,
  canStartAudibleAction,
  claimPendingAudible,
  invalidatePendingAudible,
} from "./audibleActionGate";
import { applyDueCommits } from "./moodCommits";
import { registerExportSession, __resetExportSessionForTesting } from "./exportSession";
import { armSelection } from "./moodPerformance";
import { useAppStore } from "../store/useAppStore";
import { makeMoodTake } from "../test-utils/moodFixtures";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    toneHarness.transport.reset();
    toneHarness.draw.reset();
    moodVideoPoolMocks.liveTakesFromSelections.mockReset();
    moodVideoPoolMocks.liveTakesFromSelections.mockReturnValue([]);
    moodVideoPoolMocks.prepareUpcoming.mockReset();
    moodVideoPoolMocks.restartVideosAtPeriodBoundary.mockReset();
    moodVideoPoolMocks.syncPool.mockReset();
    moodPlayersMocks.stopAllMoodPlayers.mockReset();
    moodPlayersMocks.syncMoodPlayers.mockReset();
    moodFxMocks.resetMoodDropFilter.mockReset();
    moodFxMocks.initializeMoodFxForPerformance.mockReset();
  });

  afterEach(() => {
    stopMoodPerformance();
    __resetMoodTransportForTesting();
    __resetPendingAudibleClaimForTesting();
  });

  it("claims the audible gate before awaiting audio unlock and starts after the recheck", async () => {
    createMoodWithCycle(2.5);
    toneHarness.setImmediate(8);
    const audioStarted = deferred();
    audioLifecycleMocks.ensureAudioRunning.mockReturnValueOnce(audioStarted.promise);

    const promise = startMoodPerformance();

    expect(audioLifecycleMocks.ensureAudioRunning).toHaveBeenCalledTimes(1);
    // The pending claim holds: a second audible tap during the unlock drops.
    expect(claimPendingAudible()).toBeNull();
    expect(toneHarness.transport.scheduleRepeat).not.toHaveBeenCalled();

    audioStarted.resolve();
    await promise;

    expect(toneHarness.transport.scheduleRepeat).toHaveBeenCalledWith(
      expect.any(Function),
      2.5,
    );
    expect(moodFxMocks.initializeMoodFxForPerformance).toHaveBeenCalledWith(2.5);
    expect(toneHarness.transport.position).toBe(0);
    expect(toneHarness.transport.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: true,
      epoch: 8,
      cycleCount: 0,
    });
  });

  it("does not start the performance when the page is hidden as the unlock settles", async () => {
    createMoodWithCycle();
    const audioStarted = deferred();
    audioLifecycleMocks.ensureAudioRunning.mockReturnValueOnce(audioStarted.promise);
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");

    const promise = startMoodPerformance();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      audioStarted.resolve();
      await promise;

      expect(toneHarness.transport.start).not.toHaveBeenCalled();
      expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
      expect(claimPendingAudible()).toEqual(expect.any(Function));
    } finally {
      if (hiddenDescriptor) {
        Object.defineProperty(document, "hidden", hiddenDescriptor);
      } else {
        Reflect.deleteProperty(document, "hidden");
      }
    }
  });

  it("does not start the performance when the page hid and returned before the unlock settled", async () => {
    createMoodWithCycle();
    const audioStarted = deferred();
    audioLifecycleMocks.ensureAudioRunning.mockReturnValueOnce(audioStarted.promise);

    const promise = startMoodPerformance();
    // The hidden handler invalidates the claim; the page is visible again by
    // the time the frozen unlock resolves.
    invalidatePendingAudible();
    audioStarted.resolve();
    await promise;

    expect(toneHarness.transport.start).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
    expect(claimPendingAudible()).toEqual(expect.any(Function));
  });

  it("runs Mood on an unswung transport and hands Chop's swing back on stop", async () => {
    createMoodWithCycle();
    useAppStore.getState().actions.setSwing(0.5);
    toneHarness.transport.swing = 0.5;

    await startMoodPerformance();
    // Tone delays off-grid events under swing: count-in ticks and the GATE
    // repeat would land late.
    expect(toneHarness.transport.swing).toBe(0);

    stopMoodPerformance();
    expect(toneHarness.transport.swing).toBe(0.5);
  });

  it("does not start the transport when a stop lands while the start is still settling", async () => {
    createMoodWithCycle();
    useAppStore.getState().actions.setSwing(0.5);
    toneHarness.transport.swing = 0.5;
    // A hide or an interruption, arriving just after the store says performing
    // and before the start's last await settles.
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (!prev.mood.performance.isPerforming && state.mood.performance.isPerforming) {
        queueMicrotask(() => stopMoodPerformance());
      }
    });

    try {
      await startMoodPerformance();
    } finally {
      unsubscribe();
    }

    // Chop's step loop plays whenever the transport runs unowned.
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
    const started = toneHarness.transport.start.mock.invocationCallOrder.at(-1) ?? 0;
    const stopped = toneHarness.transport.stop.mock.invocationCallOrder.at(-1) ?? 0;
    expect(started).toBeLessThan(stopped);
    expect(toneHarness.transport.swing).toBe(0.5);
  });

  it("lets a hide or an interruption stop a running performance once registered", async () => {
    createMoodWithCycle();
    const unregister = registerMoodPerformanceInterrupt();

    expect(interruptActivePerformance()).toBe(false);

    await startMoodPerformance();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);

    expect(interruptActivePerformance()).toBe(true);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
    expect(toneHarness.transport.stop).toHaveBeenCalled();

    unregister();
    await startMoodPerformance();
    expect(interruptActivePerformance()).toBe(false);
    stopMoodPerformance();
  });

  it("rechecks store state after audio unlock before owning the Transport", async () => {
    createMoodWithCycle();
    const audioStarted = deferred();
    audioLifecycleMocks.ensureAudioRunning.mockReturnValueOnce(audioStarted.promise);

    const promise = startMoodPerformance();
    useAppStore.getState().actions.setRecordingState("recording", 0);

    audioStarted.resolve();
    await promise;

    expect(toneHarness.transport.scheduleRepeat).not.toHaveBeenCalled();
    expect(toneHarness.transport.start).not.toHaveBeenCalled();
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
    expect(toneHarness.transport.start).not.toHaveBeenCalled();
  });

  it("startMoodPerformanceForExportFlow starts only inside an active export", async () => {
    createMoodWithCycle(2);

    // No export at all → refused (the export session is the mutex).
    expect(await startMoodPerformanceForExportFlow()).toBe(false);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);

    // isExporting alone is not enough — a REGISTERED session is required.
    useAppStore.getState().actions.setIsExporting(true);
    expect(await startMoodPerformanceForExportFlow()).toBe(false);

    const unregister = registerExportSession({ abort: () => undefined });
    if (!unregister) throw new Error("expected to register the export session");
    useAppStore.getState().actions.setRecordingState("recording", 0);
    expect(await startMoodPerformanceForExportFlow()).toBe(false);

    useAppStore.getState().actions.setRecordingState("idle", null);
    expect(await startMoodPerformanceForExportFlow()).toBe(true);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(true);
    expect(toneHarness.transport.start).toHaveBeenCalledTimes(1);

    unregister();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("stages boundary commits for paint-path consumption exactly once", async () => {
    createMoodWithCycle(2);
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "take-a" }, 12, 10);

    const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);
    toneHarness.draw.advanceTo(12);

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
    expect(consumeDueCommits(11.99)).toEqual([]);
    expect(consumeDueCommits(12)).toEqual([
      { type: "selection", micId: "mic-0", entry: "take-a", boundaryTime: 12 },
    ]);
    expect(consumeDueCommits(99)).toEqual([]);
    expect(toneHarness.draw.schedule).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.cycleCount).toBe(1);
  });

  it("stages armed selections without syncing or pruning the video pool", async () => {
    createMoodWithCycle(2);
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    moodVideoPoolMocks.liveTakesFromSelections.mockClear();
    moodVideoPoolMocks.syncPool.mockClear();
    moodVideoPoolMocks.prepareUpcoming.mockClear();
    armMoodSelectionCommit({ micId: "mic-0", entry: "the-one" }, 12, 10);

    const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);

    expect(consumeDueCommits(12)).toEqual([
      { type: "selection", micId: "mic-0", entry: "the-one", boundaryTime: 12 },
    ]);
    expect(moodVideoPoolMocks.liveTakesFromSelections).not.toHaveBeenCalled();
    expect(moodVideoPoolMocks.syncPool).not.toHaveBeenCalled();
    expect(moodVideoPoolMocks.prepareUpcoming).not.toHaveBeenCalled();
  });

  it("drains a deleted staged arm to off instead of resurrecting the ghost take", async () => {
    createMoodWithCycle(2);
    const actions = useAppStore.getState().actions;
    actions.setMoodTake("mic-1", makeMoodTake({ id: "ghost-arm" }));
    toneHarness.setImmediate(0);
    await startMoodPerformance();

    armSelection("mic-1", "ghost-arm");
    expect(useAppStore.getState().mood.performance.armed["mic-1"]).toBe("ghost-arm");

    actions.deleteMoodTake("mic-1", "ghost-arm");
    expect(useAppStore.getState().mood.performance.armed["mic-1"]).toBe("off");

    const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(2);
    applyDueCommits(2);

    expect(useAppStore.getState().mood.performance.selections["mic-1"]).toBe("off");
    expect(useAppStore.getState().mood.performance.armed["mic-1"]).toBeNull();
  });

  it("applies due lens commits through the same paint-path drain", async () => {
    createMoodWithCycle(2);
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    armMoodSelectionCommit({ micId: "mic-0", entry: "the-one" }, 12, 10);
    armMoodLensCommit("splits", 12, 10);

    const boundaryCallback = toneHarness.transport.scheduleRepeat.mock.calls[0]?.[0];
    boundaryCallback?.(12);

    applyDueCommits(11.99);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");

    applyDueCommits(12);

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("the-one");
    expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
    applyDueCommits(99);
    expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
  });

  it("stop cancels the repeat, resets flags, and preserves the mix", async () => {
    createMoodWithCycle();
    await startMoodPerformance();
    const actions = useAppStore.getState().actions;
    actions.commitMoodSelections([{ micId: "mic-0", entry: "the-one" }]);
    actions.setMoodDrop(true);
    actions.setMoodHotMic("mic-0");
    actions.setMoodCycleCount(7);
    armMoodSelectionCommit({ micId: "mic-1", entry: "take-b" }, 4, 2);
    moodFxMocks.resetMoodDropFilter.mockClear();

    stopMoodPerformance();

    expect(toneHarness.transport.clear).toHaveBeenCalledWith(101);
    expect(toneHarness.transport.stop).toHaveBeenCalledTimes(1);
    expect(toneHarness.transport.position).toBe(0);
    expect(moodFxMocks.resetMoodDropFilter).toHaveBeenCalledTimes(1);
    expect(consumeDueCommits(99)).toEqual([]);
    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: false,
      epoch: null,
      selections: { "mic-0": "the-one", "mic-1": "off" },
      dropActive: false,
      // Performance stop cannot own capture presentation cleanup; the active
      // recording flow clears its hot mic when that flow settles.
      hotMicId: "mic-0",
      cycleCount: 0,
    });
  });

  it("switching back to Chop stops Mood performance ownership", async () => {
    createMoodWithCycle();
    await startMoodPerformance();

    useAppStore.getState().actions.setAppMode("chop");

    expect(useAppStore.getState().appMode).toBe("chop");
    expect(toneHarness.transport.clear).toHaveBeenCalledWith(101);
    expect(toneHarness.transport.stop).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
  });
});
