// ABOUTME: recordingFlow tests — shared recording gate and early state claims.
// ABOUTME: Keeps async capture mocked so tests can target orchestration races.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  context: {
    state: "running" as AudioContextState,
    currentTime: 12,
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

const posterMocks = vi.hoisted(() => ({
  captureFirstFrame: vi.fn(),
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
  captureFirstFrame: posterMocks.captureFirstFrame,
}));

vi.mock("./wavEncoder", () => ({
  audioBufferToWav: vi.fn(() => new Blob([new Uint8Array([1])], { type: "audio/wav" })),
}));

vi.mock("./audioBufferSlice", () => ({
  sliceAudioBuffer: vi.fn((buffer) => buffer),
}));

import { COUNTDOWN_MS, cancelCurrentRecording, recordIntoTrack } from "./recordingFlow";
import { useAppStore } from "../store/useAppStore";
import { __resetAudioLifecycleForTesting } from "./audioLifecycle";
import { canStartAudibleAction } from "./audibleActionGate";
import { registerStreamLifecycle } from "./streamLifecycle";

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

function makeDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => res(value as T | PromiseLike<T>);
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function observeResolution(
  promise: Promise<boolean>,
): Promise<{ status: "resolved"; value: boolean } | { status: "pending" }> {
  let result: { status: "resolved"; value: boolean } | { status: "pending" } = {
    status: "pending",
  };
  void promise.then((value) => {
    result = { status: "resolved", value };
  });
  await flushMicrotasks();
  return result;
}

function makeTrack(
  kind: "audio" | "video",
  overrides: Partial<Pick<MediaStreamTrack, "muted" | "readyState">> = {},
): MediaStreamTrack {
  return {
    kind,
    muted: false,
    readyState: "live",
    ...overrides,
  } as MediaStreamTrack;
}

class LifecycleTrack extends EventTarget {
  kind: "audio" | "video";
  muted = false;
  readyState: "live" | "ended" = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });

  constructor(kind: "audio" | "video") {
    super();
    this.kind = kind;
  }

  fireMute() {
    this.muted = true;
    this.dispatchEvent(new Event("mute"));
  }
}

function makeStream(tracks: MediaStreamTrack[] = [makeTrack("audio"), makeTrack("video")]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
}

function makeLifecycleStream(): { stream: MediaStream; tracks: LifecycleTrack[] } {
  const tracks = [new LifecycleTrack("video"), new LifecycleTrack("audio")];
  return {
    stream: makeStream(tracks as unknown as MediaStreamTrack[]),
    tracks,
  };
}

function makeRecordResult({ durationMs = 1000 }: { durationMs?: number } = {}) {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBuffer: { duration: durationMs / 1000, sampleRate: 48000 } as AudioBuffer,
    durationMs,
  };
}

async function abortPendingFlow(promise: Promise<boolean>): Promise<void> {
  cancelCurrentRecording();
  await vi.runOnlyPendingTimersAsync();
  await promise.catch(() => false);
}

async function advanceCountdownToDeadline(): Promise<void> {
  const deadline = useAppStore.getState().recording.countdownEndsAt;
  if (deadline === null) throw new Error("missing countdown deadline");
  audioMocks.context.currentTime = deadline;
  await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
  await flushMicrotasks();
}

