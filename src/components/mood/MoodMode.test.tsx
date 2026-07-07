// ABOUTME: MoodMode tests — verifies the first lazy Mood shell and stage picker.
// ABOUTME: Covers piece birth, placeholder stage display, and scratch confirmation.
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  decodeAudioData: vi.fn(),
}));

const moodTransportMocks = vi.hoisted(() => ({
  consumeDueCommits: vi.fn(() => []),
  startMoodPerformance: vi.fn(),
  stopMoodPerformance: vi.fn(),
}));

vi.mock("../../lib/audio", () => ({
  getAudioContext: () => ({
    decodeAudioData: audioMocks.decodeAudioData,
  }),
}));

vi.mock("../../lib/moodTransport", () => ({
  consumeDueCommits: moodTransportMocks.consumeDueCommits,
  startMoodPerformance: moodTransportMocks.startMoodPerformance,
  stopMoodPerformance: moodTransportMocks.stopMoodPerformance,
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
    moodTransportMocks.consumeDueCommits.mockReset();
    moodTransportMocks.consumeDueCommits.mockReturnValue([]);
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

  it("disables Mood play until the One sets a cycle", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    render(<MoodMode />);

    const playButton = screen.getByRole("button", { name: "Start mood performance" });
    expect(playButton).toBeDisabled();
    expect(screen.getByText("record the One first")).toBeInTheDocument();

    fireEvent.click(playButton);

    expect(moodTransportMocks.startMoodPerformance).not.toHaveBeenCalled();
  });

  it("gate-blocks Mood start while keeping stop available", () => {
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
    expect(stopButton).not.toBeDisabled();

    fireEvent.click(stopButton);

    expect(moodTransportMocks.stopMoodPerformance).toHaveBeenCalledTimes(1);
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

    fireEvent.click(screen.getByRole("button", { name: "Scratch this mood" }));
    expect(screen.getByText("This forgets this mood shell. Sure?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, scratch it" }));

    expect(useAppStore.getState().mood.piece).toBeNull();
    expect(screen.getByRole("button", { name: /Corners/i })).toBeInTheDocument();
  });

  it("disables scratch controls while exporting", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    const scratchMoodPiece = vi.spyOn(useAppStore.getState().actions, "scratchMoodPiece");
    useAppStore.getState().actions.setIsExporting(true);
    render(<MoodMode />);

    const scratchButton = screen.getByRole("button", { name: "Scratch this mood" });
    expect(scratchButton).toBeDisabled();

    fireEvent.click(scratchButton);

    expect(screen.queryByText("This forgets this mood shell. Sure?")).not.toBeInTheDocument();
    expect(scratchMoodPiece).not.toHaveBeenCalled();
    scratchMoodPiece.mockRestore();
  });

  it("disables scratch controls while performing", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodPerforming(true, 1);
    const scratchMoodPiece = vi.spyOn(useAppStore.getState().actions, "scratchMoodPiece");
    render(<MoodMode />);

    const scratchButton = screen.getByRole("button", { name: "Scratch this mood" });
    expect(scratchButton).toBeDisabled();

    fireEvent.click(scratchButton);

    expect(screen.queryByText("This forgets this mood shell. Sure?")).not.toBeInTheDocument();
    expect(scratchMoodPiece).not.toHaveBeenCalled();
    scratchMoodPiece.mockRestore();
  });
});
