// ABOUTME: suggestTracks tests — the rows Suggest and the variations send: a track without a clip goes under its kit voice's tag.
// ABOUTME: Driven through the real store, so clearTrackClip's kept tag is covered.
import { beforeEach, describe, expect, it } from "vitest";
import { suggestTracks } from "./suggestTracks";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

describe("suggestTracks", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("sends a clip's own tag, and the kit voice's tag for a track without a clip, leaving the store untouched", () => {
    const actions = useAppStore.getState().actions;
    actions.setTrackClip(0, makeClip());
    actions.setTrackTag(0, "vocal");
    actions.setTrackClip(1, makeClip());
    actions.setTrackClip(2, makeClip());
    actions.setTrackTag(2, "fx");
    actions.clearTrackClip(2);

    const rows = suggestTracks(useAppStore.getState().project.tracks, { 0: "a breathy ah" });

    expect(rows[0]).toEqual({ id: 0, tag: "vocal", reasoning: "a breathy ah" });
    // A clip without a tag is still untagged.
    expect(rows[1]).toEqual({ id: 1, tag: null, reasoning: null });
    // Clearing kept "fx" in the store; the track plays the snare voice again.
    // Empty rows say what they are, so the model does not carry the groove
    // on drums that never cut the video.
    expect(rows[2]).toEqual({ id: 2, tag: "snare", reasoning: "built-in snare, no video" });
    expect(rows[4]).toEqual({ id: 4, tag: "kick", reasoning: "built-in kick 2, no video" });
    expect(rows).toHaveLength(8);
    expect(useAppStore.getState().project.tracks[2].tag).toBe("fx");
  });
});