function makeAbortableRecordClip() {
  return (_stream: MediaStream, _durationMs: number, _context: AudioContext, options: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      const signal = options.signal;
      if (!signal) return;
      const rejectAbort = () => reject(new DOMException("Aborted during record", "AbortError"));
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
}

describe("recordingFlow", () => {
  beforeEach(() => {
    __resetAudioLifecycleForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    audioMocks.context.state = "running";
    audioMocks.context.currentTime = 12;
    toneMocks.start.mockReset();
    toneMocks.start.mockResolvedValue(undefined);
    mediaMocks.acquireRecordingStream.mockReset();
    mediaMocks.acquireRecordingStream.mockResolvedValue(makeStream());
    mediaMocks.releaseRecordingStream.mockReset();
    mediaMocks.requestMedia.mockReset();
    recorderMocks.recordClip.mockReset();
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult());
    posterMocks.captureFirstFrame.mockReset();
    posterMocks.captureFirstFrame.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("claims preparing state before awaiting audio or media startup", async () => {
    const audioStarted = makeDeferred();
    toneMocks.start.mockReturnValue(audioStarted.promise);

    const promise = recordIntoTrack(2);

    expect(useAppStore.getState().recording).toEqual({
      state: "preparing",
      activeTrackId: 2,
      countdownEndsAt: null,
      error: null,
    });
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("preparing");

    cancelCurrentRecording();
    audioStarted.resolve();

    await expect(promise).resolves.toBe(false);
    expect(mediaMocks.acquireRecordingStream).not.toHaveBeenCalled();
    expect(mediaMocks.releaseRecordingStream).not.toHaveBeenCalled();
    expect(useAppStore.getState().recording.state).toBe("idle");
  });

  it.each([
    ["implicit user", () => cancelCurrentRecording()],
    ["explicit user", () => cancelCurrentRecording("user")],
  ])("keeps %s cancellation quiet while preparing", async (_label, cancel) => {
    const onError = vi.fn();
    const audioStarted = makeDeferred();
    toneMocks.start.mockReturnValue(audioStarted.promise);

    const promise = recordIntoTrack(0, { onError });
    await flushMicrotasks();

    cancel();
    audioStarted.resolve();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancels quietly while stream acquisition is pending and reopens the gate", async () => {
    const onError = vi.fn();
    const acquisition = makeDeferred<MediaStream>();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const promise = recordIntoTrack(0, { onError });
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("preparing");
    expect(mediaMocks.acquireRecordingStream).toHaveBeenCalledTimes(1);

    cancelCurrentRecording();
    const settled = await observeResolution(promise);
    if (settled.status !== "resolved") {
      acquisition.resolve(makeStream());
      await promise.catch(() => false);
    }

    expect(settled).toEqual({ status: "resolved", value: false });
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBeNull();
    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(mediaMocks.requestMedia).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("releases a stream that resolves after acquisition cancellation", async () => {
    const stream = makeStream();
    const acquisition = makeDeferred<MediaStream>();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const promise = recordIntoTrack(0);
    await flushMicrotasks();
    cancelCurrentRecording();
    const settled = await observeResolution(promise);
    if (settled.status !== "resolved") {
      acquisition.resolve(stream);
      await promise.catch(() => false);
    }

    expect(settled).toEqual({ status: "resolved", value: false });
    expect(mediaMocks.releaseRecordingStream).not.toHaveBeenCalled();

    acquisition.resolve(stream);
    await flushMicrotasks();

    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledWith(stream);
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("swallows a rejected stream acquisition after cancellation", async () => {
    const onError = vi.fn();
    const acquisition = makeDeferred<MediaStream>();
    mediaMocks.acquireRecordingStream.mockReturnValue(acquisition.promise);

    const promise = recordIntoTrack(0, { onError });
    await flushMicrotasks();
    cancelCurrentRecording();
    const settled = await observeResolution(promise);
    if (settled.status !== "resolved") {
      acquisition.reject(new Error("late denial"));
      await promise.catch(() => false);
    }

    expect(settled).toEqual({ status: "resolved", value: false });

    acquisition.reject(new Error("late denial"));
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(mediaMocks.requestMedia).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("sets the pinned store error for interrupted cancellation during preparing", async () => {
    const onError = vi.fn();
    const audioStarted = makeDeferred();
    toneMocks.start.mockReturnValue(audioStarted.promise);

    const promise = recordIntoTrack(0, { onError });
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("preparing");

    cancelCurrentRecording("interrupted");
    audioStarted.resolve();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
    expect(onError).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
    expect(mediaMocks.releaseRecordingStream).not.toHaveBeenCalled();
  });

  it("starts countdown after audio and live tracks using the audio-clock deadline", async () => {
    vi.useFakeTimers();

    const promise = recordIntoTrack(1);
    await flushMicrotasks();

    expect(useAppStore.getState().recording.state).toBe("countdown");
    expect(useAppStore.getState().recording.countdownEndsAt).toBe(
      audioMocks.context.currentTime + COUNTDOWN_MS / 1000,
    );
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();

    await abortPendingFlow(promise);
  });

  it("sets the pinned store error for interrupted cancellation during countdown", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const stream = makeStream();
    mediaMocks.acquireRecordingStream.mockResolvedValue(stream);

    const promise = recordIntoTrack(1, { onError });
    await flushMicrotasks();
    expect(useAppStore.getState().recording.state).toBe("countdown");

    cancelCurrentRecording("interrupted");

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
    expect(onError).not.toHaveBeenCalled();
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledWith(stream);
  });

  it.each([
    ["muted audio track", makeStream([makeTrack("audio", { muted: true }), makeTrack("video")])],
    ["no audio track", makeStream([makeTrack("video")])],
    ["no video track", makeStream([makeTrack("audio")])],
  ])("fails before countdown when the stream has %s", async (_label, stream) => {
    vi.useFakeTimers();
    const onError = vi.fn();
    mediaMocks.acquireRecordingStream.mockResolvedValue(stream);

    const promise = recordIntoTrack(4, { onError });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
    expect(onError).toHaveBeenCalledWith(INTERRUPTION_COPY);
    expect(recorderMocks.recordClip).not.toHaveBeenCalled();
  });

  it("flips to recording before recordClip runs and clears countdown deadline on idle", async () => {
    vi.useFakeTimers();
    const setRecordingState = vi.spyOn(useAppStore.getState().actions, "setRecordingState");

    recorderMocks.recordClip.mockImplementation(() => {
      expect(useAppStore.getState().recording.state).toBe("recording");
      return Promise.resolve(makeRecordResult());
    });

    const promise = recordIntoTrack(5);
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    const recordingCallOrder = setRecordingState.mock.calls.findIndex(
      ([state]) => state === "recording",
    );
    expect(recordingCallOrder).toBeGreaterThanOrEqual(0);
    expect(setRecordingState.mock.invocationCallOrder[recordingCallOrder]).toBeLessThan(
      recorderMocks.recordClip.mock.invocationCallOrder[0],
    );
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.countdownEndsAt).toBeNull();

    setRecordingState.mockRestore();
  });

  it("clamps saved trim end to the actual captured buffer duration", async () => {
    vi.useFakeTimers();
    recorderMocks.recordClip.mockResolvedValue(makeRecordResult({ durationMs: 500 }));

    const promise = recordIntoTrack(5);
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    const clip = useAppStore.getState().project.tracks[5].clip;
    expect(clip?.durationMs).toBe(500);
    expect(clip?.trimStartMs).toBe(0);
    expect(clip?.trimEndMs).toBe(500);
  });

  it("sets the pinned store error for interrupted cancellation during the record window", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const stream = makeStream();
    mediaMocks.acquireRecordingStream.mockResolvedValue(stream);
    recorderMocks.recordClip.mockImplementation(makeAbortableRecordClip());

    const promise = recordIntoTrack(2, { onError });
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    expect(useAppStore.getState().recording.state).toBe("recording");
    expect(recorderMocks.recordClip).toHaveBeenCalledTimes(1);

    cancelCurrentRecording("interrupted");

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
    expect(onError).not.toHaveBeenCalled();
    expect(mediaMocks.releaseRecordingStream).toHaveBeenCalledWith(stream);
  });

  it("saves the clip and returns idle before poster extraction resolves, then attaches the late poster", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const poster = makeDeferred<Blob | null>();
    const posterBlob = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    posterMocks.captureFirstFrame.mockReturnValue(poster.promise);
    const setTrackPoster = vi.spyOn(useAppStore.getState().actions, "setTrackPoster");

    const promise = recordIntoTrack(2, { onError });
    try {
      await flushMicrotasks();
      await advanceCountdownToDeadline();
      expect(recorderMocks.recordClip).toHaveBeenCalledTimes(1);
      expect(posterMocks.captureFirstFrame).toHaveBeenCalledTimes(1);

      await expect(observeResolution(promise)).resolves.toEqual({
        status: "resolved",
        value: true,
      });
      const stateBeforePoster = useAppStore.getState();
      const savedClip = stateBeforePoster.project.tracks[2].clip;
      expect(stateBeforePoster.recording.state).toBe("idle");
      expect(savedClip).not.toBeNull();
      expect(savedClip?.posterBlob).toBeNull();
      expect(savedClip?.posterUrl).toBeNull();
      expect(setTrackPoster).not.toHaveBeenCalled();

      poster.resolve(posterBlob);
      await flushMicrotasks(5);

      expect(setTrackPoster).toHaveBeenCalledWith(2, posterBlob, savedClip);
      expect(useAppStore.getState().project.tracks[2].clip?.posterBlob).toBe(posterBlob);
      expect(useAppStore.getState().recording.error).toBeNull();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      poster.resolve(null);
      await promise.catch(() => false);
      setTrackPoster.mockRestore();
    }
  });

  it("discards a late poster when the clip was replaced before it resolves", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const poster = makeDeferred<Blob | null>();
    const posterBlob = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    posterMocks.captureFirstFrame.mockReturnValue(poster.promise);
    const createObjectURL = vi.spyOn(URL, "createObjectURL");

    const promise = recordIntoTrack(2, { onError });
    try {
      await flushMicrotasks();
      await advanceCountdownToDeadline();
      expect(recorderMocks.recordClip).toHaveBeenCalledTimes(1);
      expect(posterMocks.captureFirstFrame).toHaveBeenCalledTimes(1);

      await expect(observeResolution(promise)).resolves.toEqual({
        status: "resolved",
        value: true,
      });
      const savedClip = useAppStore.getState().project.tracks[2].clip;
      if (!savedClip) throw new Error("missing saved clip");
      const urlCallsAfterSave = createObjectURL.mock.calls.length;
      const replacement = {
        ...savedClip,
        blob: new Blob([new Uint8Array([2])], { type: "video/webm" }),
        url: "blob:test/replacement",
        posterBlob: null,
        posterUrl: null,
      };
      useAppStore.getState().actions.setTrackClip(2, replacement);

      poster.resolve(posterBlob);
      await flushMicrotasks(5);

      expect(useAppStore.getState().project.tracks[2].clip).toBe(replacement);
      expect(useAppStore.getState().project.tracks[2].clip?.posterBlob).toBeNull();
      expect(createObjectURL).toHaveBeenCalledTimes(urlCallsAfterSave);
      expect(useAppStore.getState().recording.error).toBeNull();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      poster.resolve(null);
      await promise.catch(() => false);
      createObjectURL.mockRestore();
    }
  });

  it("keeps the saved clip intact when poster extraction returns null", async () => {
    vi.useFakeTimers();
    posterMocks.captureFirstFrame.mockResolvedValue(null);

    const promise = recordIntoTrack(2);
    await flushMicrotasks();
    await advanceCountdownToDeadline();

    await expect(promise).resolves.toBe(true);
    const clip = useAppStore.getState().project.tracks[2].clip;
    expect(clip).not.toBeNull();
    expect(clip?.posterBlob).toBeNull();
    expect(clip?.posterUrl).toBeNull();
  });

  it("keeps waiting when the audio clock has not reached the countdown deadline", async () => {
    vi.useFakeTimers();

    const promise = recordIntoTrack(6);
    try {
      await flushMicrotasks(5);
      const deadline = useAppStore.getState().recording.countdownEndsAt;
      if (deadline === null) throw new Error("missing countdown deadline");

      audioMocks.context.currentTime = deadline - 1;
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      await flushMicrotasks();
      expect(recorderMocks.recordClip).not.toHaveBeenCalled();

      audioMocks.context.currentTime = deadline;
      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      expect(recorderMocks.recordClip).toHaveBeenCalledTimes(1);
    } finally {
      await promise.catch(() => false);
    }
  });

  it("cancels a real in-flight flow when a lifecycle mute event fires", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { stream, tracks } = makeLifecycleStream();
    registerStreamLifecycle(stream);
    recorderMocks.recordClip.mockImplementation(makeAbortableRecordClip());

    const promise = recordIntoTrack(2, { stream, onError });
    await flushMicrotasks();
    await advanceCountdownToDeadline();
    expect(useAppStore.getState().recording.state).toBe("recording");

    tracks[1].fireMute();

    await expect(promise).resolves.toBe(false);
    expect(useAppStore.getState().recording.state).toBe("idle");
    expect(useAppStore.getState().recording.error).toBe(INTERRUPTION_COPY);
    expect(useAppStore.getState().project.tracks[2].clip).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
