// ABOUTME: applyClassifiedTag tests — helper return value must match actual store mutation.
// ABOUTME: Covers export-time store guards so async taggers do not report false success.
import { beforeEach, describe, expect, it } from "vitest";
import { applyClassifiedTag } from "./applyClassifiedTag";
import { useAppStore } from "../store/useAppStore";

describe("applyClassifiedTag", () => {
  beforeEach(() => {
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
  });

  it("applies a system tag and reasoning when the project is mutable", () => {
    const result = applyClassifiedTag(0, "kick", "short low thump");

    expect(result).toEqual({ applied: true, hatAudioOnly: false });
    expect(useAppStore.getState().project.tracks[0].tag).toBe("kick");
    expect(useAppStore.getState().project.tagReasoning[0]).toBe("short low thump");
  });

  it("reports not-applied while export freezes project mutations", () => {
    useAppStore.getState().actions.setIsExporting(true);

    const result = applyClassifiedTag(0, "kick", "short low thump");

    expect(result).toEqual({ applied: false, hatAudioOnly: false });
    expect(useAppStore.getState().project.tracks[0].tag).toBeNull();
    expect(useAppStore.getState().project.tagReasoning[0]).toBeUndefined();
  });
});
