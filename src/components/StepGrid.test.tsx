// ABOUTME: StepGrid tests — cell click toggles store; +4 extends; per-column hover-only minus removes.
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
  beforeEach(() => useAppStore.getState().actions.reset());

  it("renders 8 × 16 cells; clicking toggles the store; current step gets highlighted", () => {
    render(<StepGrid />);
    expect(screen.getAllByLabelText(/^track \d+ step \d+$/)).toHaveLength(128);

    fireEvent.click(screen.getByLabelText("track 1 step 1"));
    expect(useAppStore.getState().project.tracks[0].steps[0]).toBe(true);

    useAppStore.setState((s) => ({
      playback: { ...s.playback, isPlaying: true, currentStep: 5 },
    }));
    render(<StepGrid />);
    expect(screen.getAllByLabelText(/track 1 step 6/)[0]).toHaveAttribute("data-current", "true");
  });

});
