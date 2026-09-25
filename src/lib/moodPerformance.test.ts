// ABOUTME: moodPerformance tests — pins arm → boundary commit → engine fanout.
// ABOUTME: Uses mocked Tone transport timing so Mood selections stay deterministic.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});

const audioLifecycleMocks = vi.hoisted(() => ({
  ensureAudioRunning: vi.fn(),
}));

const moodPlayersMocks = vi.hoisted(() => ({
  stopAllMoodPlayers: vi.fn(),
  syncMoodPlayers: vi.fn(),
}));

const moodFxMocks = vi.hoisted(() => ({
  brakeVisualLevel: vi.fn(() => 0),
  echoVisualLevel: vi.fn(() => 0),
  gateVisualActive: vi.fn(() => false),
  harmonizeVisualLevel: vi.fn(() => 0),
  initializeMoodFxForPerformance: vi.fn(),
  pressMoodBrake: vi.fn(() => true),
  pressMoodGate: vi.fn(() => true),
  pressMoodHarmonize: vi.fn(() => true),
  releaseMoodBrake: vi.fn(() => true),
  releaseMoodGate: vi.fn(() => true),
  releaseMoodHarmonize: vi.fn(() => true),
  resetMoodDropFilter: vi.fn(),
  scheduleMoodDropFilter: vi.fn(),
  triggerMoodEcho: vi.fn(() => true),
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
  brakeVisualLevel: moodFxMocks.brakeVisualLevel,
  echoVisualLevel: moodFxMocks.echoVisualLevel,
  gateVisualActive: moodFxMocks.gateVisualActive,
  harmonizeVisualLevel: moodFxMocks.harmonizeVisualLevel,
  initializeMoodFxForPerformance: moodFxMocks.initializeMoodFxForPerformance,
  pressMoodBrake: moodFxMocks.pressMoodBrake,
  pressMoodGate: moodFxMocks.pressMoodGate,
  pressMoodHarmonize: moodFxMocks.pressMoodHarmonize,
  releaseMoodBrake: moodFxMocks.releaseMoodBrake,
  releaseMoodGate: moodFxMocks.releaseMoodGate,
  releaseMoodHarmonize: moodFxMocks.releaseMoodHarmonize,
  resetMoodDropFilter: moodFxMocks.resetMoodDropFilter,
  scheduleMoodDropFilter: moodFxMocks.scheduleMoodDropFilter,
  triggerMoodEcho: moodFxMocks.triggerMoodEcho,
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
import { makeMoodTake } from "../test-utils/moodFixtures";

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
  const callback = toneHarness.transport.repeatCallbacks[0];
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
    moodFxMocks.resetMoodDropFilter.mockReset();
    moodFxMocks.scheduleMoodDropFilter.mockReset();
    moodFxMocks.initializeMoodFxForPerformance.mockReset();
    moodFxMocks.pressMoodBrake.mockClear();
    moodFxMocks.pressMoodGate.mockClear();
    moodFxMocks.pressMoodHarmonize.mockClear();
    moodFxMocks.releaseMoodBrake.mockClear();
    moodFxMocks.releaseMoodGate.mockClear();
    moodFxMocks.releaseMoodHarmonize.mockClear();
    moodFxMocks.triggerMoodEcho.mockClear();
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    toneHarness.transport.reset();
    toneHarness.draw.reset();
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    moodPlayersMocks.syncMoodPlayers.mockClear();

    toneHarness.setImmediate(10.5);
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
    expect(toneHarness.transport.repeatCallbacks).toHaveLength(0);
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
    toneHarness.setImmediate(10.5);

    armSelection("mic-0", "take-a");

    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBe("take-a");
    expect(videoForTake("take-a")).toBeInstanceOf(HTMLVideoElement);
  });

  it("freezes lens changes during export because the lens belongs to the piece", () => {
    createMoodWithStack(2);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    useAppStore.getState().actions.setIsExporting(true);
    toneHarness.setImmediate(10.5);

    armLens("splits");

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
  });

  it("applies a pre-armed lens commit during capture through the boundary drain", async () => {
    createMoodWithStack(2);
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.5);
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

    toneHarness.setImmediate(20);
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    moodPlayersMocks.syncMoodPlayers.mockClear();

    toneHarness.setImmediate(10.25);
    armSelection("mic-0", "take-a");
    toneHarness.setImmediate(10.5);
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.5);
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.25);
    armLens("splits");
    expect(useAppStore.getState().mood.performance.armedLens).toBe("splits");

    toneHarness.setImmediate(10.5);
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.5);
    armLens("splits");
    expect(useAppStore.getState().mood.performance.armedLens).toBe("splits");

    stopMoodPerformance();

    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();
  });

  it("starts the wardrobe on and commits the Drop on the next beat", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("mixtape");
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    expect(useAppStore.getState().mood.performance.dropActive).toBe(true);

    toneHarness.setImmediate(10.2);
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

  it("pins Drop automation to the exact boundary stored in the queue", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("mixtape");
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.2);
    armDrop();

    expect(moodFxMocks.scheduleMoodDropFilter).toHaveBeenCalledWith(false, 10.5, 0.5);
    const [commit] = consumeDueCommits(10.5);
    expect(commit).toEqual({ type: "drop", active: false, boundaryTime: 10.5 });
    expect(moodFxMocks.scheduleMoodDropFilter.mock.calls[0][1]).toBe(commit.boundaryTime);
  });

  it("re-arms and reschedules the Drop at the same pending beat", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.2);
    armDrop();
    toneHarness.setImmediate(10.3);
    armDrop();

    expect(moodFxMocks.scheduleMoodDropFilter.mock.calls).toEqual([
      [false, 10.5, 0.5],
      [true, 10.5, 0.5],
    ]);
    expect(consumeDueCommits(10.5)).toEqual([
      { type: "drop", active: true, boundaryTime: 10.5 },
    ]);
  });

  it("keeps the Drop live during export but blocked during capture", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    toneHarness.setImmediate(20);
    await startMoodPerformance();

    useAppStore.getState().actions.setIsExporting(true);
    toneHarness.setImmediate(20.2);
    armDrop();

    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);
    expect(moodFxMocks.scheduleMoodDropFilter).toHaveBeenCalledTimes(1);

    useAppStore.getState().actions.setIsExporting(false);
    applyDueCommits(20.5);
    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);

    useAppStore.getState().actions.setRecordingState("recording", 0);
    toneHarness.setImmediate(20.7);
    armDrop();

    expect(useAppStore.getState().mood.performance.armedDropActive).toBeNull();
    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);
    expect(moodFxMocks.scheduleMoodDropFilter).toHaveBeenCalledTimes(1);
  });

  it("keeps arms and the Drop live during a mood export while piece writers freeze", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("blocks");
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    useAppStore.getState().actions.setIsExporting(true);

    // Performance surface stays live — every arm, swap, and Drop is part
    // of the take (spec §9).
    toneHarness.setImmediate(10.2);
    armSelection("mic-0", "take-a");
    expect(useAppStore.getState().mood.performance.armed["mic-0"]).toBe("take-a");
    applyDueCommits(14);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    armDrop();
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);
    applyDueCommits(14.5);
    expect(useAppStore.getState().mood.performance.dropActive).toBe(false);

    // Piece writers stay frozen (invariant #4).
    useAppStore.getState().actions.setMoodVibe("print");
    expect(useAppStore.getState().mood.piece?.vibe).toBe("blocks");
    armLens("splits");
    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
    expect(useAppStore.getState().mood.performance.armedLens).toBeNull();

    useAppStore.getState().actions.setIsExporting(false);
  });

  it("applies a due selection even when the same mic re-arms before any drain", async () => {
    createMoodWithStack(4);
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.2);
    armSelection("mic-0", "take-a");

    // The cycle boundary (14) passes with NO paint drain, then the
    // performer re-arms the same mic. The due take-a swap must still land.
    toneHarness.setImmediate(14.1);
    armSelection("mic-0", "take-b");

    applyDueCommits(14.2);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    applyDueCommits(18);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-b");
  });

  it("clears a queued Drop when performance stops", async () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodVibe("print");
    toneHarness.setImmediate(30);
    await startMoodPerformance();

    toneHarness.setImmediate(30.2);
    armDrop();
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    moodFxMocks.resetMoodDropFilter.mockClear();
    stopMoodPerformance();

    expect(moodFxMocks.resetMoodDropFilter).toHaveBeenCalledTimes(1);
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();

    toneHarness.setImmediate(10.5);
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
    toneHarness.setImmediate(10);
    await startMoodPerformance();
    const { getByTestId } = render(createElement(KeyHarness, { withInput: true }));

    toneHarness.setImmediate(10.2);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }));
    expect(useAppStore.getState().mood.performance.armedDropActive).toBe(false);

    useAppStore.getState().actions.setMoodArmedDrop(null);
    getByTestId("mood-input").dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", bubbles: true }),
    );
    expect(useAppStore.getState().mood.performance.armedDropActive).toBeNull();
  });

  it("maps G/E/B/H to hold/tap pad edges, suppresses repeats, and releases keyboard holds", () => {
    createMoodWithStack(4);
    useAppStore.getState().actions.setMoodPerforming(true, 10);
    const { getByTestId } = render(createElement(KeyHarness, { withInput: true }));

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", bubbles: true }));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyG", bubbles: true, repeat: true }),
    );
    document.body.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyB", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", bubbles: true }));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyH", bubbles: true, repeat: true }),
    );
    window.dispatchEvent(new Event("blur"));

    expect(moodFxMocks.pressMoodGate).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.releaseMoodGate).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.triggerMoodEcho).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.pressMoodBrake).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.releaseMoodBrake).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.pressMoodHarmonize).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.releaseMoodHarmonize).toHaveBeenCalledTimes(1);

    getByTestId("mood-input").dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyE", bubbles: true }),
    );
    getByTestId("mood-input").dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyH", bubbles: true }),
    );
    expect(moodFxMocks.triggerMoodEcho).toHaveBeenCalledTimes(1);
    expect(moodFxMocks.pressMoodHarmonize).toHaveBeenCalledTimes(1);
  });
});
