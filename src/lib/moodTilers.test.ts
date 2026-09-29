// ABOUTME: moodTilers tests — exhaustively pins Mood stage tiling geometry.
// ABOUTME: Covers Wall, Splits, and Solo lenses with canvas-space integer rect invariants.

import { describe, expect, it } from "vitest";

import {
  cornersSplitsLayout,
  gridTiler,
  layoutFor,
  linearTiler,
  type MoodTilerMic,
  type TileRect,
} from "./moodTilers";
import { MOOD_LENS_IDS, type MoodStageId } from "../types";

type CanvasSize = { w: number; h: number };

const STAGE_CASES: Array<{
  stage: MoodStageId;
  canvas: CanvasSize;
  micCount: number;
}> = [
  { stage: "corners", canvas: { w: 480, h: 480 }, micCount: 4 },
  { stage: "row", canvas: { w: 854, h: 480 }, micCount: 5 },
  { stage: "stack", canvas: { w: 480, h: 854 }, micCount: 5 },
];

function micIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `mic-${index}`);
}

function makeMicStates(ids: string[], liveIds: Set<string>): MoodTilerMic[] {
  return ids.map((micId) => ({ micId, live: liveIds.has(micId) }));
}

function liveSubsets(ids: string[]): string[][] {
  return ids.reduce<string[][]>(
    (subsets, micId) => [...subsets, ...subsets.map((subset) => [...subset, micId])],
    [[]],
  );
}

function expectIntegerRect(rect: TileRect): void {
  expect(Number.isInteger(rect.x), `${rect.micId} x`).toBe(true);
  expect(Number.isInteger(rect.y), `${rect.micId} y`).toBe(true);
  expect(Number.isInteger(rect.w), `${rect.micId} w`).toBe(true);
  expect(Number.isInteger(rect.h), `${rect.micId} h`).toBe(true);
}

function expectInCanvas(rect: TileRect, canvas: CanvasSize): void {
  expect(rect.x, `${rect.micId} x`).toBeGreaterThanOrEqual(0);
  expect(rect.y, `${rect.micId} y`).toBeGreaterThanOrEqual(0);
  expect(rect.w, `${rect.micId} w`).toBeGreaterThan(0);
  expect(rect.h, `${rect.micId} h`).toBeGreaterThan(0);
  expect(rect.x + rect.w, `${rect.micId} right`).toBeLessThanOrEqual(canvas.w);
  expect(rect.y + rect.h, `${rect.micId} bottom`).toBeLessThanOrEqual(canvas.h);
}

function overlapArea(a: TileRect, b: TileRect): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function expectNoOverlap(rects: TileRect[]): void {
  for (let aIndex = 0; aIndex < rects.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < rects.length; bIndex += 1) {
      expect(overlapArea(rects[aIndex], rects[bIndex])).toBe(0);
    }
  }
}

function expectUnionCoversCanvas(rects: TileRect[], canvas: CanvasSize): void {
  if (rects.length === 0) {
    expect(rects).toEqual([]);
    return;
  }

  const totalArea = rects.reduce((area, rect) => area + rect.w * rect.h, 0);
  expect(totalArea).toBe(canvas.w * canvas.h);
}

function expectLayoutInvariants(rects: TileRect[], canvas: CanvasSize): void {
  for (const rect of rects) {
    expectIntegerRect(rect);
    expectInCanvas(rect, canvas);
  }
  expectNoOverlap(rects);
  expectUnionCoversCanvas(rects, canvas);
}

describe("gridTiler", () => {
  it("lays the Corners wall out as a row-major quad", () => {
    expect(gridTiler({ w: 480, h: 480 }, micIds(4))).toEqual([
      { micId: "mic-0", x: 0, y: 0, w: 240, h: 240 },
      { micId: "mic-1", x: 240, y: 0, w: 240, h: 240 },
      { micId: "mic-2", x: 0, y: 240, w: 240, h: 240 },
      { micId: "mic-3", x: 240, y: 240, w: 240, h: 240 },
    ]);
  });
});

