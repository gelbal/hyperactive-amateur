// ABOUTME: ModeSwitch tests — verifies the Chop|Mood header switch behavior.
// ABOUTME: Pins disabled states and the audible stop when leaving active Chop playback.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  stopPlayback: vi.fn(),
}));

const moodTransportMocks = vi.hoisted(() => ({
  stopMoodPerformance: vi.fn(),
}));

vi.mock("../lib/audio", () => ({
  stopPlayback: audioMocks.stopPlayback,
}));

vi.mock("../lib/moodTransport", () => ({
  stopMoodPerformance: moodTransportMocks.stopMoodPerformance,
}));

import { ModeSwitch } from "./ModeSwitch";
import { useAppStore } from "../store/useAppStore";

describe("ModeSwitch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    audioMocks.stopPlayback.mockReset();
    moodTransportMocks.stopMoodPerformance.mockReset();
  });

  it("renders Chop and Mood segments with the active mode pressed", () => {
    render(<ModeSwitch />);

    expect(screen.getByRole("button", { name: "Chop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Mood" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("sizes both segments to 44px on coarse pointers", () => {
    render(<ModeSwitch />);

    expect(screen.getByRole("button", { name: "Chop" })).toHaveClass(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByRole("button", { name: "Mood" })).toHaveClass(
      "pointer-coarse:min-h-11",
    );
  });

  it("stops a running Mood performance before entering Chop", () => {
    const actions = useAppStore.getState().actions;
    actions.setAppMode("mood");
    actions.createMoodPiece("corners", "pocket");
    actions.setMoodPerforming(true, 4);
    render(<ModeSwitch />);

    fireEvent.click(screen.getByRole("button", { name: "Chop" }));

    expect(moodTransportMocks.stopMoodPerformance).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().appMode).toBe("chop");
  });

  it("switches modes through the store", () => {
    render(<ModeSwitch />);

    fireEvent.click(screen.getByRole("button", { name: "Mood" }));

    expect(useAppStore.getState().appMode).toBe("mood");
    expect(screen.getByRole("button", { name: "Mood" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("disables both segments during export or recording", () => {
    useAppStore.getState().actions.setIsExporting(true);
    const { rerender } = render(<ModeSwitch />);

    expect(screen.getByRole("button", { name: "Chop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mood" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chop" })).toHaveAttribute(
      "title",
      "frozen during export",
    );
    expect(screen.getByRole("button", { name: "Mood" })).toHaveAttribute(
      "title",
      "frozen during export",
    );

    act(() => {
      useAppStore.getState().actions.setIsExporting(false);
      useAppStore.getState().actions.reset();
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    rerender(<ModeSwitch />);

    expect(screen.getByRole("button", { name: "Chop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mood" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chop" })).toHaveAttribute(
      "title",
      "locked during capture",
    );
    expect(screen.getByRole("button", { name: "Mood" })).toHaveAttribute(
      "title",
      "locked during capture",
    );
  });

  it("stops active Chop playback before switching to Mood", () => {
    useAppStore.getState().actions.setIsPlaying(true);
    expect(useAppStore.getState().appMode).toBe("chop");
    expect(useAppStore.getState().playback.isPlaying).toBe(true);
    render(<ModeSwitch />);

    fireEvent.click(screen.getByRole("button", { name: "Mood" }));

    expect(useAppStore.getState().appMode).toBe("mood");
    expect(audioMocks.stopPlayback).toHaveBeenCalledTimes(1);
  });
});
