// ABOUTME: moodCommits tests — direct pins on the ONE paint-path drain seam.
// ABOUTME: Selections/lens/drop application, engine fan-out gating, period restarts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const moodTransportMocks = vi.hoisted(() => ({
  consumeDueCommits: vi.fn(),
}));

const moodPerformanceMocks = vi.hoisted(() => ({
  syncCommittedMoodEngines: vi.fn(),
}));

const moodVideoPoolMocks = vi.hoisted(() => ({
  restartVideosAtPeriodBoundary: vi.fn(),
}));

vi.mock("./moodTransport", () => ({
  consumeDueCommits: moodTransportMocks.consumeDueCommits,
}));

vi.mock("./moodPerformance", () => ({
  syncCommittedMoodEngines: moodPerformanceMocks.syncCommittedMoodEngines,
}));

vi.mock("./moodVideoPool", () => ({
  restartVideosAtPeriodBoundary: moodVideoPoolMocks.restartVideosAtPeriodBoundary,
}));

import { applyDueCommits } from "./moodCommits";
import { useAppStore } from "../store/useAppStore";
import type { MoodTake } from "../types";

function makeMoodTake(id: string): MoodTake {
  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: 2, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: 2000,
    durationSeconds: 2,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
  };
}

describe("moodCommits", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    moodTransportMocks.consumeDueCommits.mockReset();
    moodTransportMocks.consumeDueCommits.mockReturnValue([]);
    moodPerformanceMocks.syncCommittedMoodEngines.mockReset();
    moodVideoPoolMocks.restartVideosAtPeriodBoundary.mockReset();

    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("corners", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake("the-one"));
    actions.setMoodTake("mic-1", makeMoodTake("take-b"));
  });

  afterEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("applies drained selections once and fans out to the engines", () => {
    moodTransportMocks.consumeDueCommits.mockReturnValueOnce([
      { type: "selection", micId: "mic-1", entry: "take-b", boundaryTime: 4 },
    ]);

    applyDueCommits(4);

    expect(moodTransportMocks.consumeDueCommits).toHaveBeenCalledWith(4);
    expect(useAppStore.getState().mood.performance.selections["mic-1"]).toBe("take-b");
    expect(moodPerformanceMocks.syncCommittedMoodEngines).toHaveBeenCalledTimes(1);
  });

  it("applies lens and drop commits without engine churn", () => {
    useAppStore.getState().actions.setMoodArmedLens("splits");
    useAppStore.getState().actions.setMoodArmedDrop(true);
    moodTransportMocks.consumeDueCommits.mockReturnValueOnce([
      { type: "lens", lens: "splits", boundaryTime: 4 },
      { type: "drop", active: true, boundaryTime: 4 },
    ]);

    applyDueCommits(4);

    const state = useAppStore.getState();
    expect(state.mood.piece?.lens).toBe("splits");
    expect(state.mood.performance.armedLens).toBeNull();
    expect(state.mood.performance.dropActive).toBe(true);
    expect(state.mood.performance.armedDropActive).toBeNull();
    expect(moodPerformanceMocks.syncCommittedMoodEngines).not.toHaveBeenCalled();
  });

  it("restarts videos at period boundaries only for a running performance", () => {
    applyDueCommits(10);
    expect(moodVideoPoolMocks.restartVideosAtPeriodBoundary).not.toHaveBeenCalled();

    useAppStore.getState().actions.setMoodPerforming(true, 8);
    applyDueCommits(10);
    expect(moodVideoPoolMocks.restartVideosAtPeriodBoundary).toHaveBeenCalledWith(10, 8);

    // Before the epoch nothing has started looping yet.
    moodVideoPoolMocks.restartVideosAtPeriodBoundary.mockClear();
    applyDueCommits(7.5);
    expect(moodVideoPoolMocks.restartVideosAtPeriodBoundary).not.toHaveBeenCalled();
  });
});
