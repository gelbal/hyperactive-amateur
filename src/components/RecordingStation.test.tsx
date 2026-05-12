// ABOUTME: RecordingStation test — target advance on skip, Record fires the flow, Done dismisses, full-track hides.
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

describe("RecordingStation", () => {
  beforeEach(() => {
    recordIntoTrack.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("targets the lowest empty track, Skip advances, Record fires the flow, Done dismisses, full-kit hides the station", () => {
    const actions = useAppStore.getState().actions;
    actions.setTrackClip(0, makeClip());
    actions.setTrackClip(1, makeClip());
    render(<RecordingStation size={480} />);
    expect(screen.getByText("Recording for Track 3")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Skip this track"));
    expect(screen.getByText("Recording for Track 4")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Record clip for track 4"));
    expect(recordIntoTrack).toHaveBeenCalledWith(3, expect.any(Object));

    fireEvent.click(screen.getByLabelText("Done recording"));
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
    cleanup();

    // Once every track has a clip, the station renders nothing.
    for (let i = 0; i < 8; i++) actions.setTrackClip(i, makeClip());
    actions.reopenRecordingStation();
    const { container } = render(<RecordingStation size={480} />);
    expect(container.firstChild).toBeNull();
  });
});
