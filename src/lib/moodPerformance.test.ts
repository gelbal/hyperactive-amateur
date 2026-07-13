// ABOUTME: moodPerformance tests — pins arm → boundary commit → engine fanout.
// ABOUTME: Uses mocked Tone transport timing so Mood selections stay deterministic.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

type RepeatCallback = (time: number) => void;
type DrawTask = { callback: () => void; time: number };

const toneMocks = vi.hoisted(() => {
  let audioNow = 0;
  const drawTasks: DrawTask[] = [];
  const repeatCallbacks: RepeatCallback[] = [];
  const transport = {
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    scheduleRepeat: vi.fn((callback: RepeatCallback) => {
      repeatCallbacks.push(callback);
      return 501;
    }),
    position: 0 as number | string,
  };
  const draw = {
    schedule: vi.fn((callback: () => void, time: number) => {
      drawTasks.push({ callback, time });
      return drawTasks.length;
    }),
    advanceTo(time: number) {
      audioNow = time;
      const due = drawTasks
        .filter((task) => task.time <= time)
        .sort((a, b) => a.time - b.time);
      for (const task of due) {
        drawTasks.splice(drawTasks.indexOf(task), 1);
        task.callback();
      }
    },
    pendingTimes() {
      return drawTasks.map((task) => task.time).sort((a, b) => a - b);
    },
    reset() {
      drawTasks.length = 0;
      draw.schedule.mockClear();
    },
  };
  return {
    draw,
    now: vi.fn(() => audioNow),
    repeatCallbacks,
    setNow(time: number) {
      audioNow = time;
    },
    transport,
  };
});

const audioLifecycleMocks = vi.hoisted(() => ({
  ensureAudioRunning: vi.fn(),
}));

