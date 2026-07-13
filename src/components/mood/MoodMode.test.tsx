// ABOUTME: MoodMode tests — verifies the first lazy Mood shell and stage picker.
// ABOUTME: Covers piece birth, stage display, mic strip, and Mood performance controls.
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  decodeAudioData: vi.fn(),
}));

const moodTransportMocks = vi.hoisted(() => ({
  armMoodLensCommit: vi.fn(),
  armMoodSelectionCommit: vi.fn(),
  consumeDueCommits: vi.fn(() => []),
  startMoodPerformance: vi.fn(),
  stopMoodPerformance: vi.fn(),
}));

const moodRecordingMocks = vi.hoisted(() => ({
  countInBeatSeconds: vi.fn(() => 0.5),
  recordMoodTake: vi.fn(),
}));

const recordingInterruptMocks = vi.hoisted(() => ({
  interruptActiveRecording: vi.fn(),
}));

vi.mock("../../lib/audio", () => ({
  getAudioContext: () => ({
    decodeAudioData: audioMocks.decodeAudioData,
  }),
}));

vi.mock("../../lib/moodTransport", () => ({
  armMoodLensCommit: moodTransportMocks.armMoodLensCommit,
  armMoodSelectionCommit: moodTransportMocks.armMoodSelectionCommit,
  consumeDueCommits: moodTransportMocks.consumeDueCommits,
  startMoodPerformance: moodTransportMocks.startMoodPerformance,
  stopMoodPerformance: moodTransportMocks.stopMoodPerformance,
}));

vi.mock("../../lib/moodRecordingFlow", () => ({
  countInBeatSeconds: moodRecordingMocks.countInBeatSeconds,
  recordMoodTake: moodRecordingMocks.recordMoodTake,
}));

vi.mock("../../lib/recordingInterrupt", () => ({
  interruptActiveRecording: recordingInterruptMocks.interruptActiveRecording,
}));

vi.mock("../../lib/useMoodKeys", () => ({
  useMoodKeys: vi.fn(),
}));

