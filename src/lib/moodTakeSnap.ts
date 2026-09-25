// ABOUTME: Pure Mood take snap policy for One capture and cycle-multiple loops.
// ABOUTME: Computes non-destructive durations and trim targets without store or engine imports.
import {
  MOOD_TAKE_CYCLE_MULTIPLES,
  type MoodTakeCycleMultiple,
} from "../types";
import { MOOD_ONE_MIN_SECONDS, MOOD_TAKE_HARD_CAP_SECONDS } from "./moodStages";

export type { MoodTakeCycleMultiple } from "../types";

type MoodTakeSnapResult =
  | {
      ok: true;
      isOne: true;
      durationSeconds: number;
    }
  | {
      ok: true;
      isOne: false;
      durationSeconds: number;
      cycleMultiple: MoodTakeCycleMultiple;
      trimTo?: number;
    }
  | {
      ok: false;
      reason: "too-short";
      minDurationSeconds: number;
    };

const MIN_CONTENT_SECONDS = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snapTake(
  contentSeconds: number,
  cycleSeconds: number | null,
): MoodTakeSnapResult {
  if (contentSeconds < MIN_CONTENT_SECONDS) {
    return {
      ok: false,
      reason: "too-short",
      minDurationSeconds: MIN_CONTENT_SECONDS,
    };
  }

  if (cycleSeconds === null) {
    return {
      ok: true,
      isOne: true,
      durationSeconds: clamp(
        contentSeconds,
        MOOD_ONE_MIN_SECONDS,
        MOOD_TAKE_HARD_CAP_SECONDS,
      ),
    };
  }

  const maxDurationSeconds = cycleSeconds * 4;

  if (contentSeconds > maxDurationSeconds) {
    return {
      ok: true,
      isOne: false,
      durationSeconds: maxDurationSeconds,
      cycleMultiple: 4,
      trimTo: maxDurationSeconds,
    };
  }

  const cycleMultiple =
    MOOD_TAKE_CYCLE_MULTIPLES.find(
      (multiple) => multiple * cycleSeconds >= contentSeconds,
    ) ?? 4;

  return {
    ok: true,
    isOne: false,
    durationSeconds: contentSeconds,
    cycleMultiple,
  };
}
