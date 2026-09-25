// ABOUTME: moodTilers — pure canvas-space geometry for Mood Wall, Splits, and Solo layouts.
// ABOUTME: Produces integer mic rectangles without React, Tone, store, canvas, or DPR dependencies.

import type { MoodLens, MoodStageId } from "../types";
import { STAGE_DESCRIPTORS } from "./moodStages";

interface CanvasSize {
  w: number;
  h: number;
}

export interface TileRect {
  micId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MoodTilerMic {
  micId: string;
  live: boolean;
  featured?: boolean;
}

type TilerAxis = "x" | "y";

// Canvas sizes come from the stage descriptors (single source of truth); the
// S2 spike upgrades them there, and tilers follow automatically.
function stageCanvas(stage: MoodStageId): CanvasSize {
  return STAGE_DESCRIPTORS[stage].canvasSize;
}

function splitPixels(total: number, count: number): number[] {
  if (count === 0) return [];

  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function weightedSplitPixels(total: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let consumedPixels = 0;
  let consumedWeight = 0;

  return weights.map((weight, index) => {
    consumedWeight += weight;
    const boundary =
      index === weights.length - 1
        ? total
        : Math.round((total * consumedWeight) / totalWeight);
    const length = boundary - consumedPixels;
    consumedPixels = boundary;
    return length;
  });
}

function offsetFor(lengths: number[], index: number): number {
  return lengths.slice(0, index).reduce((total, length) => total + length, 0);
}

function orientedRect(
  axis: TilerAxis,
  micId: string,
  primaryStart: number,
  secondaryStart: number,
  primarySize: number,
  secondarySize: number,
): TileRect {
  return axis === "x"
    ? {
        micId,
        x: primaryStart,
        y: secondaryStart,
        w: primarySize,
        h: secondarySize,
      }
    : {
        micId,
        x: secondaryStart,
        y: primaryStart,
        w: secondarySize,
        h: primarySize,
      };
}

function orientedGrid(
  primaryLength: number,
  secondaryLength: number,
  mics: string[],
  axis: TilerAxis,
  primaryStart = 0,
  micOffset = 0,
): TileRect[] {
  const primarySizes = splitPixels(primaryLength, 2);
  const secondarySizes = splitPixels(secondaryLength, 2);

  return Array.from({ length: 4 }, (_, index) => {
    const primaryIndex = index % 2;
    const secondaryIndex = Math.floor(index / 2);
    return orientedRect(
      axis,
      mics[index + micOffset],
      primaryStart + offsetFor(primarySizes, primaryIndex),
      offsetFor(secondarySizes, secondaryIndex),
      primarySizes[primaryIndex],
      secondarySizes[secondaryIndex],
    );
  });
}

export function gridTiler(canvas: CanvasSize, mics: string[]): TileRect[] {
  if (mics.length !== 4) {
    throw new RangeError("gridTiler requires exactly four mics");
  }

  const widths = splitPixels(canvas.w, 2);
  const heights = splitPixels(canvas.h, 2);

  return mics.map((micId, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);

    return {
      micId,
      x: offsetFor(widths, column),
      y: offsetFor(heights, row),
      w: widths[column],
      h: heights[row],
    };
  });
}

export function linearTiler(canvas: CanvasSize, mics: string[], axis: TilerAxis): TileRect[] {
  const lengths = splitPixels(axis === "x" ? canvas.w : canvas.h, mics.length);

  return mics.map((micId, index) => {
    const offset = offsetFor(lengths, index);

    return axis === "x"
      ? { micId, x: offset, y: 0, w: lengths[index], h: canvas.h }
      : { micId, x: 0, y: offset, w: canvas.w, h: lengths[index] };
  });
}

export function cornersSplitsLayout(canvas: CanvasSize, liveMics: string[]): TileRect[] {
  if (liveMics.length === 0) return [];
  if (liveMics.length === 1) {
    return [{ micId: liveMics[0], x: 0, y: 0, w: canvas.w, h: canvas.h }];
  }
  if (liveMics.length === 2 || liveMics.length === 4) {
    return linearTiler(canvas, liveMics, "x");
  }
  if (liveMics.length !== 3) {
    throw new RangeError("cornersSplitsLayout supports at most four live mics");
  }

  const widths = splitPixels(canvas.w, 2);
  const heights = splitPixels(canvas.h, 2);
  const rightX = widths[0];

  return [
    { micId: liveMics[0], x: 0, y: 0, w: widths[0], h: canvas.h },
    { micId: liveMics[1], x: rightX, y: 0, w: widths[1], h: heights[0] },
    { micId: liveMics[2], x: rightX, y: heights[0], w: widths[1], h: heights[1] },
  ];
}

function anchoredSplitsLayout(
  canvas: CanvasSize,
  liveMics: string[],
  axis: TilerAxis,
): TileRect[] {
  if (liveMics.length === 0) return [];
  if (liveMics.length === 1) {
    return [{ micId: liveMics[0], x: 0, y: 0, w: canvas.w, h: canvas.h }];
  }
  if (liveMics.length > 5) {
    throw new RangeError("anchoredSplitsLayout supports at most five live mics");
  }

  const primaryLength = axis === "x" ? canvas.w : canvas.h;
  const secondaryLength = axis === "x" ? canvas.h : canvas.w;

  if (liveMics.length === 4) {
    return orientedGrid(primaryLength, secondaryLength, liveMics, axis);
  }

  if (liveMics.length === 2) {
    const [anchorSize, wingSize] = weightedSplitPixels(primaryLength, [2, 1]);
    return [
      orientedRect(axis, liveMics[0], 0, 0, anchorSize, secondaryLength),
      orientedRect(axis, liveMics[1], anchorSize, 0, wingSize, secondaryLength),
    ];
  }

  if (liveMics.length === 3) {
    const [anchorSize, wingSize] = weightedSplitPixels(primaryLength, [1, 1]);
    const [firstWingSize, secondWingSize] = weightedSplitPixels(secondaryLength, [1, 1]);
    return [
      orientedRect(axis, liveMics[0], 0, 0, anchorSize, secondaryLength),
      orientedRect(axis, liveMics[1], anchorSize, 0, wingSize, firstWingSize),
      orientedRect(
        axis,
        liveMics[2],
        anchorSize,
        firstWingSize,
        wingSize,
        secondWingSize,
      ),
    ];
  }

  const [anchorSize, wingSize] = weightedSplitPixels(primaryLength, [2, 3]);
  return [
    orientedRect(axis, liveMics[0], 0, 0, anchorSize, secondaryLength),
    ...orientedGrid(wingSize, secondaryLength, liveMics, axis, anchorSize, 1),
  ];
}

export function layoutFor(stage: MoodStageId, lens: MoodLens, mics: MoodTilerMic[]): TileRect[] {
  const canvas = stageCanvas(stage);

  if (lens === "solo") {
    const featuredMic =
      mics.find((mic) => mic.live && mic.featured) ?? mics.find((mic) => mic.live);
    return featuredMic
      ? [{ micId: featuredMic.micId, x: 0, y: 0, w: canvas.w, h: canvas.h }]
      : [];
  }

  const allMicIds = mics.map((mic) => mic.micId);
  const liveMicIds = mics.filter((mic) => mic.live).map((mic) => mic.micId);

  if (stage === "corners") {
    return lens === "wall"
      ? gridTiler(canvas, allMicIds)
      : cornersSplitsLayout(canvas, liveMicIds);
  }

  return lens === "wall"
    ? linearTiler(canvas, allMicIds, stage === "row" ? "x" : "y")
    : anchoredSplitsLayout(canvas, liveMicIds, stage === "row" ? "x" : "y");
}
