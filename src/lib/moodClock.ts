// ABOUTME: Pure Mood clock math for cycle boundaries, beat quantization, and take caps.
// ABOUTME: Provides a deterministic boundary queue without importing Tone, React, or store code.
import type { MoodLens, MoodSelectionCommit, MoodTake } from "../types";

import {
  establishCycleFromClick,
  establishCycleFromTake,
  MOOD_TAKE_HARD_CAP_SECONDS,
} from "./moodStages";

export { establishCycleFromClick, establishCycleFromTake };

const DROP_BEATS_PER_CYCLE = 8;
const BOUNDARY_EPSILON_SECONDS = 1e-9;

export type MoodCycleMultiple = MoodTake["cycleMultiple"];

export interface BoundarySelectionEvent extends MoodSelectionCommit {
  type: "selection";
  boundaryTime: number;
}

export interface BoundaryLensEvent {
  type: "lens";
  lens: MoodLens;
  boundaryTime: number;
}

export interface BoundaryDropEvent {
  type: "drop";
  active: boolean;
  boundaryTime: number;
}

export type BoundaryQueueEvent = BoundarySelectionEvent | BoundaryLensEvent | BoundaryDropEvent;

export interface BoundaryQueue {
  armSelection(commit: MoodSelectionCommit, boundaryTime: number): void;
  armLens(lens: MoodLens, boundaryTime: number): void;
  armDrop(active: boolean, boundaryTime: number): void;
  dueAt(now: number): BoundaryQueueEvent[];
}

const BOUNDARY_EVENT_ORDER: Record<BoundaryQueueEvent["type"], number> = {
  selection: 0,
  lens: 1,
  drop: 2,
};

function assertFiniteSeconds(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite audio-clock seconds`);
  }
}

function assertPositiveFiniteSeconds(label: string, value: number): void {
  assertFiniteSeconds(label, value);

  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
}

function boundaryIndexAtOrBefore(epoch: number, periodSeconds: number, now: number): number {
  assertFiniteSeconds("epoch", epoch);
  assertPositiveFiniteSeconds("periodSeconds", periodSeconds);
  assertFiniteSeconds("now", now);

  if (now <= epoch) {
    return 0;
  }

  const elapsed = now - epoch;
  const rawIndex = elapsed / periodSeconds;
  const nearestIndex = Math.round(rawIndex);

  if (Math.abs(rawIndex - nearestIndex) <= BOUNDARY_EPSILON_SECONDS) {
    return nearestIndex;
  }

  return Math.floor(rawIndex);
}

function nextBoundary(epoch: number, periodSeconds: number, now: number): number {
  const boundaryIndex = boundaryIndexAtOrBefore(epoch, periodSeconds, now);
  const boundary = epoch + boundaryIndex * periodSeconds;

  if (Math.abs(now - boundary) <= BOUNDARY_EPSILON_SECONDS || now <= epoch) {
    return boundary;
  }

  return epoch + (boundaryIndex + 1) * periodSeconds;
}

function compareBoundaryEvents(a: BoundaryQueueEvent, b: BoundaryQueueEvent): number {
  const timeOrder = a.boundaryTime - b.boundaryTime;

  if (timeOrder !== 0) {
    return timeOrder;
  }

  const typeOrder = BOUNDARY_EVENT_ORDER[a.type] - BOUNDARY_EVENT_ORDER[b.type];

  if (typeOrder !== 0) {
    return typeOrder;
  }

  const aMicId = a.type === "selection" ? a.micId : "";
  const bMicId = b.type === "selection" ? b.micId : "";

  return aMicId.localeCompare(bMicId);
}

export function nextCycleBoundary(epoch: number, cycleSeconds: number, now: number): number {
  return nextBoundary(epoch, cycleSeconds, now);
}

export function nextBeatBoundary(epoch: number, cycleSeconds: number, now: number): number {
  return nextBoundary(epoch, cycleSeconds / DROP_BEATS_PER_CYCLE, now);
}

export function cycleIndexAt(epoch: number, cycleSeconds: number, now: number): number {
  return boundaryIndexAtOrBefore(epoch, cycleSeconds, now);
}

export function createBoundaryQueue(): BoundaryQueue {
  const selections = new Map<string, BoundarySelectionEvent>();
  let lens: BoundaryLensEvent | null = null;
  let drop: BoundaryDropEvent | null = null;

  return {
    armSelection(commit, boundaryTime) {
      assertFiniteSeconds("boundaryTime", boundaryTime);
      selections.set(commit.micId, { type: "selection", ...commit, boundaryTime });
    },
    armLens(nextLens, boundaryTime) {
      assertFiniteSeconds("boundaryTime", boundaryTime);
      lens = { type: "lens", lens: nextLens, boundaryTime };
    },
    armDrop(active, boundaryTime) {
      assertFiniteSeconds("boundaryTime", boundaryTime);
      drop = { type: "drop", active, boundaryTime };
    },
    dueAt(now) {
      assertFiniteSeconds("now", now);

      const due: BoundaryQueueEvent[] = [];

      for (const [micId, event] of selections) {
        if (event.boundaryTime <= now) {
          due.push(event);
          selections.delete(micId);
        }
      }

      if (lens && lens.boundaryTime <= now) {
        due.push(lens);
        lens = null;
      }

      if (drop && drop.boundaryTime <= now) {
        due.push(drop);
        drop = null;
      }

      return due.sort(compareBoundaryEvents);
    },
  };
}

export function takeLoopPeriod(cycleMultiple: MoodCycleMultiple, cycleSeconds: number): number {
  assertPositiveFiniteSeconds("cycleSeconds", cycleSeconds);

  return cycleMultiple * cycleSeconds;
}

export function allowedCaptureCapSeconds(cycleSeconds: number | null): number {
  if (cycleSeconds === null) {
    return MOOD_TAKE_HARD_CAP_SECONDS;
  }

  assertPositiveFiniteSeconds("cycleSeconds", cycleSeconds);

  return Math.min(MOOD_TAKE_HARD_CAP_SECONDS, 4 * cycleSeconds);
}
