// ABOUTME: Shared builders for complete Mood takes and stage-valid Mood pieces in tests.
// ABOUTME: Supplies stable defaults while letting individual suites override only relevant fields.
import { createEmptyMoodPiece } from "../lib/moodStages";
import type { MoodPiece, MoodTake } from "../types";

export function makeMoodTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "take-1";
  const durationSeconds = overrides.durationSeconds ?? overrides.audioBuffer?.duration ?? 2;

  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: durationSeconds, sampleRate: 48_000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: durationSeconds * 1_000,
    durationSeconds,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

export function makeMoodPiece(overrides: Partial<MoodPiece> = {}): MoodPiece {
  const stage = overrides.stage ?? "corners";
  const timeFeel = overrides.timeFeel ?? "pocket";
  const cycleBars = overrides.cycleBars;

  const defaults = createEmptyMoodPiece(stage, timeFeel, {
    ...(typeof overrides.bpm === "number" ? { bpm: overrides.bpm } : {}),
    ...(cycleBars === null || cycleBars === undefined ? {} : { cycleBars }),
  });

  return {
    ...defaults,
    ...overrides,
  };
}