const moodPlayersMocks = vi.hoisted(() => ({
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

vi.mock("tone", () => ({
  getDraw: vi.fn(() => toneMocks.draw),
  getTransport: vi.fn(() => toneMocks.transport),
  now: toneMocks.now,
}));

vi.mock("./audioLifecycle", () => ({
  ensureAudioRunning: audioLifecycleMocks.ensureAudioRunning,
}));

vi.mock("./moodPlayers", () => ({
  stopAllMoodPlayers: moodPlayersMocks.stopAllMoodPlayers,
  syncMoodPlayers: moodPlayersMocks.syncMoodPlayers,
}));

import { __resetPendingAudibleClaimForTesting } from "./audibleActionGate";
import { applyDueCommits } from "./moodCommits";
import { armDrop, armLens, armSelection } from "./moodPerformance";
import {
  __resetMoodRendererForTesting,
  drawMoodFrame,
  initMoodRenderer,
} from "./moodRenderer";
import {
  __resetMoodTransportForTesting,
  consumeDueCommits,
  startMoodPerformance,
  stopMoodPerformance,
} from "./moodTransport";
import {
  __resetMoodVideoPoolForTesting,
  videoForTake,
} from "./moodVideoPool";
import { useMoodKeys } from "./useMoodKeys";
import { useAppStore } from "../store/useAppStore";
import { STAGE_DESCRIPTORS } from "./moodStages";
import type { MoodPiece, MoodTake } from "../types";

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

function createMoodWithStack(cycleSeconds = 2): {
  takeA: MoodTake;
  takeB: MoodTake;
} {
  const actions = useAppStore.getState().actions;
  const takeA = makeMoodTake({ id: "take-a", durationSeconds: cycleSeconds });
  const takeB = makeMoodTake({ id: "take-b", durationSeconds: cycleSeconds });
  actions.createMoodPiece("row", "pocket");
  actions.setMoodTake("mic-0", takeA);
  actions.setMoodTake("mic-0", takeB);
  actions.setAppMode("mood");
  return { takeA, takeB };
}

function currentMood() {
  const mood = useAppStore.getState().mood;
  if (!mood.piece) throw new Error("Expected a Mood piece");
  return mood as { piece: MoodPiece; performance: typeof mood.performance };
}

function createRenderer(stage: MoodPiece["stage"] = "row"): void {
  const canvas = document.createElement("canvas");
  const descriptor = STAGE_DESCRIPTORS[stage];
  canvas.width = descriptor.canvasSize.w;
  canvas.height = descriptor.canvasSize.h;
  initMoodRenderer(canvas, stage);
}

function fireCycleBoundary(time: number): void {
  const callback = toneMocks.repeatCallbacks[0];
  if (!callback) throw new Error("Expected scheduled Mood boundary callback");
  callback(time);
}

function KeyHarness({ withInput = false }: { withInput?: boolean }) {
  useMoodKeys();
  return withInput ? createElement("input", { "data-testid": "mood-input" }) : null;
}

describe("moodPerformance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    __resetPendingAudibleClaimForTesting();
    __resetMoodTransportForTesting();
    __resetMoodRendererForTesting();
    __resetMoodVideoPoolForTesting();
    audioLifecycleMocks.ensureAudioRunning.mockReset();
    audioLifecycleMocks.ensureAudioRunning.mockResolvedValue(undefined);
    moodPlayersMocks.stopAllMoodPlayers.mockReset();
    moodPlayersMocks.syncMoodPlayers.mockReset();
    toneMocks.setNow(0);
    toneMocks.now.mockClear();
    toneMocks.repeatCallbacks.length = 0;
    toneMocks.transport.start.mockClear();
    toneMocks.transport.stop.mockClear();
    toneMocks.transport.clear.mockClear();
    toneMocks.transport.scheduleRepeat.mockClear();
    toneMocks.transport.position = 0;
    toneMocks.draw.reset();
  });

  afterEach(() => {
    cleanup();
    stopMoodPerformance();
    __resetMoodTransportForTesting();
    __resetMoodRendererForTesting();
    __resetMoodVideoPoolForTesting();
    __resetPendingAudibleClaimForTesting();
  });

  it("arms during performance, then commits once on the next cycle boundary and fans out to players and pool", async () => {
    const { takeB } = createMoodWithStack(2);
    toneMocks.setNow(10);
    await startMoodPerformance();
    moodPlayersMocks.syncMoodPlayers.mockClear();

    toneMocks.setNow(10.5);
    armSelection("mic-0", "take-b");

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBe("take-b");
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);
    expect(moodPlayersMocks.syncMoodPlayers).not.toHaveBeenCalled();

    fireCycleBoundary(12);
    applyDueCommits(11.99);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");

    applyDueCommits(12);

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBeNull();
    expect(moodPlayersMocks.syncMoodPlayers).toHaveBeenCalledTimes(1);
    expect(moodPlayersMocks.syncMoodPlayers).toHaveBeenCalledWith(
      [{ takeId: "take-b", take: takeB }],
      10,
      2,
    );
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);
  });

  it("commits immediately while stopped and syncs only the visible pool", () => {
    createMoodWithStack(2);

    armSelection("mic-0", "take-a");

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBeNull();
    expect(videoForTake("take-a")).toBeInstanceOf(HTMLVideoElement);
    expect(moodPlayersMocks.syncMoodPlayers).not.toHaveBeenCalled();
  });

  it("applies lens changes immediately while stopped", () => {
    createMoodWithStack(2);

    armLens("splits");

    expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
    expect(toneMocks.repeatCallbacks).toHaveLength(0);
  });

  it.each(["preparing", "countdown", "recording", "reviewing"] as const)(
    "no-ops armSelection while a take is %s",
    (recordingState) => {
      createMoodWithStack(2);
      useAppStore.getState().actions.setRecordingState(recordingState, 0);

      armSelection("mic-0", "take-a");

      expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
      expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBeNull();
      expect(videoForTake("take-a")).toBeNull();
      expect(moodPlayersMocks.syncMoodPlayers).not.toHaveBeenCalled();
    },
  );

  it.each(["preparing", "countdown", "recording"] as const)(
    "no-ops armLens while a take is %s",
    (recordingState) => {
      createMoodWithStack(2);
      useAppStore.getState().actions.setRecordingState(recordingState, 0);

      armLens("splits");

      expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
      expect(useAppStore.getState().mood.performance.armedLens).toBeNull();
    },
  );

  it("arms during a Mood performance export because selections are transient", () => {
    createMoodWithStack(2);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    useAppStore.getState().actions.setIsExporting(true);
    toneMocks.setNow(10.5);

    armSelection("mic-0", "take-a");

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBe("take-a");
    expect(videoForTake("take-a")).toBeInstanceOf(HTMLVideoElement);
  });

  it("freezes lens changes during export because the lens belongs to the piece", () => {
    createMoodWithStack(2);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    useAppStore.getState().actions.setIsExporting(true);
    toneMocks.setNow(10.5);

    armLens("splits");

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
  });

  it("applies a pre-armed lens commit during capture through the boundary drain", async () => {
    createMoodWithStack(2);
    toneMocks.setNow(10);
    await startMoodPerformance();

    toneMocks.setNow(10.5);
    armLens("splits");
    useAppStore.getState().actions.setRecordingState("recording", 0);

    fireCycleBoundary(12);
    applyDueCommits(12);

    expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
  });

  it("seeds the already committed mix when performance starts", async () => {
    const { takeA } = createMoodWithStack(2);
    armSelection("mic-0", "take-a");
    moodPlayersMocks.syncMoodPlayers.mockClear();

    toneMocks.setNow(20);
    await startMoodPerformance();

    expect(moodPlayersMocks.syncMoodPlayers).toHaveBeenCalledTimes(1);
    expect(moodPlayersMocks.syncMoodPlayers).toHaveBeenCalledWith(
      [{ takeId: "take-a", take: takeA }],
      20,
      2,
    );
  });

  it("replaces a prior arm for the same mic before the boundary", async () => {
    const { takeB } = createMoodWithStack(2);
    toneMocks.setNow(10);
    await startMoodPerformance();
    moodPlayersMocks.syncMoodPlayers.mockClear();

    toneMocks.setNow(10.25);
    armSelection("mic-0", "take-a");
    toneMocks.setNow(10.5);
    armSelection("mic-0", "take-b");
    fireCycleBoundary(12);
    applyDueCommits(12);

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(moodPlayersMocks.syncMoodPlayers).toHaveBeenCalledWith(
      [{ takeId: "take-b", take: takeB }],
      10,
      2,
    );
    expect(videoForTake("take-a")).toBeNull();
    expect(videoForTake("take-b")).toBeInstanceOf(HTMLVideoElement);
  });

  it("arms lens changes while performing and commits them on the One", async () => {
    createMoodWithStack(2);
    toneMocks.setNow(10);
    await startMoodPerformance();

    toneMocks.setNow(10.5);
    armLens("splits");

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
    expect(useAppStore.getState().mood.performance.armedLens).toBe("splits");

    fireCycleBoundary(12);
    applyDueCommits(11.99);
    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");

    applyDueCommits(12);
    expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();
  });

  it("lets the last armed lens intent win even when it returns to the committed lens", async () => {
    createMoodWithStack(2);
    toneMocks.setNow(10);
    await startMoodPerformance();

    toneMocks.setNow(10.25);
    armLens("splits");
    expect(useAppStore.getState().mood.performance.armedLens).toBe("splits");

    toneMocks.setNow(10.5);
    armLens("wall");
    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();

    fireCycleBoundary(12);
    applyDueCommits(12);

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();
  });

  it("clears armedLens when performance stops", async () => {
    createMoodWithStack(2);
    toneMocks.setNow(10);
    await startMoodPerformance();

    toneMocks.setNow(10.5);
    armLens("splits");
    expect(useAppStore.getState().mood.performance.armedLens).toBe("splits");

    stopMoodPerformance();

    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();
  });

  it("starts the wardrobe on and commits the Drop on the next beat", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("mixtape");
    toneMocks.setNow(10);
    await startMoodPerformance();

    expect(useAppStore.getState().mood.performance.dropActive).toBe(true);

    toneMocks.setNow(10.2);
    armDrop();

    expect(useAppStore.getState().mood.performance.dropActive).toBe(true);
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    applyDueCommits(10.49);
    expect(useAppStore.getState().mood.performance.dropActive).toBe(true);
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    applyDueCommits(10.5);
    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);
    expect(useAppStore.getState().mood.performance.armedDropActive).toBeNull();
  });

  it("keeps the Drop live during export but blocked during capture", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    toneMocks.setNow(20);
    await startMoodPerformance();

    useAppStore.getState().actions.setIsExporting(true);
    toneMocks.setNow(20.2);
    armDrop();

    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    useAppStore.getState().actions.setIsExporting(false);
    applyDueCommits(20.5);
    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);

    useAppStore.getState().actions.setRecordingState("recording", 0);
    toneMocks.setNow(20.7);
    armDrop();

    expect(useAppStore.getState().mood.performance.armedDropActive).toBeNull();
    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);
  });

  it("applies a due selection even when the same mic re-arms before any drain", async () => {
    createMoodWithStack(4);
    toneMocks.setNow(10);
    await startMoodPerformance();

    toneMocks.setNow(10.2);
    armSelection("mic-0", "take-a");

    // The cycle boundary (14) passes with NO paint drain, then the
    // performer re-arms the same mic. The due take-a swap must still land.
    toneMocks.setNow(14.1);
    armSelection("mic-0", "take-b");

    applyDueCommits(14.2);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    applyDueCommits(18);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
  });

  it("clears a queued Drop when performance stops", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("print");
    toneMocks.setNow(30);
    await startMoodPerformance();

    toneMocks.setNow(30.2);
    armDrop();
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    stopMoodPerformance();

    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);
    expect(useAppStore.getState().mood.performance.armedDropActive).toBeNull();
    expect(consumeDueCommits(30.5)).toEqual([]);
  });

  it("keeps outgoing and prepared incoming videos through the pre-boundary frame, then prunes after commit", async () => {
    createMoodWithStack(2);
    armSelection("mic-0", "take-a");
    const outgoing = videoForTake("take-a");
    expect(outgoing).toBeInstanceOf(HTMLVideoElement);
    createRenderer("row");
    toneMocks.setNow(10);
    await startMoodPerformance();

    toneMocks.setNow(10.5);
    armSelection("mic-0", "take-b");
    const incoming = videoForTake("take-b");
    expect(incoming).toBeInstanceOf(HTMLVideoElement);
    fireCycleBoundary(12);

    drawMoodFrame(11.99, currentMood());
    expect(videoForTake("take-a")).toBe(outgoing);
    expect(videoForTake("take-b")).toBe(incoming);

    drawMoodFrame(12, currentMood());
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
    expect(videoForTake("take-a")).toBeNull();
    expect(videoForTake("take-b")).toBe(incoming);
  });

  it("cycles Digit1 downward through takes and Off, Shift+Digit arms Off, and editable targets suppress", () => {
    createMoodWithStack(2);
    const { getByTestId } = render(createElement(KeyHarness, { withInput: true }));

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }));
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }));
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }));
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }));
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", shiftKey: true, bubbles: true }),
    );
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");

    getByTestId("mood-input").dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }),
    );
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
  });

  it("maps KeyD to the Drop and suppresses editable targets", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    toneMocks.setNow(10);
    await startMoodPerformance();
    const { getByTestId } = render(createElement(KeyHarness, { withInput: true }));

    toneMocks.setNow(10.2);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    useAppStore.getState().actions.setMoodArmedDrop(null);
    getByTestId("mood-input").dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }),
    );
    expect(useAppStore.getState().mood.performance.armedDropActive).toBeNull();
  });
});
