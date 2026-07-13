// ABOUTME: Exercises pure Mood clock math and boundary queue semantics.
// ABOUTME: Locks audio-clock boundary behavior before Tone transport wiring.
import { describe, expect, it } from "vitest";

import {
  allowedCaptureCapSeconds,
  createBoundaryQueue,
  cycleIndexAt,
  establishCycleFromClick,
  establishCycleFromTake,
  nextBeatBoundary,
  nextCycleBoundary,
  takeLoopPeriod,
} from "./moodClock";

describe("Mood cycle establishment", () => {
  it("clamps Pocket cycle lengths through the shared stage helper", () => {
    expect(establishCycleFromTake(0.5)).toBe(1);
    expect(establishCycleFromTake(7.25)).toBe(7.25);
    expect(establishCycleFromTake(25)).toBe(20);
  });

  it("computes Click cycle lengths from bpm and bars", () => {
    expect(establishCycleFromClick(120, 2)).toBe(4);
    expect(establishCycleFromClick(90, 4)).toBeCloseTo(10.6666666667);
  });
});

describe("Mood boundary math", () => {
  it("finds exact cycle boundaries and cycle indexes from the epoch", () => {
    const epoch = 2.5;
    const cycleSeconds = 1.25;

    expect(nextCycleBoundary(epoch, cycleSeconds, 1)).toBe(epoch);
    expect(cycleIndexAt(epoch, cycleSeconds, 1)).toBe(0);
    expect(nextCycleBoundary(epoch, cycleSeconds, epoch)).toBe(epoch);
    expect(cycleIndexAt(epoch, cycleSeconds, epoch)).toBe(0);
    expect(nextCycleBoundary(epoch, cycleSeconds, 3.749)).toBe(3.75);
    expect(cycleIndexAt(epoch, cycleSeconds, 3.749)).toBe(0);
    expect(nextCycleBoundary(epoch, cycleSeconds, 3.75)).toBe(3.75);
    expect(cycleIndexAt(epoch, cycleSeconds, 3.75)).toBe(1);
  });

  it("quantizes Drop boundaries to one eighth of the cycle", () => {
    const epoch = 10;
    const cycleSeconds = 4;

    expect(nextBeatBoundary(epoch, cycleSeconds, 10)).toBe(10);
    expect(nextBeatBoundary(epoch, cycleSeconds, 10.1)).toBe(10.5);
    expect(nextBeatBoundary(epoch, cycleSeconds, 10.5)).toBe(10.5);
    expect(nextBeatBoundary(epoch, cycleSeconds, 11.0001)).toBe(11.5);
  });

  it("does not accumulate drift across 1000 cycles", () => {
    const epoch = 0.125;
    const cycleSeconds = 0.3;

    for (let index = 0; index <= 1000; index += 1) {
      const boundary = epoch + index * cycleSeconds;

      expect(nextCycleBoundary(epoch, cycleSeconds, boundary)).toBe(boundary);
      expect(cycleIndexAt(epoch, cycleSeconds, boundary)).toBe(index);
      expect(nextCycleBoundary(epoch, cycleSeconds, boundary + cycleSeconds / 4)).toBeCloseTo(
        epoch + (index + 1) * cycleSeconds,
        12,
      );
    }
  });
});

