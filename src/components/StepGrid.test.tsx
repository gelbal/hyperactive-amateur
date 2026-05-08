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

  describe("variable loop length", () => {
    it("clicking the +4 extend button adds four step columns", () => {
      render(<StepGrid />);
      const left = screen.getAllByLabelText("Add 4 more steps")[0];
      fireEvent.click(left);
      const buttons = screen.getAllByLabelText(/^track \d+ step \d+$/);
      expect(buttons).toHaveLength(8 * 20);
      expect(useAppStore.getState().project.stepCount).toBe(20);
    });

    it("renders two extend buttons (one left of T1, one after the last column)", () => {
      render(<StepGrid />);
      const extends_ = screen.getAllByLabelText("Add 4 more steps");
      expect(extends_).toHaveLength(2);
    });

    it("hovering a column reveals its remove button which removes that column", () => {
      render(<StepGrid />);
      // Toggle step 5 on track 0 so we can see the column shift left after removal.
      fireEvent.click(screen.getByLabelText("track 1 step 6"));
      expect(useAppStore.getState().project.tracks[0].steps[5]).toBe(true);
      // Hover the cell at column index 2 (step 3) so its header minus shows.
      fireEvent.mouseEnter(screen.getByLabelText("track 1 step 3"));
      const remove = screen.getByLabelText("Remove step 3");
      expect(remove).not.toBeDisabled();
      fireEvent.click(remove);
      // stepCount drops to 15, and the previously-step-6 toggle has shifted left to step 5.
      expect(useAppStore.getState().project.stepCount).toBe(15);
      expect(useAppStore.getState().project.tracks[0].steps[4]).toBe(true);
    });

    it("disables the remove buttons once stepCount equals MIN_STEP_COUNT (4)", () => {
      // Squeeze stepCount down to 4 by removing 12 columns.
      const actions = useAppStore.getState().actions;
      for (let i = 0; i < 12; i++) actions.removeStepColumn(0);
      expect(useAppStore.getState().project.stepCount).toBe(4);
      render(<StepGrid />);
      // All remove buttons should now be disabled.
      const remove = screen.getByLabelText("Remove step 1");
      expect(remove).toBeDisabled();
    });
  });
});
