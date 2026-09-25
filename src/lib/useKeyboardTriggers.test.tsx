// ABOUTME: useKeyboardTriggers tests — code → trackId mapping + suppression in inputs.
import { cleanup, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const triggerTrackNow = vi.fn();
const audioLifecycleMocks = vi.hoisted(() => ({
  AudioUnavailableError: class TestAudioUnavailableError extends Error {
    constructor(message = "Audio unavailable") {
      super(message);
      this.name = "AudioUnavailableError";
    }
  },
}));

vi.mock("./audio", () => ({
  triggerTrackNow: (...args: unknown[]) => triggerTrackNow(...args),
}));

vi.mock("./audioLifecycle", () => ({
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import { useKeyboardTriggers } from "./useKeyboardTriggers";
import { useAppStore } from "../store/useAppStore";

function Harness({ withInput = false }: { withInput?: boolean }) {
  useKeyboardTriggers();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useKeyboardTriggers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    triggerTrackNow.mockReset();
    triggerTrackNow.mockResolvedValue(undefined);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("fires on Digit3 → track 2, ignores held keys (repeat), ignores key-press inside an input", () => {
    const { getByTestId } = render(<Harness withInput />);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));
    expect(triggerTrackNow).toHaveBeenCalledWith(2);
    triggerTrackNow.mockClear();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", repeat: true, bubbles: true }),
    );
    expect(triggerTrackNow).not.toHaveBeenCalled();
    getByTestId("x").dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }),
    );
    expect(triggerTrackNow).not.toHaveBeenCalled();
  });

  it("does not fire digit triggers while recording is active", () => {
    render(<Harness />);
    useAppStore.getState().actions.setRecordingState("recording", 0);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));
    expect(triggerTrackNow).not.toHaveBeenCalled();
  });

  it("does not fire Chop digit triggers while Mood is active", () => {
    render(<Harness />);
    useAppStore.getState().actions.setAppMode("mood");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));

    expect(triggerTrackNow).not.toHaveBeenCalled();
  });

  it("swallows audio-unavailable digit-trigger rejections", async () => {
    triggerTrackNow.mockRejectedValueOnce(new audioLifecycleMocks.AudioUnavailableError());
    render(<Harness />);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));

    expect(triggerTrackNow).toHaveBeenCalledWith(2);
    await Promise.resolve();
  });
});
