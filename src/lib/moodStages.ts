// ABOUTME: Pure Mood stage descriptors, cycle helpers, and empty piece factory.
// ABOUTME: Shared by store and clock code without importing React, Tone, or renderer modules.
import type { MoodPiece, MoodStageId, MoodTimeFeel } from "../types";

interface MoodStageDescriptor {
  captureAspect: { w: number; h: number };
  canvasSize: { w: number; h: number };
  maxMics: number;
  initialMics: number;
  linearAxis?: "x" | "y";
}

type MoodCycleBars = NonNullable<MoodPiece["cycleBars"]>;

export const MAX_TAKES_PER_MIC = 6;
export const MOOD_TAKE_HARD_CAP_SECONDS = 20;

// Canvas sizes use the fallback defaults until .claude/mood/spikes.md S2
// results upgrade the stage export targets.
export const STAGE_DESCRIPTORS: Record<MoodStageId, MoodStageDescriptor> = {
  corners: {
    captureAspect: { w: 1, h: 1 },
    canvasSize: { w: 480, h: 480 },
    maxMics: 4,
    initialMics: 4,
  },
  row: {
    captureAspect: { w: 9, h: 16 },
    canvasSize: { w: 854, h: 480 },
    maxMics: 5,
    initialMics: 2,
    linearAxis: "x",
  },
  stack: {
    captureAspect: { w: 16, h: 9 },
    canvasSize: { w: 480, h: 854 },
    maxMics: 5,
    initialMics: 2,
    linearAxis: "y",
  },
};

export function establishCycleFromTake(durationSeconds: number): number {
  return Math.min(Math.max(durationSeconds, 1), MOOD_TAKE_HARD_CAP_SECONDS);
}

export function establishCycleFromClick(bpm: number, bars: MoodCycleBars): number {
  return bars * 4 * (60 / bpm);
}

export function createEmptyMoodPiece(
  stage: MoodStageId,
  timeFeel: MoodTimeFeel,
  opts: { bpm?: number; cycleBars?: MoodCycleBars } = {},
): MoodPiece {
  const descriptor = STAGE_DESCRIPTORS[stage];
  const isClick = timeFeel === "click";

  return {
    moodSchemaVersion: 1,
    stage,
    timeFeel,
    bpm: isClick ? (opts.bpm ?? null) : null,
    cycleBars: isClick ? (opts.cycleBars ?? 2) : null,
    cycleSeconds: null,
    oneMicId: null,
    oneTakeId: null,
    vibe: "clean",
    lens: "wall",
    mics: Array.from({ length: descriptor.initialMics }, (_, index) => ({
      id: `mic-${index}`,
      takes: [],
    })),
    updatedAt: Date.now(),
  };
}
