// ABOUTME: StepGrid integration tests — renders 8 TrackRows with their step cells.
// ABOUTME: Resets the store between tests so toggles don't leak across cases.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
    bpm: { value: 90 },
  })),
  getDraw: vi.fn(() => ({ schedule: vi.fn() })),
  getContext: vi.fn(() => ({ rawContext: {} })),
  MembraneSynth: vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    toDestination: vi.fn(function (this: object) {
      return this;
    }),
  })),
}));

import { StepGrid } from "./StepGrid";
import { useAppStore } from "../store/useAppStore";

describe("StepGrid", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders 128 step buttons (8 x 16)", () => {
    render(<StepGrid />);
    const buttons = screen.getAllByLabelText(/^track \d+ step \d+$/);
    expect(buttons).toHaveLength(128);
  });

  it("clicking a step button updates the store", () => {
    render(<StepGrid />);
    const button = screen.getByLabelText("track 1 step 1");
    fireEvent.click(button);
    expect(useAppStore.getState().project.tracks[0].steps[0]).toBe(true);
  });

  it("toggled cells get the active data attribute", () => {
    render(<StepGrid />);
    const button = screen.getByLabelText("track 3 step 5");
    expect(button).toHaveAttribute("data-active", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-active", "true");
  });

  it("track labels render T1 through T8", () => {
    render(<StepGrid />);
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`T${i}`)).toBeInTheDocument();
    }
  });

  it("highlights the current step column while playing", () => {
    useAppStore.setState((s) => ({
      playback: { ...s.playback, isPlaying: true, currentStep: 5 },
    }));
    render(<StepGrid />);
    for (let trackId = 0; trackId < 8; trackId++) {
      const cell = screen.getByLabelText(`track ${trackId + 1} step 6`);
      expect(cell).toHaveAttribute("data-current", "true");
    }
    const otherCell = screen.getByLabelText("track 1 step 1");
    expect(otherCell).toHaveAttribute("data-current", "false");
  });

  it("does not highlight when isPlaying is false", () => {
    useAppStore.setState((s) => ({
      playback: { ...s.playback, isPlaying: false, currentStep: 5 },
    }));
    render(<StepGrid />);
    const cell = screen.getByLabelText("track 1 step 6");
    expect(cell).toHaveAttribute("data-current", "false");
  });
});
