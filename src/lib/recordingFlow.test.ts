// ABOUTME: recordingFlow tests — shared recording gate and early state claims.
// ABOUTME: Keeps async capture mocked so tests can target orchestration races.
import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  ensureAudioStarted: vi.fn(),
  getAudioContext: vi.fn(() => ({})),
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
  ensureAudioStarted: audioMocks.ensureAudioStarted,
  getAudioContext: audioMocks.getAudioContext,
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
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    audioMocks.ensureAudioStarted.mockReset();
    audioMocks.ensureAudioStarted.mockResolvedValue(undefined);
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
    expect(audioMocks.ensureAudioStarted).not.toHaveBeenCalled();
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("refuses to start recording while playback is active", async () => {
    useAppStore.getState().actions.setIsPlaying(true);

    await expect(recordIntoTrack(0)).resolves.toBe(false);

    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(audioMocks.ensureAudioStarted).not.toHaveBeenCalled();
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("claims countdown state before awaiting audio or media startup", async () => {
    const audioStarted = makeDeferred();
    audioMocks.ensureAudioStarted.mockReturnValue(audioStarted.promise);

    const promise = recordIntoTrack(2);

    expect(useAppStore.getState().recording).toEqual({
      state: "countdown",
      activeTrackId: 2,
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
