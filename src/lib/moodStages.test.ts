// ABOUTME: moodStages tests — stage descriptor invariants and empty Mood piece factory behavior.
// ABOUTME: Locks the pure B1 Mood data helpers before store, clock, renderer, or React wiring exists.
import { describe, expect, it } from "vitest";
import {
  establishCycleFromClick,
  establishCycleFromTake,
  createEmptyMoodPiece,
  STAGE_DESCRIPTORS,
} from "./moodStages";

describe("STAGE_DESCRIPTORS", () => {
  it("defines positive geometry and mic limits for every stage", () => {
    expect(Object.keys(STAGE_DESCRIPTORS).sort()).toEqual(["corners", "row", "stack"]);

    for (const [stage, descriptor] of Object.entries(STAGE_DESCRIPTORS)) {
      expect(descriptor.captureAspect.w, `${stage} capture width`).toBeGreaterThan(0);
      expect(descriptor.captureAspect.h, `${stage} capture height`).toBeGreaterThan(0);
      expect(descriptor.canvasSize.w, `${stage} canvas width`).toBeGreaterThan(0);
      expect(descriptor.canvasSize.h, `${stage} canvas height`).toBeGreaterThan(0);
      expect(descriptor.initialMics, `${stage} initial mics`).toBeLessThanOrEqual(
        descriptor.maxMics,
      );
    }
  });

  it("declares a linear axis only for linear stages", () => {
    expect(STAGE_DESCRIPTORS.corners.linearAxis).toBeUndefined();
    expect(STAGE_DESCRIPTORS.row.linearAxis).toBe("x");
    expect(STAGE_DESCRIPTORS.stack.linearAxis).toBe("y");
  });
});

describe("createEmptyMoodPiece", () => {
  it("creates a pocket Corners piece with four empty mic stacks and no cycle", () => {
    const piece = createEmptyMoodPiece("corners", "pocket");

    expect(piece).toMatchObject({
      moodSchemaVersion: 1,
      stage: "corners",
      timeFeel: "pocket",
      bpm: null,
      cycleBars: null,
      cycleSeconds: null,
      oneMicId: null,
      oneTakeId: null,
      vibe: "clean",
      lens: "wall",
    });
    expect(piece.mics.map((mic) => mic.id)).toEqual(["mic-0", "mic-1", "mic-2", "mic-3"]);
    expect(piece.mics.every((mic) => mic.takes.length === 0)).toBe(true);
    expect(piece.updatedAt).toBeGreaterThan(0);
  });

  it("starts linear stages with two empty mic stacks", () => {
    expect(createEmptyMoodPiece("row", "pocket").mics.map((mic) => mic.id)).toEqual([
      "mic-0",
      "mic-1",
    ]);
    expect(createEmptyMoodPiece("stack", "pocket").mics.map((mic) => mic.id)).toEqual([
      "mic-0",
      "mic-1",
    ]);
  });

  it("stores click options and defaults bars to two", () => {
    expect(createEmptyMoodPiece("row", "click", { bpm: 132, cycleBars: 4 })).toMatchObject({
      timeFeel: "click",
      bpm: 132,
      cycleBars: 4,
      cycleSeconds: null,
    });
    expect(createEmptyMoodPiece("row", "click", { bpm: 120 })).toMatchObject({
      bpm: 120,
      cycleBars: 2,
    });
  });
});

describe("cycle establishment helpers", () => {
  it("clamps Pocket cycle length to the Mood take hard cap range", () => {
    expect(establishCycleFromTake(0.5)).toBe(1);
    expect(establishCycleFromTake(7.25)).toBe(7.25);
    expect(establishCycleFromTake(25)).toBe(20);
  });

  it("computes Click cycle length from bpm and bars", () => {
    expect(establishCycleFromClick(120, 2)).toBe(4);
    expect(establishCycleFromClick(90, 4)).toBeCloseTo(10.6666666667);
  });
});
