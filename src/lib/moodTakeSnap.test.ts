// ABOUTME: Exercises the pure Mood take snap policy around One creation and cycle multiples.
// ABOUTME: Keeps rests, trim caps, and too-short rejection deterministic before recording flow wiring.
import { describe, expect, it } from "vitest";

import { snapTake } from "./moodTakeSnap";

describe("snapTake", () => {
  it("clamps the One duration to the Pocket cycle bounds", () => {
    expect(snapTake(0.5, null)).toEqual({
      ok: true,
      isOne: true,
      durationSeconds: 1,
    });
    expect(snapTake(7.25, null)).toEqual({
      ok: true,
      isOne: true,
      durationSeconds: 7.25,
    });
    expect(snapTake(25, null)).toEqual({
      ok: true,
      isOne: true,
      durationSeconds: 20,
    });
  });

  it("selects each allowed cycle multiple at its boundary", () => {
    expect(snapTake(1, 2)).toEqual({
      ok: true,
      isOne: false,
      durationSeconds: 1,
      cycleMultiple: 0.5,
    });
    expect(snapTake(2, 2)).toEqual({
      ok: true,
      isOne: false,
      durationSeconds: 2,
      cycleMultiple: 1,
    });
    expect(snapTake(4, 2)).toEqual({
      ok: true,
      isOne: false,
      durationSeconds: 4,
      cycleMultiple: 2,
    });
    expect(snapTake(8, 2)).toEqual({
      ok: true,
      isOne: false,
      durationSeconds: 8,
      cycleMultiple: 4,
    });
  });

  it("keeps content duration when snapping leaves an intentional rest", () => {
    expect(snapTake(2.1, 2)).toEqual({
      ok: true,
      isOne: false,
      durationSeconds: 2.1,
      cycleMultiple: 2,
    });
  });

  it("trims content over four cycles and reports the trim target", () => {
    expect(snapTake(8.4, 2)).toEqual({
      ok: true,
      isOne: false,
      durationSeconds: 8,
      cycleMultiple: 4,
      trimTo: 8,
    });
  });

  it("rejects sub-quarter-second content without throwing", () => {
    expect(snapTake(0.249, null)).toEqual({
      ok: false,
      reason: "too-short",
      minDurationSeconds: 0.25,
    });
    expect(snapTake(0.249, 2)).toEqual({
      ok: false,
      reason: "too-short",
      minDurationSeconds: 0.25,
    });
  });
});
