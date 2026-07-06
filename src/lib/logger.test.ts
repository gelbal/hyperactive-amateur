// ABOUTME: Logger contract tests for shared event-name constants.
// ABOUTME: Ensures later lifecycle code uses centralized typed event names.
import { describe, expect, it } from "vitest";
import { LOG_EVENTS } from "./logger";

describe("LOG_EVENTS", () => {
  it("exports audio lifecycle and durability event names", () => {
    expect(Object.values(LOG_EVENTS)).toEqual(
      expect.arrayContaining([
        "audio.session-error",
        "audio.interrupted",
        "audio.resume-required",
        "recording.interrupted",
        "video.draw-error",
        "autosave.flush",
      ]),
    );
  });
});
