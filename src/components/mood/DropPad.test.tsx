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

  it("shows the four truthful subtitle states", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    const { rerender } = render(<DropPad vibe="clean" />);

    let pad = screen.getByRole("button", { name: "Drop Clean" });
    expect(pad).toHaveTextContent("DROP");
    expect(pad).toHaveTextContent("press Play");

    act(() => {
      useAppStore.getState().actions.setMoodVibe("mixtape");
    });
    rerender(<DropPad vibe="mixtape" />);
    pad = screen.getByRole("button", { name: "Drop Mixtape" });
    expect(pad).toHaveTextContent("press Play");

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 4);
      useAppStore.getState().actions.setMoodDrop(false);
    });
    expect(pad).toHaveTextContent("mixtape · D");
    expect(pad).toHaveAttribute("aria-label", "Drop Mixtape");
    expect(pad).toHaveAttribute("title", "Mixtape Drop");

    act(() => {
      useAppStore.getState().actions.setMoodArmedDrop(true);
    });
    expect(pad).toHaveTextContent("on the beat");
  });

  it("tells a performing Clean pad to pick a punchable vibe", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    useAppStore.getState().actions.setMoodPerforming(true, 4);

    render(<DropPad vibe="clean" />);

    const pad = screen.getByRole("button", { name: "Drop Clean" });
    expect(pad).toBeDisabled();
    expect(pad).toHaveTextContent("pick a vibe to punch");
  });

  it("uses the chunky pad styling and fires the Drop while performing", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    useAppStore.getState().actions.setMoodVibe("mixtape");
    useAppStore.getState().actions.setMoodPerforming(true, 4);

    render(<DropPad vibe="mixtape" />);

    const pad = screen.getByRole("button", { name: "Drop Mixtape" });
    expect(pad).toHaveClass("h-14", "min-w-28", "rounded", "border-2");
    expect(pad).toHaveClass("border-orange-500", "bg-orange-500", "text-zinc-950");
    expect(pad).toHaveClass("pointer-coarse:min-h-12");
    expect(pad).not.toBeDisabled();
    expect(pad).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pad);

    expect(moodPerformanceMocks.armDrop).toHaveBeenCalledTimes(1);
  });

  it("marks the Drop armed until the beat commit lands", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    useAppStore.getState().actions.setMoodVibe("blocks");
    useAppStore.getState().actions.setMoodPerforming(true, 4);
    useAppStore.getState().actions.setMoodDrop(false);
    useAppStore.getState().actions.setMoodArmedDrop(true);

    render(<DropPad vibe="blocks" />);

    const pad = screen.getByRole("button", { name: "Drop Blocks" });
    expect(pad).toHaveAttribute("data-armed", "true");
    expect(pad).toHaveAttribute("title", "Blocks Drop armed for next beat");
    expect(pad).toHaveClass("animate-pulse", "ring-2");
    expect(pad).toHaveClass("border-zinc-700", "bg-zinc-900");
  });

  it("disables with plain reasons when clean, stopped, or capturing", () => {
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    const { rerender } = render(<DropPad vibe="clean" />);

    let pad = screen.getByRole("button", { name: "Drop Clean" });
    expect(pad).toBeDisabled();
    expect(pad).toHaveAttribute("title", "Clean has no Drop");
    expect(pad).toHaveAttribute("aria-label", "Drop Clean");

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