import { MoodMode } from "./MoodMode";
import { createEmptyMoodPiece } from "../../lib/moodStages";
import { clearMoodPiece, saveMoodPiece } from "../../lib/moodPersistence";
import * as moodRehydrate from "../../lib/moodRehydrate";
import { useAppStore } from "../../store/useAppStore";
import type { MoodTake } from "../../types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function makeTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "saved-take";
  return {
    id,
    videoBlob: makeBlob([1, 2, 3], "video/webm"),
    audioBlob: makeBlob([4, 5, 6], "audio/wav"),
    posterBlob: makeBlob([7, 8, 9], "image/jpeg"),
    url: `blob:test/${id}`,
    audioBuffer: { duration: 1.5, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: `blob:test/${id}-poster`,
    trimStartMs: 0,
    trimEndMs: 1500,
    durationSeconds: 1.5,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

describe("MoodMode", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await clearMoodPiece();
    audioMocks.decodeAudioData.mockReset();
    audioMocks.decodeAudioData.mockResolvedValue({ duration: 1.5, sampleRate: 48000 } as AudioBuffer);
    moodTransportMocks.startMoodPerformance.mockReset();
    moodTransportMocks.startMoodPerformance.mockResolvedValue(undefined);
    moodTransportMocks.stopMoodPerformance.mockReset();
    moodTransportMocks.armMoodLensCommit.mockReset();
    moodTransportMocks.armMoodSelectionCommit.mockReset();
    moodTransportMocks.consumeDueCommits.mockReset();
    moodTransportMocks.consumeDueCommits.mockReturnValue([]);
    moodRecordingMocks.recordMoodTake.mockReset();
    moodRecordingMocks.recordMoodTake.mockResolvedValue(true);
    moodRecordingMocks.countInBeatSeconds.mockReturnValue(0.5);
    recordingInterruptMocks.interruptActiveRecording.mockReset();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setMoodHydration("ready");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      useAppStore.getState().actions.setIsExporting(false);
    });
  });

  it("hydrates lazily on the first cold Mood entry", async () => {
    const load = deferred<moodRehydrate.MoodRehydrateResult>();
    const rehydrate = vi
      .spyOn(moodRehydrate, "rehydrateMoodFromStorage")
      .mockReturnValue(load.promise);
    const decode = vi.spyOn(moodRehydrate, "decodeMoodTakes").mockResolvedValue({
      ok: true,
      degraded: false,
      piece: null,
      warnings: [],
    });
    useAppStore.getState().actions.setMoodHydration("cold");

    render(<MoodMode />);

    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.hydration).toBe("hydrating");
    expect(screen.getByText("Loading mood...")).toBeInTheDocument();

    await act(async () => {
      load.resolve({
        status: "empty",
        ok: false,
        degraded: false,
        piece: null,
        warnings: [],
      });
      await load.promise;
    });

    await waitFor(() => expect(useAppStore.getState().mood.hydration).toBe("ready"));
    expect(decode).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Corners/i })).toBeInTheDocument();
  });

  it("restores a saved Mood piece from storage on first entry", async () => {
    const piece = createEmptyMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
    const take = makeTake({ id: "saved-take" });
    await saveMoodPiece({
      ...piece,
      cycleSeconds: 4,
      oneMicId: "mic-0",
      oneTakeId: "saved-take",
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [take] } : mic,
      ),
      updatedAt: 5000,
    });
    useAppStore.getState().actions.setMoodHydration("cold");

    render(<MoodMode />);

    expect(screen.getByText("Loading mood...")).toBeInTheDocument();
    expect(await screen.findByText("Row stage")).toBeInTheDocument();
    expect(useAppStore.getState().mood.piece).toMatchObject({
      stage: "row",
      timeFeel: "click",
      oneTakeId: "saved-take",
    });
    expect(useAppStore.getState().mood.piece?.mics[0].takes[0]).toMatchObject({
      id: "saved-take",
      audioStatus: "ok",
    });
  });

  it("shows the stage and feel options while no mood exists", () => {
    render(<MoodMode />);

    expect(screen.getByRole("button", { name: /Corners/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Row/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stack/i })).toBeInTheDocument();
    expect(screen.getByText("Four square mics for tight framing.")).toBeInTheDocument();
    expect(
      screen.getByText("Two to five portrait mics in a wide row."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Two to five landscape mics in a vertical stack."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pocket/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("your first loop sets the length")).toBeInTheDocument();
    expect(screen.getByText("steady tempo you set")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /BPM/i })).not.toBeInTheDocument();
  });

  it("keeps mood controls enabled while idle", () => {
    render(<MoodMode />);

    expect(screen.getByRole("button", { name: /Corners/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Row/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Stack/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Pocket/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Click/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Click/i }));

    expect(screen.getByRole("slider", { name: "BPM 90" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "1 bar" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "2 bars" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "4 bars" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Corners/i }));

    expect(screen.getByRole("group", { name: "Mood mics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mic 1, off/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Scratch this mood" })).not.toBeDisabled();
  });

  it("disables stage picker controls while exporting", () => {
    const createMoodPiece = vi.spyOn(useAppStore.getState().actions, "createMoodPiece");
    render(<MoodMode />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Click/i }));
    });
    createMoodPiece.mockClear();

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    expect(screen.getByRole("button", { name: /Corners/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Row/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Stack/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Pocket/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Click/i })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "BPM 90" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1 bar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2 bars" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "4 bars" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Corners/i }));

    expect(createMoodPiece).not.toHaveBeenCalled();
    createMoodPiece.mockRestore();
  });

  it("reveals local Click controls only after Click is selected", () => {
    render(<MoodMode />);

    expect(screen.queryByRole("slider", { name: /BPM/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Click/i }));

    expect(screen.getByRole("button", { name: /Click/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("slider", { name: "BPM 90" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 bar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 bars" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "4 bars" })).toBeInTheDocument();
  });

  it("creates a Pocket mood piece and shows a read-only Pocket indicator", () => {
    render(<MoodMode />);

    fireEvent.click(screen.getByRole("button", { name: /Row/i }));

    const piece = useAppStore.getState().mood.piece;
    expect(piece?.stage).toBe("row");
    expect(piece?.timeFeel).toBe("pocket");
    expect(piece?.bpm).toBeNull();
    expect(piece?.cycleBars).toBeNull();
    expect(piece?.cycleSeconds).toBeNull();
    expect(screen.getByText("Row stage")).toBeInTheDocument();
    expect(screen.getByText("2 mics")).toBeInTheDocument();
    expect(screen.getByLabelText("Time feel")).toHaveTextContent("Pocket");
    expect(screen.queryByRole("button", { name: /Pocket/i })).not.toBeInTheDocument();
  });

  it("renders a single takeless invitation on the stage that records the One on mic 0", () => {
    render(<MoodMode />);

    fireEvent.click(screen.getByRole("button", { name: /Corners/i }));

    expect(screen.getByLabelText("Corners stage")).toBeInTheDocument();
    expect(screen.getByText("record the One")).toBeInTheDocument();
    expect(screen.getByText("your first loop sets the length")).toBeInTheDocument();
    expect(screen.getByLabelText("I've got headphones on")).not.toBeChecked();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "record the One" }));

    expect(moodRecordingMocks.recordMoodTake).toHaveBeenCalledWith("mic-0");
  });

  it("removes the One invitation once any take exists", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));

    render(<MoodMode />);

    expect(screen.queryByRole("button", { name: "record the One" })).not.toBeInTheDocument();
    expect(screen.queryByText("your first loop sets the length")).not.toBeInTheDocument();
  });

  it("surfaces mood recording errors with the shared recording alert pattern", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setRecordingError("camera failed");

    render(<MoodMode />);

    expect(screen.getByRole("alert")).toHaveTextContent("camera failed");
  });

  it("uses the shared Escape cancellation host while mood recording is active", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setRecordingState("countdown", null);

    render(<MoodMode />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(recordingInterruptMocks.interruptActiveRecording).toHaveBeenCalledWith("user");
  });

  it("disables Mood play until the One sets a cycle", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    render(<MoodMode />);

    const playButton = screen.getByRole("button", { name: "Start mood performance" });
    expect(playButton).toBeDisabled();
    expect(screen.getByText("record the One first")).toBeInTheDocument();

    fireEvent.click(playButton);

    expect(moodTransportMocks.startMoodPerformance).not.toHaveBeenCalled();
  });

  it("gate-blocks Mood start and stop while recording is active (FG-1)", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("row", "pocket");
      useAppStore.getState().actions.setMoodTake(
        "mic-0",
        makeTake({ id: "the-one", durationSeconds: 4, trimEndMs: 4000 }),
      );
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    render(<MoodMode />);

    const playButton = screen.getByRole("button", { name: "Start mood performance" });
    expect(playButton).toBeDisabled();

    fireEvent.click(playButton);

    expect(moodTransportMocks.startMoodPerformance).not.toHaveBeenCalled();

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 12);
    });

    const stopButton = screen.getByRole("button", { name: "Stop mood performance" });
    expect(stopButton).toBeDisabled();

    fireEvent.click(stopButton);

    expect(moodTransportMocks.stopMoodPerformance).not.toHaveBeenCalled();
  });

  it("shows the Mood performance controls with a ticking cycle count", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("row", "pocket");
      useAppStore.getState().actions.setMoodTake(
        "mic-0",
        makeTake({ id: "the-one", durationSeconds: 4, trimEndMs: 4000 }),
      );
    });
    render(<MoodMode />);

    expect(screen.getByLabelText("Mood cycle count")).toHaveTextContent("Cycle 0");
    fireEvent.click(screen.getByRole("button", { name: "Start mood performance" }));

    expect(moodTransportMocks.startMoodPerformance).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 12);
      useAppStore.getState().actions.setMoodCycleCount(3);
    });

    expect(screen.getByLabelText("Mood cycle count")).toHaveTextContent("Cycle 3");
    fireEvent.click(screen.getByRole("button", { name: "Stop mood performance" }));

    expect(moodTransportMocks.stopMoodPerformance).toHaveBeenCalledTimes(1);
  });

  it("toggles the Mood lens immediately while stopped", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    render(<MoodMode />);

    expect(screen.getByRole("group", { name: "Mood lens" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wall lens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Splits lens" }));

    expect(useAppStore.getState().mood.piece?.lens).toBe("splits");
    expect(screen.getByRole("button", { name: "Splits lens" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("disables the Mood lens toggle while exporting", () => {
    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake({ id: "the-one" }));
    });
    render(<MoodMode />);

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    const wall = screen.getByRole("button", { name: "Wall lens" });
    const splits = screen.getByRole("button", { name: "Splits lens" });
    expect(wall).toBeDisabled();
    expect(splits).toBeDisabled();

    fireEvent.click(splits);

    expect(useAppStore.getState().mood.piece?.lens).toBe("wall");
  });

  it("creates a Click mood piece with local bpm and bars", () => {
    render(<MoodMode />);

    fireEvent.click(screen.getByRole("button", { name: /Click/i }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "BPM 90" }), {
      key: "ArrowUp",
    });
    fireEvent.click(screen.getByRole("button", { name: "4 bars" }));

    expect(useAppStore.getState().project.bpm).toBe(90);

    fireEvent.click(screen.getByRole("button", { name: /Stack/i }));

    const piece = useAppStore.getState().mood.piece;
    expect(piece?.stage).toBe("stack");
    expect(piece?.timeFeel).toBe("click");
    expect(piece?.bpm).toBe(100);
    expect(piece?.cycleBars).toBe(4);
    expect(piece?.cycleSeconds).toBeNull();
    expect(screen.getByLabelText("Time feel")).toHaveTextContent("Click · 100 · 4 bars");
    expect(screen.queryByRole("button", { name: /Click/i })).not.toBeInTheDocument();
  });

  it("scratches the current mood through a two-step confirmation", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    render(<MoodMode />);

    const scratchButton = screen.getByRole("button", { name: "Scratch this mood" });
    expect(scratchButton).toHaveClass("pointer-coarse:min-h-11");

    fireEvent.click(scratchButton);

    const confirmButton = screen.getByRole("button", { name: "Yes, scratch it" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(confirmButton).toHaveClass("pointer-coarse:min-h-11");
    expect(cancelButton).toHaveClass("pointer-coarse:min-h-11");

    fireEvent.click(confirmButton);

    expect(useAppStore.getState().mood.piece).toBeNull();
  });

  it("disables scratch while exporting and keeps disabled clicks inert", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    const scratchMoodPiece = vi.spyOn(useAppStore.getState().actions, "scratchMoodPiece");
    render(<MoodMode />);

    fireEvent.click(screen.getByRole("button", { name: "Scratch this mood" }));

    act(() => {
      useAppStore.getState().actions.setIsExporting(true);
    });

    const confirmButton = screen.getByRole("button", { name: "Yes, scratch it" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);

    expect(scratchMoodPiece).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.piece).not.toBeNull();
    scratchMoodPiece.mockRestore();
  });

  it("disables scratch while performing", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodPerforming(true, 1);
    render(<MoodMode />);

    expect(screen.getByRole("group", { name: "Mood mics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scratch this mood" })).toBeDisabled();
  });
});
