// ABOUTME: MoodMode tests — verifies the first lazy Mood shell and stage picker.
// ABOUTME: Covers piece birth, placeholder stage display, and scratch confirmation.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MoodMode } from "./MoodMode";
import { useAppStore } from "../../store/useAppStore";

describe("MoodMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      useAppStore.getState().actions.setIsExporting(false);
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
