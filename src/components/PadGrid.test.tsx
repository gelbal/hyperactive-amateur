// ABOUTME: PadGrid tests — verifies pad-trigger promise handling at the UI boundary.
// ABOUTME: Keeps audio mocked so click behavior can target unhandled-rejection regressions.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  triggerTrackNow: vi.fn(),
}));
const audioLifecycleMocks = vi.hoisted(() => ({
  AudioUnavailableError: class TestAudioUnavailableError extends Error {
    constructor(message = "Audio unavailable") {
      super(message);
      this.name = "AudioUnavailableError";
    }
  },
}));

vi.mock("../lib/audio", () => ({
  triggerTrackNow: audioMocks.triggerTrackNow,
}));

vi.mock("../lib/audioLifecycle", () => ({
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import { useAppStore } from "../store/useAppStore";
import { PadGrid } from "./PadGrid";

describe("PadGrid", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    audioMocks.triggerTrackNow.mockReset();
    audioMocks.triggerTrackNow.mockResolvedValue(undefined);
  });

  it("swallows audio-unavailable pad rejections from clicks", async () => {
    audioMocks.triggerTrackNow.mockRejectedValueOnce(
      new audioLifecycleMocks.AudioUnavailableError(),
    );

    render(<PadGrid />);
    fireEvent.click(screen.getByRole("button", { name: "pad 1" }));

    expect(audioMocks.triggerTrackNow).toHaveBeenCalledWith(0);
    await Promise.resolve();
  });
});
