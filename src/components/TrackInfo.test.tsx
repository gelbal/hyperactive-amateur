// ABOUTME: TrackInfo tests — clip thumbnail re-record overlay is touch-reachable on coarse pointers.
// ABOUTME: The overlay is hover-only on desktop; on touch it must stay visible at reduced opacity.
import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { TrackInfo } from "./TrackInfo";
import { useAppStore } from "../store/useAppStore";

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

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

  it("shows the store recording error on the active track row until a new flow starts", () => {
    useAppStore.getState().actions.setMedia({
      stream: null,
      status: "granted",
      error: null,
    });
    useAppStore.getState().actions.dismissRecordingStation();
    render(<TrackInfo trackId={2} />);

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 2);
    });
    act(() => {
      useAppStore.getState().actions.setRecordingError(INTERRUPTION_COPY);
    });
    act(() => {
      useAppStore.getState().actions.setRecordingState("idle", null);
    });

    expect(screen.getByText(INTERRUPTION_COPY)).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setRecordingState("preparing", 2);
    });
    expect(screen.queryByText(INTERRUPTION_COPY)).not.toBeInTheDocument();
  });
});
