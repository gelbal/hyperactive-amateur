// ABOUTME: StackSheet tests — pins Mood take sheet layout, dismissal, and row arming.
// ABOUTME: Covers the coarse-pointer bottom sheet contract and disabled recording placeholder.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StackSheet } from "./StackSheet";
import { useAppStore } from "../../store/useAppStore";
import * as moodPerformance from "../../lib/moodPerformance";
import type { MoodMic, MoodTake } from "../../types";

vi.mock("../../lib/moodPerformance", () => ({
  armSelection: vi.fn(),
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

describe("StackSheet", () => {
  beforeEach(() => {
    vi.mocked(moodPerformance.armSelection).mockReset();
    vi.mocked(moodPerformance.armSelection).mockImplementation((micId, entry) => {
      useAppStore.getState().actions.commitMoodSelections([{ micId, entry }]);
    });
  });

  it("renders take rows, Off, and a disabled new-take row in the clamped sheet", () => {
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

    const newTake = screen.getByRole("button", { name: /⊕ new take/i });
    expect(newTake).toBeDisabled();
    expect(newTake).toHaveClass("min-h-11", "pointer-coarse:min-h-12");
    expect(screen.getByText("Recording is wired in G-phase.")).toBeInTheDocument();
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
});