describe("BoundaryQueue", () => {
  it("replaces mic arms and returns due events in boundary order", () => {
    const queue = createBoundaryQueue();

    queue.armSelection({ micId: "mic-a", entry: "take-1" }, 4, 0);
    queue.armSelection({ micId: "mic-b", entry: "take-2" }, 3, 0);
    queue.armSelection({ micId: "mic-a", entry: "off" }, 5, 0);
    queue.armLens("splits", 4, 0);
    queue.armDrop(true, 2, 0);

    expect(queue.dueAt(3.5)).toEqual([
      { type: "drop", active: true, boundaryTime: 2 },
      { type: "selection", micId: "mic-b", entry: "take-2", boundaryTime: 3 },
    ]);
    expect(queue.dueAt(4)).toEqual([{ type: "lens", lens: "splits", boundaryTime: 4 }]);
    expect(queue.dueAt(4.99)).toEqual([]);
    expect(queue.dueAt(5)).toEqual([
      { type: "selection", micId: "mic-a", entry: "off", boundaryTime: 5 },
    ]);
    expect(queue.dueAt(5)).toEqual([]);
  });

  it("replaces pending lens and Drop toggles independently", () => {
    const queue = createBoundaryQueue();

    queue.armLens("wall", 4, 0);
    queue.armLens("splits", 5, 0);
    queue.armDrop(false, 3, 0);
    queue.armDrop(true, 6, 0);

    expect(queue.dueAt(4.5)).toEqual([]);
    expect(queue.dueAt(6)).toEqual([
      { type: "lens", lens: "splits", boundaryTime: 5 },
      { type: "drop", active: true, boundaryTime: 6 },
    ]);
    expect(queue.dueAt(999)).toEqual([]);
  });

  it("never drains a ripe event before its boundary on the drain clock", () => {
    const queue = createBoundaryQueue();

    // Arm-time classification may run on the lookahead clock (Tone.now()
    // runs ~0.1s ahead of Tone.immediate()): a re-arm inside that sliver
    // marks the old event ripe while the audible clock is still short of
    // its boundary. The drain must hold it until audible time reaches it.
    queue.armDrop(false, 4, 3.5);
    queue.armDrop(true, 8, 4.02);

    expect(queue.dueAt(3.98)).toEqual([]);
    expect(queue.dueAt(4)).toEqual([{ type: "drop", active: false, boundaryTime: 4 }]);
    expect(queue.dueAt(8)).toEqual([{ type: "drop", active: true, boundaryTime: 8 }]);
  });

  it("preserves due-but-undrained events when the same slot re-arms", () => {
    const queue = createBoundaryQueue();

    // Arm before the boundary, let the boundary pass with no drain (a
    // stalled paint loop), then re-arm the same slot. The due event must
    // survive to the next drain — replacement may only cancel the future.
    queue.armSelection({ micId: "mic-a", entry: "take-1" }, 4, 3.5);
    queue.armSelection({ micId: "mic-a", entry: "take-2" }, 8, 4.5);
    queue.armLens("splits", 4, 3.5);
    queue.armLens("wall", 8, 4.5);
    queue.armDrop(false, 4, 3.5);
    queue.armDrop(true, 8, 4.5);

    expect(queue.dueAt(4.6)).toEqual([
      { type: "selection", micId: "mic-a", entry: "take-1", boundaryTime: 4 },
      { type: "lens", lens: "splits", boundaryTime: 4 },
      { type: "drop", active: false, boundaryTime: 4 },
    ]);
    expect(queue.dueAt(8)).toEqual([
      { type: "selection", micId: "mic-a", entry: "take-2", boundaryTime: 8 },
      { type: "lens", lens: "wall", boundaryTime: 8 },
      { type: "drop", active: true, boundaryTime: 8 },
    ]);
    expect(queue.dueAt(999)).toEqual([]);
  });
});

describe("Mood take timing caps", () => {
  it("derives take loop periods from cycle multiples", () => {
    expect(takeLoopPeriod(0.5, 8)).toBe(4);
    expect(takeLoopPeriod(1, 8)).toBe(8);
    expect(takeLoopPeriod(2, 8)).toBe(16);
    expect(takeLoopPeriod(4, 3)).toBe(12);
  });

  it("caps capture at four cycles, the hard cap, or the null-cycle fallback", () => {
    expect(allowedCaptureCapSeconds(null)).toBe(20);
    expect(allowedCaptureCapSeconds(2.25)).toBe(9);
    expect(allowedCaptureCapSeconds(5)).toBe(20);
    expect(allowedCaptureCapSeconds(8)).toBe(20);
  });
});
