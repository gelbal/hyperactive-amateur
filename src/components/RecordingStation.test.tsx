// ABOUTME: RecordingStation test — target advance on skip, Record fires the flow, Done dismisses, full-track hides.
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const recordIntoTrack = vi.fn();
vi.mock("../lib/recordingFlow", () => ({
  recordIntoTrack: (...args: unknown[]) => recordIntoTrack(...args),
}));

import { RecordingStation } from "./RecordingStation";
import { TrackInfo } from "./TrackInfo";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

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
    posterUrl: null,  };
}

describe("RecordingStation", () => {
  beforeEach(() => {
    recordIntoTrack.mockReset();
    useAppStore.getState().actions.reset();
  });

  it("targets the lowest empty track, Skip advances, Record fires the flow, Done dismisses, full-kit hides the station", async () => {
    const actions = useAppStore.getState().actions;
    actions.setTrackClip(0, makeClip());
    actions.setTrackClip(1, makeClip());
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    expect(screen.getByText("Recording for Track 3")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByLabelText("Skip this track"));
    });
    expect(screen.getByText("Recording for Track 4")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByLabelText("Record clip for track 4"));
    });
    expect(recordIntoTrack).toHaveBeenCalledWith(3, expect.any(Object));

    act(() => {
      fireEvent.click(screen.getByLabelText("Done recording"));
    });
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
    cleanup();

    // The parent normally won't mount this with a full kit, but direct renders
    // still land in the no-target completion state.
    for (let i = 0; i < 8; i++) actions.setTrackClip(i, makeClip());
    actions.reopenRecordingStation();
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    expect(screen.getByText(/all empty tracks were skipped/i)).toBeInTheDocument();
  });

  it("offers a start-over path after every empty track is skipped", async () => {
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });

    for (let i = 0; i < 8; i += 1) {
      act(() => {
        fireEvent.click(screen.getByLabelText("Skip this track"));
      });
    }

    expect(screen.getByText(/all empty tracks were skipped/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /record first sound/i }));
      await Promise.resolve();
    });
    expect(screen.getByText("Recording for Track 1")).toBeInTheDocument();
  });

  it("dispatches camera flip and disables Flip while recording is not idle", async () => {
    const actions = useAppStore.getState().actions;
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });

    const flipButton = screen.getByRole("button", { name: "Switch camera" });
    expect(flipButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(flipButton);
      await Promise.resolve();
    });
    expect(useAppStore.getState().media.videoFacingMode).toBe("environment");

    for (const state of ["preparing", "countdown", "recording", "reviewing"] as const) {
      act(() => {
        actions.setRecordingState(state, 0);
      });
      expect(flipButton).toBeDisabled();
    }

    act(() => {
      actions.setRecordingState("idle", null);
    });
    expect(flipButton).not.toBeDisabled();
  });

  it("shows the store recording error while the station is open", async () => {
    useAppStore.getState().actions.setRecordingError(INTERRUPTION_COPY);

    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(INTERRUPTION_COPY);
  });

  it("shows the store recording error only in the station while the station is open", async () => {
    const actions = useAppStore.getState().actions;
    await act(async () => {
      render(
        <>
          <RecordingStation />
          <TrackInfo trackId={0} />
        </>,
      );
      await Promise.resolve();
    });
    act(() => {
      actions.setMedia({
        stream: null,
        status: "granted",
        error: null,
      });
    });
    act(() => {
      actions.setRecordingState("recording", 0);
    });
    act(() => {
      actions.setRecordingError(INTERRUPTION_COPY);
    });
    act(() => {
      actions.setRecordingState("idle", null);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(INTERRUPTION_COPY);
    expect(screen.getAllByText(INTERRUPTION_COPY)).toHaveLength(1);
  });
});