describe("linearTiler", () => {
  it("pixel-snaps width remainders left-to-right", () => {
    expect(linearTiler({ w: 854, h: 480 }, ["mic-0", "mic-1", "mic-2"], "x")).toEqual([
      { micId: "mic-0", x: 0, y: 0, w: 285, h: 480 },
      { micId: "mic-1", x: 285, y: 0, w: 285, h: 480 },
      { micId: "mic-2", x: 570, y: 0, w: 284, h: 480 },
    ]);
  });

  it("pixel-snaps height remainders top-to-bottom", () => {
    expect(linearTiler({ w: 480, h: 854 }, ["mic-0", "mic-1", "mic-2"], "y")).toEqual([
      { micId: "mic-0", x: 0, y: 0, w: 480, h: 285 },
      { micId: "mic-1", x: 0, y: 285, w: 480, h: 285 },
      { micId: "mic-2", x: 0, y: 570, w: 480, h: 284 },
    ]);
  });
});

describe("cornersSplitsLayout", () => {
  it("uses the designed asymmetric three-live-mic split", () => {
    expect(cornersSplitsLayout({ w: 480, h: 480 }, ["mic-0", "mic-2", "mic-3"])).toEqual([
      { micId: "mic-0", x: 0, y: 0, w: 240, h: 480 },
      { micId: "mic-2", x: 240, y: 0, w: 240, h: 240 },
      { micId: "mic-3", x: 240, y: 240, w: 240, h: 240 },
    ]);
  });

  it("uses four full-height columns when all four mics are live", () => {
    expect(cornersSplitsLayout({ w: 480, h: 480 }, micIds(4))).toEqual([
      { micId: "mic-0", x: 0, y: 0, w: 120, h: 480 },
      { micId: "mic-1", x: 120, y: 0, w: 120, h: 480 },
      { micId: "mic-2", x: 240, y: 0, w: 120, h: 480 },
      { micId: "mic-3", x: 360, y: 0, w: 120, h: 480 },
    ]);
  });
});

