// ABOUTME: Pure Mood take snap policy for One capture and cycle-multiple loops.
// ABOUTME: Computes non-destructive durations and trim targets without store or engine imports.
export type MoodTakeCycleMultiple = 0.5 | 1 | 2 | 4;

export type MoodTakeSnapResult =
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
const MIN_ONE_SECONDS = 1;
const MAX_ONE_SECONDS = 20;
const CYCLE_MULTIPLES: readonly MoodTakeCycleMultiple[] = [0.5, 1, 2, 4];

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
      durationSeconds: clamp(contentSeconds, MIN_ONE_SECONDS, MAX_ONE_SECONDS),
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
    CYCLE_MULTIPLES.find((multiple) => multiple * cycleSeconds >= contentSeconds) ?? 4;

  return {
    ok: true,
    isOne: false,
    durationSeconds: contentSeconds,
    cycleMultiple,
  };
}
