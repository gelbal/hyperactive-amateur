// ABOUTME: DropPad tests — pin the Drop's gated pad behavior and pending beat state.
// ABOUTME: Exercises the Mood performance tap policy for pointer control rendering.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DropPad } from "./DropPad";
import { useAppStore } from "../../store/useAppStore";

const moodPerformanceMocks = vi.hoisted(() => ({
  armDrop: vi.fn(),
}));

vi.mock("../../lib/moodPerformance", () => ({
  armDrop: moodPerformanceMocks.armDrop,
}));

describe("DropPad", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    moodPerformanceMocks.armDrop.mockReset();
  });

  it("shows the vibe name and fires the Drop while performing", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    useAppStore.getState().actions.setMoodVibe("mixtape");
    useAppStore.getState().actions.setMoodPerforming(true, 4);

    render(<DropPad vibe="mixtape" />);

    const pad = screen.getByRole("button", { name: "Drop Mixtape" });
    expect(pad).toHaveTextContent("Mixtape");
    expect(pad).not.toBeDisabled();
    expect(pad).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pad);

    expect(moodPerformanceMocks.armDrop).toHaveBeenCalledTimes(1);
  });

  it("marks the Drop armed until the beat commit lands", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    useAppStore.getState().actions.setMoodVibe("blocks");
    useAppStore.getState().actions.setMoodPerforming(true, 4);
    useAppStore.getState().actions.setMoodArmedDrop(false);

    render(<DropPad vibe="blocks" />);

    const pad = screen.getByRole("button", { name: "Drop Blocks" });
    expect(pad).toHaveAttribute("data-armed", "true");
    expect(pad).toHaveAttribute("title", "Blocks Drop armed for next beat");
  });

  it("disables with plain reasons when clean, stopped, or capturing", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    const { rerender } = render(<DropPad vibe="clean" />);

    let pad = screen.getByRole("button", { name: "Drop Clean" });
    expect(pad).toBeDisabled();
    expect(pad).toHaveAttribute("title", "Clean has no Drop");

    act(() => {
      useAppStore.getState().actions.setMoodVibe("print");
    });
    rerender(<DropPad vibe="print" />);
    pad = screen.getByRole("button", { name: "Drop Print" });
    expect(pad).toBeDisabled();
    expect(pad).toHaveAttribute("title", "Start performance to use the Drop");

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 4);
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    rerender(<DropPad vibe="print" />);
    pad = screen.getByRole("button", { name: "Drop Print" });
    expect(pad).toBeDisabled();
    expect(pad).toHaveAttribute("title", "The Drop is locked during capture");
  });
});
