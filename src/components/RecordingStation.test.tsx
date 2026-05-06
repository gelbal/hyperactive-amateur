// ABOUTME: RecordingStation tests — target advances on skip, dismiss closes the station, no station when full.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordIntoTrack = vi.fn();
vi.mock("../lib/recordingFlow", () => ({
  recordIntoTrack: (...args: unknown[]) => recordIntoTrack(...args),
}));

import { RecordingStation } from "./RecordingStation";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
  };
}

function fillClips(count: number) {
  const actions = useAppStore.getState().actions;
  for (let i = 0; i < count; i++) actions.setTrackClip(i, makeClip());
}

describe("RecordingStation", () => {
  beforeEach(() => {
    recordIntoTrack.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("renders with the lowest empty track as the initial target", () => {
    render(<RecordingStation size={480} />);
    expect(screen.getByText("Recording for Track 1")).toBeInTheDocument();
  });

  it("targets the next empty track after a clip exists for an earlier one", () => {
    fillClips(2);
    render(<RecordingStation size={480} />);
    expect(screen.getByText("Recording for Track 3")).toBeInTheDocument();
  });

  it("Record button calls recordIntoTrack with the current target", () => {
    render(<RecordingStation size={480} />);
    fireEvent.click(screen.getByLabelText("Record clip for track 1"));
    expect(recordIntoTrack).toHaveBeenCalledWith(0, expect.any(Object));
  });

  it("Skip advances target to the next empty track without recording", () => {
    render(<RecordingStation size={480} />);
    fireEvent.click(screen.getByLabelText("Skip this track"));
    expect(recordIntoTrack).not.toHaveBeenCalled();
    expect(screen.getByText("Recording for Track 2")).toBeInTheDocument();
  });

  it("Done dismisses the station via the store flag", () => {
    render(<RecordingStation size={480} />);
    fireEvent.click(screen.getByLabelText("Done recording"));
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
  });

  it("returns null when every track has a clip", () => {
    fillClips(8);
    const { container } = render(<RecordingStation size={480} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when every empty track has been skipped", () => {
    render(<RecordingStation size={480} />);
    // Skip all 8.
    for (let i = 0; i < 8; i++) {
      const skip = screen.queryByLabelText("Skip this track");
      if (!skip) break;
      act(() => {
        fireEvent.click(skip);
      });
    }
    expect(screen.queryByLabelText("Skip this track")).not.toBeInTheDocument();
  });

  it("disables controls while a recording is in progress", () => {
    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    render(<RecordingStation size={480} />);
    expect(screen.getByLabelText("Record clip for track 1")).toBeDisabled();
    expect(screen.getByLabelText("Skip this track")).toBeDisabled();
  });
});
