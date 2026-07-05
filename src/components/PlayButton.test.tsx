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

  it("swallows audio-unavailable playback rejections from clicks", async () => {
    hintState.togglePlayback.mockRejectedValueOnce(new hintState.AudioUnavailableError());

    render(<PlayButton />);
    fireEvent.click(screen.getByRole("button", { name: /start playback/i }));

    expect(hintState.togglePlayback).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});
