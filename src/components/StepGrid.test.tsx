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

  it("step cells carry the pointer-coarse:!w-11 size override so coarse-pointer devices get 44px taps", () => {
    render(<StepGrid />);
    const cells = screen.getAllByLabelText(/^track \d+ step \d+$/);
    expect(cells.length).toBe(128);
    for (const cell of cells) {
      expect(cell.className).toContain("pointer-coarse:!w-11");
      expect(cell.className).toContain("pointer-coarse:!h-11");
    }
  });

  it("column-remove is visible at reduced opacity on coarse pointers via the any-pointer-coarse: variant", () => {
    // The default step count is 16, so canRemove is true and the buttons render.
    // We can't measure layout in jsdom, but the any-pointer-coarse:opacity-40
    // class is the contract — its presence is what makes the button tappable
    // on touch devices.
    render(<StepGrid />);
    const removeButtons = screen.getAllByLabelText(/^Remove step \d+$/);
    expect(removeButtons.length).toBeGreaterThan(0);
    for (const btn of removeButtons) {
      expect(btn.className).toContain("any-pointer-coarse:opacity-40");
      expect(btn.className).toContain("any-pointer-coarse:pointer-events-auto");
    }
  });

  it("scroll container has min-w-0 so it actually scrolls instead of overflowing the parent", () => {
    const { container } = render(<StepGrid />);
    // The scroll pane is the flex-1 child that wraps all the cells. min-w-0
    // is the critical fix — without it, flex items default to min-width: auto
    // and the pane expands to its content width instead of scrolling.
    const scrollPane = container.querySelector(".flex-1.overflow-x-auto");
    expect(scrollPane).not.toBeNull();
    expect(scrollPane?.className).toContain("min-w-0");
  });
});
