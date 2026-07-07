// ABOUTME: moodTilers — pure canvas-space geometry for Mood Wall and Splits layouts.
// ABOUTME: Produces integer mic rectangles without React, Tone, store, canvas, or DPR dependencies.

import type { MoodLens, MoodStageId } from "../types";
import { STAGE_DESCRIPTORS } from "./moodStages";

export interface CanvasSize {
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
}

export type TilerAxis = "x" | "y";

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

function offsetFor(lengths: number[], index: number): number {
  return lengths.slice(0, index).reduce((total, length) => total + length, 0);
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
  if (liveMics.length === 2) {
    return linearTiler(canvas, liveMics, "x");
  }
  if (liveMics.length === 4) {
    return gridTiler(canvas, liveMics);
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

export function layoutFor(stage: MoodStageId, lens: MoodLens, mics: MoodTilerMic[]): TileRect[] {
  const canvas = stageCanvas(stage);
  const allMicIds = mics.map((mic) => mic.micId);
  const liveMicIds = mics.filter((mic) => mic.live).map((mic) => mic.micId);
  const micIds = lens === "wall" ? allMicIds : liveMicIds;

  if (stage === "corners") {
    return lens === "wall" ? gridTiler(canvas, micIds) : cornersSplitsLayout(canvas, micIds);
  }

  return linearTiler(canvas, micIds, stage === "row" ? "x" : "y");
}
