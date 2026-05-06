// ABOUTME: PadGrid tests — pad count, click → triggerTrack, flash data-attr after triggerSeq bump.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const triggerTrack = vi.fn();
vi.mock("../lib/audio", () => ({
  triggerTrack: (...args: unknown[]) => triggerTrack(...args),
  nowSeconds: () => 1.234,
}));

import { PadGrid } from "./PadGrid";
import { useAppStore } from "../store/useAppStore";

describe("PadGrid", () => {
  beforeEach(() => {
    triggerTrack.mockClear();
    useAppStore.getState().actions.reset();
    vi.useRealTimers();
  });

  it("renders 8 pads", () => {
    render(<PadGrid />);
    expect(screen.getAllByLabelText(/^pad \d$/)).toHaveLength(8);
  });

  it("clicking a pad calls triggerTrack(trackId, now)", () => {
    render(<PadGrid />);
    fireEvent.click(screen.getByLabelText("pad 4"));
    expect(triggerTrack).toHaveBeenCalledWith(3, 1.234);
  });

  it("flashes when triggerSeq[trackId] increments", async () => {
    vi.useFakeTimers();
    render(<PadGrid />);
    const pad = screen.getByLabelText("pad 1");
    expect(pad).toHaveAttribute("data-flashing", "false");

    act(() => {
      useAppStore.getState().actions.markTriggered(0);
    });
    expect(pad).toHaveAttribute("data-flashing", "true");

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(pad).toHaveAttribute("data-flashing", "false");
  });
});
