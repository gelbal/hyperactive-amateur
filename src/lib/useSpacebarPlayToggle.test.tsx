// ABOUTME: useSpacebarPlayToggle tests — start gating and editable-target suppression.
import { cleanup, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const togglePlayback = vi.fn();
const startMoodPerformance = vi.fn();
const stopMoodPerformance = vi.fn();
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

vi.mock("./moodTransport", () => ({
  startMoodPerformance: (...args: unknown[]) => startMoodPerformance(...args),
  stopMoodPerformance: (...args: unknown[]) => stopMoodPerformance(...args),
}));

vi.mock("./audioLifecycle", () => ({
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import { useSpacebarPlayToggle } from "./useSpacebarPlayToggle";
import { useAppStore } from "../store/useAppStore";
import type { MoodTake } from "../types";

function makeMoodTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "the-one";
  return {
    id,
    videoBlob: new Blob(["video"], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: 4, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: 4000,
    durationSeconds: 4,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

function establishStartableMood(): void {
  const actions = useAppStore.getState().actions;
  actions.setAppMode("mood");
  actions.createMoodPiece("row", "pocket");
  actions.setMoodTake("mic-0", makeMoodTake());
}

function Harness({ withInput = false }: { withInput?: boolean }) {
  useSpacebarPlayToggle();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useSpacebarPlayToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    togglePlayback.mockReset();
    togglePlayback.mockResolvedValue(undefined);
    startMoodPerformance.mockReset();
    startMoodPerformance.mockResolvedValue(undefined);
    stopMoodPerformance.mockReset();
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

  it("starts and stops Mood performance from Space while Mood is active", () => {
    render(<Harness />);
    establishStartableMood();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(startMoodPerformance).toHaveBeenCalledTimes(1);
    expect(stopMoodPerformance).not.toHaveBeenCalled();
    expect(togglePlayback).not.toHaveBeenCalled();

    startMoodPerformance.mockClear();
    useAppStore.getState().actions.setMoodPerforming(true, 12);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(stopMoodPerformance).toHaveBeenCalledTimes(1);
    expect(startMoodPerformance).not.toHaveBeenCalled();
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("keeps Mood Space suppression for editable targets and repeats", () => {
    const { getByTestId } = render(<Harness withInput />);
    establishStartableMood();

    getByTestId("x").dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true, repeat: true }),
    );

    expect(startMoodPerformance).not.toHaveBeenCalled();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(startMoodPerformance).toHaveBeenCalledTimes(1);
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not start Mood performance from Space while recording is active", () => {
    render(<Harness />);
    establishStartableMood();
    useAppStore.getState().actions.setRecordingState("recording", 0);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(startMoodPerformance).not.toHaveBeenCalled();
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("does not stop Mood performance from Space during an active overdub capture", () => {
    render(<Harness />);
    establishStartableMood();
    useAppStore.getState().actions.setMoodPerforming(true, 12);
    useAppStore.getState().actions.setRecordingState("recording", null);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(stopMoodPerformance).not.toHaveBeenCalled();
    expect(startMoodPerformance).not.toHaveBeenCalled();
    expect(useAppStore.getState().mood.performance).toMatchObject({
      isPerforming: true,
      epoch: 12,
    });
  });

  it("does not stop export-owned Mood performance from Space while exporting", () => {
    render(<Harness />);
    establishStartableMood();
    useAppStore.getState().actions.setMoodPerforming(true, 12);
    useAppStore.getState().actions.setIsExporting(true);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

    expect(stopMoodPerformance).not.toHaveBeenCalled();
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
