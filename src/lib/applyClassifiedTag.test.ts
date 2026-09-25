// ABOUTME: applyClassifiedTag tests — helper return value must match actual store mutation.
// ABOUTME: Covers export-time store guards so async taggers do not report false success.
import { beforeEach, describe, expect, it } from "vitest";
import { applyClassifiedTag } from "./applyClassifiedTag";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(url: string): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

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

  it("skips a late result for a clip that is no longer on the track (deleted or re-recorded)", () => {
    const actions = useAppStore.getState().actions;
    const classified = makeClip("blob:test/classified");
    actions.setTrackClip(0, classified);
    actions.deleteTrackClip(0);

    expect(applyClassifiedTag(0, "kick", "short low thump", classified)).toEqual({
      applied: false,
      hatAudioOnly: false,
    });
    expect(useAppStore.getState().project.tracks[0].tag).toBeNull();
    expect(useAppStore.getState().project.tagReasoning[0]).toBeUndefined();

    actions.setTrackClip(0, makeClip("blob:test/newer"));
    expect(applyClassifiedTag(0, "kick", "short low thump", classified).applied).toBe(false);
  });

  it("applies a result for the clip it classified", () => {
    const classified = makeClip("blob:test/classified");
    useAppStore.getState().actions.setTrackClip(0, classified);

    expect(applyClassifiedTag(0, "snare", "crack", classified).applied).toBe(true);
    expect(useAppStore.getState().project.tracks[0].tag).toBe("snare");
  });

  it("still applies after the poster frame attached to the same recording", () => {
    // setTrackPoster replaces the clip object but keeps the recording.
    const classified = makeClip("blob:test/classified");
    useAppStore.getState().actions.setTrackClip(0, classified);
    useAppStore.getState().actions.setTrackPoster(0, new Blob([new Uint8Array([9])], { type: "image/jpeg" }));
    expect(useAppStore.getState().project.tracks[0].clip).not.toBe(classified);

    expect(applyClassifiedTag(0, "hat", "tick", classified).applied).toBe(true);
  });
});
