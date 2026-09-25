// ABOUTME: TrackInfo tests — an empty track's sound button cycles and auditions; a clip's thumbnail opens Re-record / Delete.
// ABOUTME: Also covers the unavailable-audio badge, auto-tag copy, tag-picker sizing and recording-error placement.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TrackInfo } from "./TrackInfo";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

const recordingFlowMocks = vi.hoisted(() => ({
  recordIntoTrack: vi.fn(),
}));

vi.mock("../lib/recordingFlow", () => ({
  recordIntoTrack: recordingFlowMocks.recordIntoTrack,
}));

const audioMocks = vi.hoisted(() => ({ triggerTrackNow: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/audio", () => ({ triggerTrackNow: audioMocks.triggerTrackNow }));

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";
const OFFLINE_COPY = "AI needs an internet connection.";

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

  it("on a filled track, the thumbnail's actions hint carries the any-pointer-coarse opacity classes", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    render(<TrackInfo trackId={0} />);
    const thumb = screen.getByRole("button", { name: "clip actions for track 1" });
    const hint = thumb.querySelector("[data-clip-actions-hint]") as HTMLElement;
    expect(hint.getAttribute("class")).toContain("any-pointer-coarse:opacity-40");
    expect(hint.getAttribute("class")).toContain("any-pointer-coarse:group-hover:opacity-100");
  });

  it("shows the unavailable-audio badge until re-record writes an ok clip", async () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip("unavailable"));
    recordingFlowMocks.recordIntoTrack.mockImplementation(async (trackId: number) => {
      useAppStore.getState().actions.setTrackClip(trackId, makeClip("ok"));
      return true;
    });

    render(<TrackInfo trackId={0} />);

    expect(screen.getByText("audio unavailable — re-record")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "clip actions for track 1" }));
    fireEvent.click(screen.getByRole("button", { name: "re-record track 1" }));
    fireEvent.click(screen.getByLabelText("record clip for track 1"));

    await waitFor(() => {
      expect(useAppStore.getState().project.tracks[0].clip?.audioStatus).toBe("ok");
    });
    expect(screen.queryByText("audio unavailable — re-record")).not.toBeInTheDocument();
  });

  it("shows pinned offline copy when auto-tagging cannot reach AI", async () => {
    recordingFlowMocks.recordIntoTrack.mockImplementation(
      async (
        _trackId: number,
        options?: { onAutoTag?: (event: { kind: "offline" }) => void },
      ) => {
        options?.onAutoTag?.({ kind: "offline" });
        return true;
      },
    );

    render(<TrackInfo trackId={0} />);
    fireEvent.click(screen.getByLabelText("record clip for track 1"));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(OFFLINE_COPY));
  });

  it("keeps the tag picker inside the 48px track row on coarse pointers", () => {
    // The coarse-pointer chip inflation (py-1.5 over three 2-column rows)
    // overflowed the h-12 row and the chips of adjacent tracks overlapped.
    // Chips stay compact on every pointer type; no coarse override may
    // reintroduce vertical growth or a wider fixed left panel.
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    render(<TrackInfo trackId={0} />);
    const picker = screen.getByRole("group", { name: "tags for track 1" });
    expect(picker.className).toContain("w-24");
    expect(picker.className).not.toContain("pointer-coarse:");
    for (const chip of screen.getAllByRole("button", { name: /^tag \w+ for track 1$/ })) {
      expect(chip.className).toContain("py-0.5");
      expect(chip.className).not.toContain("pointer-coarse:py");
    }
  });

  it("shows a lingering recording error on the track row while playback hides the station", () => {
    // Viewport unmounts the recording station while playing; TrackInfo must
    // not keep deferring to a station that is not actually on screen.
    useAppStore.getState().actions.setMedia({
      stream: null,
      status: "granted",
      error: null,
    });
    render(<TrackInfo trackId={0} />);

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    act(() => {
      useAppStore.getState().actions.setRecordingError("Recording interrupted — test copy.");
    });
    act(() => {
      useAppStore.getState().actions.setRecordingState("idle", null);
    });

    // The station is on screen (granted + empty tracks + not dismissed), so
    // the row defers to it.
    expect(screen.queryByText("Recording interrupted — test copy.")).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(true);
    });
    expect(screen.getByText("Recording interrupted — test copy.")).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(false);
    });
    expect(screen.queryByText("Recording interrupted — test copy.")).not.toBeInTheDocument();
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

