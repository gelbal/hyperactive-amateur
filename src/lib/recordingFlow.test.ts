// ABOUTME: recordingFlow tests — shared recording gate and early state claims.
// ABOUTME: Keeps async capture mocked so tests can target orchestration races.
import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  context: {
    state: "running" as AudioContextState,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  getAudioContext: vi.fn(() => audioMocks.context),
}));

const toneMocks = vi.hoisted(() => ({
  start: vi.fn(),
}));

const mediaMocks = vi.hoisted(() => ({
  acquireRecordingStream: vi.fn(),
  releaseRecordingStream: vi.fn(),
  requestMedia: vi.fn(),
}));

const recorderMocks = vi.hoisted(() => ({
  recordClip: vi.fn(),
}));

vi.mock("./audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
}));

vi.mock("tone", () => ({
  start: toneMocks.start,
}));

vi.mock("./media", () => ({
  acquireRecordingStream: mediaMocks.acquireRecordingStream,
  releaseRecordingStream: mediaMocks.releaseRecordingStream,
  requestMedia: mediaMocks.requestMedia,
}));

vi.mock("./recorder", () => ({
  recordClip: recorderMocks.recordClip,
}));

vi.mock("./aiClient", () => ({
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === "AbortError",
}));

vi.mock("./autoTrim", () => ({
  autoTrim: () => ({ trimStartMs: 0, trimEndMs: 1000 }),
}));

vi.mock("./aiAutoTag", () => ({
  AUTO_TAG_CONFIDENCE_THRESHOLD: 0.8,
  autoTag: vi.fn().mockResolvedValue(null),
}));

vi.mock("./applyClassifiedTag", () => ({
  applyClassifiedTag: vi.fn(() => ({ applied: false, hatAudioOnly: false })),
}));

vi.mock("./posterFrame", () => ({
  captureFirstFrame: vi.fn().mockResolvedValue(null),
}));

vi.mock("./wavEncoder", () => ({
  audioBufferToWav: vi.fn(() => new Blob([new Uint8Array([1])], { type: "audio/wav" })),
}));

vi.mock("./audioBufferSlice", () => ({
  sliceAudioBuffer: vi.fn((buffer) => buffer),
}));

import { cancelCurrentRecording, recordIntoTrack } from "./recordingFlow";
import { useAppStore } from "../store/useAppStore";
import { __resetAudioLifecycleForTesting } from "./audioLifecycle";

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeStream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

describe("recordingFlow", () => {
  beforeEach(() => {
    __resetAudioLifecycleForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    audioMocks.context.state = "running";
    toneMocks.start.mockReset();
    toneMocks.start.mockResolvedValue(undefined);
    mediaMocks.acquireRecordingStream.mockReset();
    mediaMocks.acquireRecordingStream.mockResolvedValue(makeStream());
    mediaMocks.releaseRecordingStream.mockReset();
    mediaMocks.requestMedia.mockReset();
    recorderMocks.recordClip.mockReset();
  });

  it("refuses to start recording while export is active", async () => {
    useAppStore.getState().actions.setIsExporting(true);

    await expect(recordIntoTrack(0)).resolves.toBe(false);

    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(toneMocks.start).not.toHaveBeenCalled();
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("refuses to start recording while playback is active", async () => {
    useAppStore.getState().actions.setIsPlaying(true);

    await expect(recordIntoTrack(0)).resolves.toBe(false);

    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(toneMocks.start).not.toHaveBeenCalled();
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("surfaces rejected Tone.start with pinned audio copy and resets recording state", async () => {
    const onError = vi.fn();
    toneMocks.start.mockRejectedValue(new Error("resume denied"));
    mediaMocks.acquireRecordingStream.mockRejectedValue(new Error("media should not start"));

    await expect(recordIntoTrack(3, { onError })).resolves.toBe(false);

    expect(toneMocks.start).toHaveBeenCalledTimes(1);
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Couldn't start audio — tap the audio pill, then try again.");
    expect(useAppStore.getState().recording.state).toBe("idle");
  });

  it("claims countdown state before awaiting audio or media startup", async () => {
    const audioStarted = makeDeferred();
    toneMocks.start.mockReturnValue(audioStarted.promise);

    const promise = recordIntoTrack(2);

    expect(useAppStore.getState().recording).toEqual({
      state: "countdown",
      activeTrackId: 2,
      countdownEndsAt: null,
      error: null,
    });
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();

    cancelCurrentRecording();
    audioStarted.resolve();

    await expect(promise).resolves.toBe(false);
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(mediaMocks.releaseRecordingStream).not.toHaveBeenCalled();
    expect(useAppStore.getState().recording.state).toBe("idle");
  });
});