describe("layoutFor", () => {
  it("pins anchored Row Splits layouts from two through five live mics", () => {
    const ids = micIds(5);
    const expected = [
      [
        { micId: "mic-0", x: 0, y: 0, w: 569, h: 480 },
        { micId: "mic-1", x: 569, y: 0, w: 285, h: 480 },
      ],
      [
        { micId: "mic-0", x: 0, y: 0, w: 427, h: 480 },
        { micId: "mic-1", x: 427, y: 0, w: 427, h: 240 },
        { micId: "mic-2", x: 427, y: 240, w: 427, h: 240 },
      ],
      [
        { micId: "mic-0", x: 0, y: 0, w: 427, h: 240 },
        { micId: "mic-1", x: 427, y: 0, w: 427, h: 240 },
        { micId: "mic-2", x: 0, y: 240, w: 427, h: 240 },
        { micId: "mic-3", x: 427, y: 240, w: 427, h: 240 },
      ],
      [
        { micId: "mic-0", x: 0, y: 0, w: 342, h: 480 },
        { micId: "mic-1", x: 342, y: 0, w: 256, h: 240 },
        { micId: "mic-2", x: 598, y: 0, w: 256, h: 240 },
        { micId: "mic-3", x: 342, y: 240, w: 256, h: 240 },
        { micId: "mic-4", x: 598, y: 240, w: 256, h: 240 },
      ],
    ];

    for (let liveCount = 2; liveCount <= 5; liveCount += 1) {
      const liveIds = new Set(ids.slice(0, liveCount));
      expect(layoutFor("row", "splits", makeMicStates(ids, liveIds))).toEqual(
        expected[liveCount - 2],
      );
    }
  });

  it("pins anchored Stack Splits layouts from two through five live mics", () => {
    const ids = micIds(5);
    const expected = [
      [
        { micId: "mic-0", x: 0, y: 0, w: 480, h: 569 },
        { micId: "mic-1", x: 0, y: 569, w: 480, h: 285 },
      ],
      [
        { micId: "mic-0", x: 0, y: 0, w: 480, h: 427 },
        { micId: "mic-1", x: 0, y: 427, w: 240, h: 427 },
        { micId: "mic-2", x: 240, y: 427, w: 240, h: 427 },
      ],
      [
        { micId: "mic-0", x: 0, y: 0, w: 240, h: 427 },
        { micId: "mic-1", x: 0, y: 427, w: 240, h: 427 },
        { micId: "mic-2", x: 240, y: 0, w: 240, h: 427 },
        { micId: "mic-3", x: 240, y: 427, w: 240, h: 427 },
      ],
      [
        { micId: "mic-0", x: 0, y: 0, w: 480, h: 342 },
        { micId: "mic-1", x: 0, y: 342, w: 240, h: 256 },
        { micId: "mic-2", x: 0, y: 598, w: 240, h: 256 },
        { micId: "mic-3", x: 240, y: 342, w: 240, h: 256 },
        { micId: "mic-4", x: 240, y: 598, w: 240, h: 256 },
      ],
    ];

    for (let liveCount = 2; liveCount <= 5; liveCount += 1) {
      const liveIds = new Set(ids.slice(0, liveCount));
      expect(layoutFor("stack", "splits", makeMicStates(ids, liveIds))).toEqual(
        expected[liveCount - 2],
      );
    }
  });

  it("keeps anchored and Solo mic ids in live mic order", () => {
    const ids = micIds(5);
    const mics = makeMicStates(ids, new Set(["mic-1", "mic-3", "mic-4"]));

    expect(layoutFor("row", "splits", mics).map((rect) => rect.micId)).toEqual([
      "mic-1",
      "mic-3",
      "mic-4",
    ]);
    expect(layoutFor("row", "solo", mics)).toEqual([
      { micId: "mic-1", x: 0, y: 0, w: 854, h: 480 },
    ]);

    mics[3].featured = true;
    expect(layoutFor("row", "solo", mics)).toEqual([
      { micId: "mic-3", x: 0, y: 0, w: 854, h: 480 },
    ]);
  });

  it("pins Solo full-bleed geometry for every stage and no-live state", () => {
    for (const { stage, canvas, micCount } of STAGE_CASES) {
      const ids = micIds(micCount);
      const mics = makeMicStates(ids, new Set([ids[1], ids[micCount - 1]]));

      expect(layoutFor(stage, "solo", mics)).toEqual([
        { micId: ids[1], x: 0, y: 0, w: canvas.w, h: canvas.h },
      ]);
      expect(layoutFor(stage, "solo", makeMicStates(ids, new Set()))).toEqual([]);
    }
  });

  it("covers every stage, lens, and live-set permutation without gaps or overlap", () => {
    for (const { stage, canvas, micCount } of STAGE_CASES) {
      const ids = micIds(micCount);
      for (const lens of MOOD_LENS_IDS) {
        for (const liveIds of liveSubsets(ids)) {
          const mics = makeMicStates(ids, new Set(liveIds));
          const rects = layoutFor(stage, lens, mics);
          const expectedIds =
            lens === "wall" ? ids : lens === "solo" ? liveIds.slice(0, 1) : liveIds;

          expect(rects.map((rect) => rect.micId), `${stage} ${lens} ${liveIds.join(",")}`).toEqual(
            expectedIds,
          );
          expectLayoutInvariants(rects, canvas);
        }
      }
    }
  });

  it("is stable for identical inputs", () => {
    const mics = makeMicStates(micIds(5), new Set(["mic-1", "mic-3", "mic-4"]));

    expect(layoutFor("row", "splits", mics)).toEqual(layoutFor("row", "splits", mics));
  });
});
