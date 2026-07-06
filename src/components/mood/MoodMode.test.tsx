// ABOUTME: MoodMode tests — verifies the first lazy Mood shell and stage picker.
// ABOUTME: Covers piece birth, placeholder stage display, and scratch confirmation.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MoodMode } from "./MoodMode";
import { useAppStore } from "../../store/useAppStore";

describe("MoodMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.reset();
  });

  it("shows the three stage options while no mood exists", () => {
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
  });

  it("creates a Pocket mood piece and shows the placeholder stage shell", () => {
    render(<MoodMode />);

    fireEvent.click(screen.getByRole("button", { name: /Row/i }));

    expect(useAppStore.getState().mood.piece?.stage).toBe("row");
    expect(useAppStore.getState().mood.piece?.timeFeel).toBe("pocket");
    expect(screen.getByText("Row stage")).toBeInTheDocument();
    expect(screen.getByText("2 mics")).toBeInTheDocument();
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
});
