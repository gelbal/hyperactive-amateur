// ABOUTME: Unit tests for shared Mood take and piece fixtures.
// ABOUTME: Pins complete take defaults, override precedence, and stage-valid piece construction.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyMoodPiece } from "../lib/moodStages";
import { makeMoodPiece, makeMoodTake } from "./moodFixtures";

describe("mood fixtures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a complete 16-field MoodTake with overrides winning", () => {
    const videoBlob = new Blob([new Uint8Array([2])], { type: "video/mp4" });
    const audioBuffer = { duration: 2.5, sampleRate: 44100 } as AudioBuffer;

    const take = makeMoodTake({
      id: "take-custom",
      videoBlob,
      url: "blob:test/override",
      audioBuffer,
      trimStartMs: 250,
      trimEndMs: 2750,
      durationSeconds: 2.5,
      cycleMultiple: 2,
      syncOffsetMs: -12,
      part: "harmony",
      partSource: "user",
      recordedAt: 42,
    });

    expect(Object.keys(take).sort()).toEqual(
      [
        "audioBlob",
        "audioBuffer",
        "audioStatus",
        "cycleMultiple",
        "durationSeconds",
        "id",
        "part",
        "partSource",
        "posterBlob",
        "posterUrl",
        "recordedAt",
        "syncOffsetMs",
        "trimEndMs",
        "trimStartMs",
        "url",
        "videoBlob",
      ].sort(),
    );
    expect(take).toEqual({
      id: "take-custom",
      videoBlob,
      audioBlob: null,
      posterBlob: null,
      url: "blob:test/override",
      audioBuffer,
      audioStatus: "ok",
      posterUrl: null,
      trimStartMs: 250,
      trimEndMs: 2750,
      durationSeconds: 2.5,
      cycleMultiple: 2,
      syncOffsetMs: -12,
      part: "harmony",
      partSource: "user",
      recordedAt: 42,
    });
  });

  it("makes a stage-valid MoodPiece from createEmptyMoodPiece defaults and overrides", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234);
    const defaults = createEmptyMoodPiece("row", "click", { bpm: 126, cycleBars: 4 });

    expect(
      makeMoodPiece({
        stage: "row",
        timeFeel: "click",
        bpm: 126,
        cycleBars: 4,
        vibe: "mixtape",
      }),
    ).toEqual({
      ...defaults,
      vibe: "mixtape",
    });
  });
});
