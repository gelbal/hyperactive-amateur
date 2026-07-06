// ABOUTME: TrackInfo tests — clip thumbnail re-record overlay is touch-reachable on coarse pointers.
// ABOUTME: The overlay is hover-only on desktop; on touch it must stay visible at reduced opacity.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TrackInfo } from "./TrackInfo";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

const recordingFlowMocks = vi.hoisted(() => ({
  recordIntoTrack: vi.fn(),
}));

vi.mock("../lib/recordingFlow", () => ({
  recordIntoTrack: recordingFlowMocks.recordIntoTrack,
}));

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

function makeClip(audioStatus: Clip["audioStatus"] = "ok"): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: `blob:test/clip-${audioStatus}`,
    audioBuffer:
      audioStatus === "ok" ? ({ duration: 1, sampleRate: 48000 } as AudioBuffer) : null,
    audioStatus,
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

describe("TrackInfo re-record overlay", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    recordingFlowMocks.recordIntoTrack.mockReset();
  });

  it("on a filled track, the re-record button carries the any-pointer-coarse opacity classes", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    render(<TrackInfo trackId={0} />);
    const overlay = screen.getByLabelText("re-record");
    expect(overlay.className).toContain("any-pointer-coarse:opacity-40");
    expect(overlay.className).toContain("any-pointer-coarse:group-hover:opacity-100");
  });

  it("shows the unavailable-audio badge until re-record writes an ok clip", async () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip("unavailable"));
    recordingFlowMocks.recordIntoTrack.mockImplementation(async (trackId: number) => {
      useAppStore.getState().actions.setTrackClip(trackId, makeClip("ok"));
      return true;
    });

    render(<TrackInfo trackId={0} />);

    expect(screen.getByText("audio unavailable — re-record")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("re-record"));
    fireEvent.click(screen.getByLabelText("record clip for track 1"));

    await waitFor(() => {
      expect(useAppStore.getState().project.tracks[0].clip?.audioStatus).toBe("ok");
    });
    expect(screen.queryByText("audio unavailable — re-record")).not.toBeInTheDocument();
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
