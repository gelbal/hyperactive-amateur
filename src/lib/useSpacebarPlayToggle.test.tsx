// ABOUTME: useSpacebarPlayToggle tests — start gating and editable-target suppression.
import { cleanup, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const togglePlayback = vi.fn();
const audioLifecycleMocks = vi.hoisted(() => ({
  AudioUnavailableError: class TestAudioUnavailableError extends Error {
    constructor(message = "Audio unavailable") {
      super(message);
      this.name = "AudioUnavailableError";
    }
  },
}));

vi.mock("./audio", () => ({
  togglePlayback: (...args: unknown[]) => togglePlayback(...args),
}));

vi.mock("./audioLifecycle", () => ({
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import { useSpacebarPlayToggle } from "./useSpacebarPlayToggle";
import { useAppStore } from "../store/useAppStore";

function Harness({ withInput = false }: { withInput?: boolean }) {
  useSpacebarPlayToggle();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useSpacebarPlayToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    togglePlayback.mockReset();
    togglePlayback.mockResolvedValue(undefined);
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("toggles on Space while idle and ignores editable targets", () => {
    const { getByTestId } = render(<Harness withInput />);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(togglePlayback).toHaveBeenCalledTimes(1);

    togglePlayback.mockClear();
    getByTestId("x").dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not start playback from Space while recording is active", () => {
    render(<Harness />);
    useAppStore.getState().actions.setRecordingState("recording", 0);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not stop export-owned playback from Space while exporting", () => {
    render(<Harness />);
    useAppStore.getState().actions.setIsExporting(true);
    useAppStore.getState().actions.setIsPlaying(true);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not toggle Chop playback from Space while Mood is active", () => {
    render(<Harness />);
    useAppStore.getState().actions.setAppMode("mood");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("swallows audio-unavailable Space rejections", async () => {
    togglePlayback.mockRejectedValueOnce(new audioLifecycleMocks.AudioUnavailableError());
    render(<Harness />);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});
