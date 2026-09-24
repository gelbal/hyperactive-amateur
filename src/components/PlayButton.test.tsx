// ABOUTME: PlayButton tests — verifies the silent-switch hint UI around the transport control.
// ABOUTME: Mocks audio lifecycle hint state so component rendering stays focused and deterministic.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hintState = vi.hoisted(() => ({
  shouldShow: vi.fn(),
  dismiss: vi.fn(),
  togglePlayback: vi.fn(),
  AudioUnavailableError: class TestAudioUnavailableError extends Error {
    constructor(message = "Audio unavailable") {
      super(message);
      this.name = "AudioUnavailableError";
    }
  },
}));

vi.mock("../lib/audio", () => ({
  togglePlayback: hintState.togglePlayback,
}));

vi.mock("../lib/audioLifecycle", () => ({
  AudioUnavailableError: hintState.AudioUnavailableError,
  shouldShowSilentSwitchHint: hintState.shouldShow,
  markSilentSwitchHintDismissed: hintState.dismiss,
}));

import { PlayButton } from "./PlayButton";
import { useAppStore } from "../store/useAppStore";

describe("PlayButton silent-switch hint", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    hintState.shouldShow.mockReset();
    hintState.dismiss.mockReset();
    hintState.togglePlayback.mockReset();
    hintState.togglePlayback.mockResolvedValue(undefined);
  });

  it('shows a dismissible "No sound? Check your phone\'s silent switch." hint when audioLifecycle asks for it', () => {
    hintState.shouldShow.mockReturnValue(true);
    useAppStore.getState().actions.setAudioState("running");

    const { rerender } = render(<PlayButton />);

    expect(screen.getByText("No sound? Check your phone's silent switch.")).toBeInTheDocument();

    hintState.shouldShow.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: /dismiss silent switch hint/i }));
    rerender(<PlayButton />);

    expect(hintState.dismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No sound? Check your phone's silent switch.")).not.toBeInTheDocument();
  });

  it("anchors the silent-switch hint under the sticky header on phones instead of centering off-screen", () => {
    // A 224px hint centered under the play button ran off the screen edge on
    // phones. Below sm the wrapper is not positioned, so the hint spans the
    // header's width under it; sm+ keeps the anchored, centred popover.
    hintState.shouldShow.mockReturnValue(true);
    useAppStore.getState().actions.setAudioState("running");

    render(<PlayButton />);

    const hint = screen
      .getByText("No sound? Check your phone's silent switch.")
      .closest("div");
    expect(hint?.parentElement).toHaveClass("static", "lg:relative");
    expect(hint?.className).toContain("absolute");
    expect(hint?.className).toContain("inset-x-3");
    expect(hint?.className).toContain("top-full");
    expect(hint?.className).toContain("lg:inset-x-auto");
    expect(hint?.className.split(/\s+/)).not.toContain("fixed");
  });

  it("stacks the hint below the Feel and Export panels, which hang under the header at the same spot", () => {
    // The panels are z-30 inside the header's stacking context; a hint above
    // them covered the Feel panel's first row, so a tap on the tempo knob's
    // top edge landed on the hint and closed the panel as an outside click.
    hintState.shouldShow.mockReturnValue(true);
    useAppStore.getState().actions.setAudioState("running");

    render(<PlayButton />);

    const hint = screen
      .getByText("No sound? Check your phone's silent switch.")
      .closest("div");
    const classes = hint?.className.split(/\s+/) ?? [];
    expect(classes).toContain("z-20");
    expect(classes).not.toContain("z-40");
    // Same corner radius as the panels, or the pill's corners peek out at
    // the panel's rounded corners.
    expect(classes).toContain("rounded-md");
  });

  it("names the keyboard shortcut in its title instead of a hint beside it", () => {
    render(<PlayButton />);

    expect(screen.getByRole("button", { name: "Start playback" })).toHaveAttribute(
      "title",
      "Play or stop (space)",
    );
  });

  it("swallows audio-unavailable playback rejections from clicks", async () => {
    hintState.togglePlayback.mockRejectedValueOnce(new hintState.AudioUnavailableError());

    render(<PlayButton />);
    fireEvent.click(screen.getByRole("button", { name: /start playback/i }));

    expect(hintState.togglePlayback).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});
