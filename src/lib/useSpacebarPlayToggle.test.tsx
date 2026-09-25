// ABOUTME: useSpacebarPlayToggle tests — start gating, no transport before the first clip, and editable-target suppression.
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
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

function pressSpace(): void {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
}

function Harness({ withInput = false }: { withInput?: boolean }) {
  useSpacebarPlayToggle();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useSpacebarPlayToggle", () => {
  beforeEach(() => {
    togglePlayback.mockReset();
    togglePlayback.mockResolvedValue(undefined);
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    // Space is the Play button's shortcut, and Play shows from the first clip.
    useAppStore.getState().actions.setTrackClip(0, makeClip());
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

  it("ignores Space before the first clip; stops playback from Space when the last clip goes while playing", () => {
    useAppStore.getState().actions.reset();
    render(<Harness />);

    pressSpace();
    expect(togglePlayback).not.toHaveBeenCalled();

    useAppStore.getState().actions.setIsPlaying(true);
    pressSpace();
    expect(togglePlayback).toHaveBeenCalledTimes(1);
  });

  it("still toggles after the last clip is deleted (the kit keeps playing)", () => {
    render(<Harness />);
    useAppStore.getState().actions.deleteTrackClip(0);
    pressSpace();
    expect(togglePlayback).toHaveBeenCalledTimes(1);
  });

  it("swallows audio-unavailable Space rejections", async () => {
    togglePlayback.mockRejectedValueOnce(new audioLifecycleMocks.AudioUnavailableError());
    render(<Harness />);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(togglePlayback).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});
