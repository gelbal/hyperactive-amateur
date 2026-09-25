// ABOUTME: StackSheet tests — pins Mood take sheet layout, dismissal, and row arming.
// ABOUTME: Covers the coarse-pointer bottom sheet contract and disabled recording placeholder.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StackSheet } from "./StackSheet";
import { useAppStore } from "../../store/useAppStore";
import { MOOD_HEADPHONES_STORAGE_KEY } from "../../store/initialState";
import * as moodPerformance from "../../lib/moodPerformance";
import { MAX_TAKES_PER_MIC } from "../../lib/moodStages";
import type { MoodMic, MoodTake } from "../../types";

const moodRecordingMocks = vi.hoisted(() => ({
  recordMoodTake: vi.fn(),
}));

vi.mock("../../lib/moodPerformance", () => ({
  armSelection: vi.fn(),
}));

vi.mock("../../lib/moodRecordingFlow", () => ({
  recordMoodTake: moodRecordingMocks.recordMoodTake,
}));

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function makeTake(id: string, overrides: Partial<MoodTake> = {}): MoodTake {
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

function setupMood(): MoodMic {
  useAppStore.getState().actions.reset();
  useAppStore.getState().actions.setAppMode("mood");
  useAppStore.getState().actions.createMoodPiece("corners", "pocket");
  useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-a"));
  useAppStore.getState().actions.setMoodTake(
    "mic-0",
    makeTake("take-b", {
      durationSeconds: 2,
      trimEndMs: 2000,
      posterUrl: null,
      part: "lead",
      partSource: "ai",
    }),
  );
  return useAppStore.getState().mood.piece!.mics[0];
}

function setupMoodBeforeTheOne(): MoodMic {
  useAppStore.getState().actions.reset();
  useAppStore.getState().actions.setAppMode("mood");
  useAppStore.getState().actions.createMoodPiece("corners", "pocket");
  return useAppStore.getState().mood.piece!.mics[0];
}

describe("StackSheet", () => {
  beforeEach(() => {
    window.localStorage.removeItem(MOOD_HEADPHONES_STORAGE_KEY);
    useAppStore.getState().actions.reset();
    vi.mocked(moodPerformance.armSelection).mockReset();
    vi.mocked(moodPerformance.armSelection).mockImplementation((micId, entry) => {
      useAppStore.getState().actions.commitMoodSelections([{ micId, entry }]);
    });
    moodRecordingMocks.recordMoodTake.mockReset();
    moodRecordingMocks.recordMoodTake.mockResolvedValue(true);
  });

  afterEach(() => {
    act(() => {
      useAppStore.getState().actions.setIsExporting(false);
    });
  });

  it("renders take rows, Off, and an enabled overdub row in the clamped sheet", () => {
    const mic = setupMood();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const sheet = screen.getByRole("dialog", { name: "Mic 1 stack" });
    expect(sheet).toHaveClass(
      "absolute",
      "left-0",
      "top-full",
      "pointer-coarse:fixed",
      "pointer-coarse:inset-x-3",
      "pointer-coarse:bottom-3",
      "pointer-coarse:max-h-[min(70dvh,32rem)]",
    );

    const takeRow = screen.getByRole("button", { name: /Take 1 1\.5s No part yet/i });
    expect(takeRow).toHaveClass("min-h-11", "pointer-coarse:min-h-12");
    expect(screen.getByRole("button", { name: /Take 2 2\.0s Lead/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Off/i })).toHaveClass(
      "min-h-11",
      "pointer-coarse:min-h-12",
    );

    const newTake = screen.getByRole("button", {
      name: /new take/i,
    });
    expect(newTake).not.toBeDisabled();
    expect(newTake).toHaveClass("min-h-11", "pointer-coarse:min-h-12");
    expect(screen.getByText("new take")).toBeInTheDocument();
  });

  it("disables the new take row with a stack full reason when the mic stack is full", () => {
    const mic = setupMood();
    for (let i = mic.takes.length; i < MAX_TAKES_PER_MIC; i += 1) {
      useAppStore.getState().actions.setMoodTake("mic-0", makeTake(`take-${i}`));
    }
    const fullMic = useAppStore.getState().mood.piece!.mics[0];
    render(<StackSheet mic={fullMic} micNumber={1} open onClose={vi.fn()} />);

    const newTake = screen.getByRole("button", {
      name: /new take.*stack full/i,
    });
    expect(newTake).toBeDisabled();
    expect(screen.getByText("stack full")).toBeInTheDocument();
  });

  it("disables the new take row with an active recording reason", () => {
    const mic = setupMood();
    useAppStore.getState().actions.setRecordingState("countdown", null);
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const newTake = screen.getByRole("button", {
      name: /new take.*another recording active/i,
    });
    expect(newTake).toBeDisabled();
    expect(screen.getByText("another recording active")).toBeInTheDocument();
  });

  it("disables the new take row with an exporting reason", () => {
    const mic = setupMood();
    useAppStore.getState().actions.setIsExporting(true);
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const newTake = screen.getByRole("button", {
      name: /new take.*exporting/i,
    });
    expect(newTake).toBeDisabled();
    expect(screen.getAllByText("exporting").length).toBeGreaterThan(0);
  });

  it("keeps the no-cycle disabled row on record the One copy", () => {
    const mic = setupMoodBeforeTheOne();
    useAppStore.getState().actions.setRecordingState("countdown", null);
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const recordOne = screen.getByRole("button", {
      name: /record the One.*another recording active/i,
    });
    expect(recordOne).toBeDisabled();
    expect(screen.queryByText("new take")).not.toBeInTheDocument();
  });

  it("enables the add row to record the One before the piece has a cycle", () => {
    const mic = setupMoodBeforeTheOne();
    const onClose = vi.fn();
    render(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);

    const recordOne = screen.getByRole("button", { name: /record the One First take/i });
    expect(recordOne).not.toBeDisabled();

    fireEvent.click(recordOne);

    expect(moodRecordingMocks.recordMoodTake).toHaveBeenCalledWith("mic-0");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a functional headphone monitoring toggle beside the record affordance", () => {
    const mic = setupMoodBeforeTheOne();
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const toggle = screen.getByLabelText("I've got headphones on");

    expect(toggle).not.toBeChecked();
    expect(
      screen.getByText("no headphones: loops go silent while you record"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toBeChecked();
    expect(useAppStore.getState().mood.monitorWithHeadphones).toBe(true);
    expect(window.localStorage.getItem(MOOD_HEADPHONES_STORAGE_KEY)).toBe("1");

    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(useAppStore.getState().mood.monitorWithHeadphones).toBe(false);
    expect(window.localStorage.getItem(MOOD_HEADPHONES_STORAGE_KEY)).toBeNull();
  });

  it("dismisses through outside mousedown and Escape using the shared hook", () => {
    const mic = setupMood();
    const onClose = vi.fn();
    const { rerender } = render(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("arms selected rows through moodPerformance and closes the sheet", () => {
    const mic = setupMood();
    const onClose = vi.fn();
    const { rerender } = render(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Take 1 1\.5s No part yet/i }));

    expect(moodPerformance.armSelection).toHaveBeenCalledWith("mic-0", "take-a");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("take-a");

    onClose.mockClear();
    rerender(<StackSheet mic={mic} micNumber={1} open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^Off/i }));

    expect(moodPerformance.armSelection).toHaveBeenCalledWith("mic-0", "off");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
  });

  it("deletes a take through a two-step inline confirmation", () => {
    const mic = setupMood();
    const deleteMoodTake = vi.spyOn(useAppStore.getState().actions, "deleteMoodTake");
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove take 1" }));

    expect(screen.queryByRole("dialog", { name: /remove take/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm remove take 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm remove take 1" }));

    expect(deleteMoodTake).toHaveBeenCalledWith("mic-0", "take-a");
    deleteMoodTake.mockRestore();
  });

  it("allows deleting while performing except for the currently-live take", () => {
    setupMood();
    useAppStore.getState().actions.setMoodPerforming(true, 1);
    useAppStore.getState().actions.commitMoodSelections([{ micId: "mic-0", entry: "take-a" }]);
    const liveMic = useAppStore.getState().mood.piece!.mics[0];
    const deleteMoodTake = vi.spyOn(useAppStore.getState().actions, "deleteMoodTake");
    render(<StackSheet mic={liveMic} micNumber={1} open onClose={vi.fn()} />);

    const liveRemove = screen.getByRole("button", {
      name: "Remove take 1 disabled, live take",
    });
    expect(liveRemove).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove take 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove take 2" }));

    expect(deleteMoodTake).toHaveBeenCalledWith("mic-0", "take-b");
    deleteMoodTake.mockRestore();
  });

  it("disables delete affordances with recording reason while recording is active", () => {
    const mic = setupMood();
    useAppStore.getState().actions.setRecordingState("countdown", null);
    const deleteMoodTake = vi.spyOn(useAppStore.getState().actions, "deleteMoodTake");
    render(<StackSheet mic={mic} micNumber={1} open onClose={vi.fn()} />);

    const removeTakeOne = screen.getByRole("button", {
      name: "Remove take 1 disabled, recording",
    });
    const removeTakeTwo = screen.getByRole("button", {
      name: "Remove take 2 disabled, recording",
    });

    expect(removeTakeOne).toBeDisabled();
    expect(removeTakeTwo).toBeDisabled();
    expect(screen.getAllByText("recording")).toHaveLength(2);

    fireEvent.click(removeTakeOne);

    expect(screen.queryByRole("button", { name: "Confirm remove take 1" })).not.toBeInTheDocument();
    expect(deleteMoodTake).not.toHaveBeenCalled();
    deleteMoodTake.mockRestore();
  });
});
