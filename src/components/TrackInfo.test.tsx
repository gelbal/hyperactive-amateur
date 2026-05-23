// ABOUTME: TrackInfo tests — clip thumbnail re-record overlay is touch-reachable on coarse pointers.
// ABOUTME: The overlay is hover-only on desktop; on touch it must stay visible at reduced opacity.
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { TrackInfo } from "./TrackInfo";
import { useAppStore } from "../store/useAppStore";

describe("TrackInfo re-record overlay", () => {
  beforeEach(() => useAppStore.getState().actions.reset());

  it("on a filled track, the re-record button carries the any-pointer-coarse opacity classes", () => {
    useAppStore.getState().actions.setTrackClip(0, {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/clip-0",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob: null,
      posterUrl: null,
    });
    render(<TrackInfo trackId={0} />);
    const overlay = screen.getByLabelText("re-record");
    expect(overlay.className).toContain("any-pointer-coarse:opacity-40");
    expect(overlay.className).toContain("any-pointer-coarse:group-hover:opacity-100");
  });
});