describe("TrackInfo sound button", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    audioMocks.triggerTrackNow.mockClear();
  });

  afterEach(() => {
    cleanup();
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("an empty track shows its sound as a button; a tap moves to the next sound and plays it", () => {
    render(<TrackInfo trackId={3} />);
    const button = screen.getByRole("button", { name: "Change sound for track 4, now open hat" });
    expect(button).toHaveTextContent("open hat");

    fireEvent.click(button);

    expect(useAppStore.getState().project.tracks[3].voice).toBe("shaker");
    expect(audioMocks.triggerTrackNow).toHaveBeenCalledWith(3);
    expect(screen.getByRole("button", { name: "Change sound for track 4, now shaker" })).toHaveTextContent("shaker");
    // Screen readers hear the change even when nothing sounds (playing).
    expect(screen.getByText("track 4 sound: shaker")).toHaveAttribute("aria-live", "polite");
  });

  it("quick taps each move one sound on", () => {
    render(<TrackInfo trackId={3} />);
    const button = screen.getByRole("button", { name: /^Change sound for track 4/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(useAppStore.getState().project.tracks[3].voice).toBe("ride");
  });

  it("is frozen while exporting", () => {
    act(() => useAppStore.getState().actions.setIsExporting(true));
    render(<TrackInfo trackId={3} />);
    expect(screen.getByRole("button", { name: /^Change sound for track 4/ })).toBeDisabled();
  });

  it("a recorded track shows its tag in orange instead; deleting the clip brings the sound button back", () => {
    const actions = useAppStore.getState().actions;
    render(<TrackInfo trackId={3} />);
    act(() => {
      actions.setTrackClip(3, makeClip());
      actions.setTrackTag(3, "fx");
    });
    // The tag chip renders lower-case "fx" (upper-cased by CSS), so "FX"
    // matches only the label.
    expect(screen.getByText("FX")).toHaveClass("text-orange-400");
    expect(screen.queryByRole("button", { name: /^Change sound/ })).not.toBeInTheDocument();

    act(() => actions.deleteTrackClip(3));
    expect(screen.getByRole("button", { name: "Change sound for track 4, now open hat" })).toBeInTheDocument();
    expect(screen.queryByText("FX")).not.toBeInTheDocument();
  });
});

describe("TrackInfo clip actions", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderWithClip(): void {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    render(<TrackInfo trackId={0} />);
  }

  it("a tap on the thumbnail swaps the tag chips for Re-record and Delete", () => {
    renderWithClip();
    const thumb = screen.getByRole("button", { name: "clip actions for track 1" });
    expect(thumb).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(thumb);

    expect(thumb).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("group", { name: "tags for track 1" })).not.toBeInTheDocument();
    // Full-height targets in the 48 px row.
    expect(screen.getByRole("button", { name: "re-record track 1" })).toHaveClass("h-11");
    expect(screen.getByRole("button", { name: "delete clip on track 1" })).toHaveClass("h-11");
  });

  it("Delete empties the track for its sound and does not open the recording station", () => {
    renderWithClip();
    act(() => useAppStore.getState().actions.dismissRecordingStation());
    fireEvent.click(screen.getByRole("button", { name: "clip actions for track 1" }));
    fireEvent.click(screen.getByRole("button", { name: "delete clip on track 1" }));

    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
    expect(screen.getByRole("button", { name: "Change sound for track 1, now kick" })).toBeInTheDocument();
  });

  it("Re-record clears the clip and reopens the recording station, as before", () => {
    renderWithClip();
    act(() => useAppStore.getState().actions.dismissRecordingStation());
    fireEvent.click(screen.getByRole("button", { name: "clip actions for track 1" }));
    fireEvent.click(screen.getByRole("button", { name: "re-record track 1" }));

    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(false);
  });

  it("stays open while focus is on Re-record or Delete; after Delete, focus lands on the track's sound", () => {
    vi.useFakeTimers();
    renderWithClip();
    fireEvent.click(screen.getByRole("button", { name: "clip actions for track 1" }));
    const del = screen.getByRole("button", { name: "delete clip on track 1" });
    act(() => del.focus());
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole("button", { name: "delete clip on track 1" })).toBe(del);

    fireEvent.click(del);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Change sound for track 1/ }));
  });

  it("when playback starts with focus on the actions, focus returns to the thumbnail", () => {
    renderWithClip();
    const thumb = screen.getByRole("button", { name: "clip actions for track 1" });
    fireEvent.click(thumb);
    act(() => screen.getByRole("button", { name: "re-record track 1" }).focus());

    act(() => useAppStore.getState().actions.setIsPlaying(true));

    expect(screen.queryByRole("button", { name: "re-record track 1" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(thumb);
  });

  it("the thumbnail is frozen while exporting", () => {
    renderWithClip();
    act(() => useAppStore.getState().actions.setIsExporting(true));
    expect(screen.getByRole("button", { name: "clip actions for track 1" })).toBeDisabled();
    act(() => useAppStore.getState().actions.setIsExporting(false));
  });

  it("stays open when the poster frame lands on the same recording", () => {
    renderWithClip();
    fireEvent.click(screen.getByRole("button", { name: "clip actions for track 1" }));

    act(() => useAppStore.getState().actions.setTrackPoster(0, new Blob([new Uint8Array([9])], { type: "image/jpeg" })));

    expect(screen.getByRole("button", { name: "delete clip on track 1" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "tags for track 1" })).not.toBeInTheDocument();
  });

  it("clears a pending \"tagging…\" when the clip is deleted", async () => {
    recordingFlowMocks.recordIntoTrack.mockImplementation(
      async (trackId: number, options?: { onAutoTag?: (event: { kind: "tagging" }) => void }) => {
        useAppStore.getState().actions.setTrackClip(trackId, makeClip());
        options?.onAutoTag?.({ kind: "tagging" });
        return true;
      },
    );
    render(<TrackInfo trackId={0} />);
    fireEvent.click(screen.getByLabelText("record clip for track 1"));
    await waitFor(() => expect(screen.getByText("tagging…")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "clip actions for track 1" }));
    fireEvent.click(screen.getByRole("button", { name: "delete clip on track 1" }));

    expect(screen.queryByText("tagging…")).not.toBeInTheDocument();
  });

  it("closes on a second tap, after 5 seconds, and when playback starts", () => {
    vi.useFakeTimers();
    renderWithClip();
    const thumb = screen.getByRole("button", { name: "clip actions for track 1" });

    fireEvent.click(thumb);
    fireEvent.click(thumb);
    expect(screen.getByRole("group", { name: "tags for track 1" })).toBeInTheDocument();

    fireEvent.click(thumb);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("group", { name: "tags for track 1" })).toBeInTheDocument();

    fireEvent.click(thumb);
    act(() => useAppStore.getState().actions.setIsPlaying(true));
    expect(screen.getByRole("group", { name: "tags for track 1" })).toBeInTheDocument();
  });
});
