// ABOUTME: Mood recording flow — captures the first take ("the One") into a mic stack.
// ABOUTME: Reuses Chop recording seams for audio-clock countdown, abort safety, durability, and posters.
import { useAppStore } from "../store/useAppStore";
import type { MoodTake, MoodTimeFeel } from "../types";
import { getAudioContext } from "./audio";
import { AudioUnavailableError, ensureAudioRunning } from "./audioLifecycle";
import { isAbortError } from "./aiClient";
import { saveNow } from "./autoSave";
import { autoTrim } from "./autoTrim";
import { canStartMoodTake } from "./audibleActionGate";
import { armSelection } from "./moodPerformance";
import { acquireRecordingStreamUntilAbort } from "./recordingAcquire";
import { requestPersistenceAfterClipSave } from "./recordingPersistence";
import {
  createRecordClipStopController,
  recordClip,
  type RecordClipStopController,
} from "./recorder";
import { logger, LOG_EVENTS } from "./logger";
import { releaseRecordingStream, requestMedia } from "./media";
import {
  allowedCaptureCapSeconds,
  DROP_BEATS_PER_CYCLE,
  establishCycleFromClick,
  nextCycleBoundary,
} from "./moodClock";
import { MAX_TAKES_PER_MIC, STAGE_DESCRIPTORS } from "./moodStages";
import { snapTake } from "./moodTakeSnap";
import { startMoodPerformanceForRecordingFlow } from "./moodTransport";
import { captureFirstFrame } from "./posterFrame";
import { allTracksUsable, registerRecordingInterruptHandler } from "./streamLifecycle";
import { audioBufferToWav } from "./wavEncoder";

const POCKET_FIRST_TAKE_COUNT_IN_BPM = 90;
const COUNT_IN_BEATS = 3;
const AUDIO_UNAVAILABLE_COPY = "Couldn't start audio — tap the audio pill, then try again.";
const RECORDING_INTERRUPTED_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

type MoodRecordingCancelReason = "user" | "interrupted";

export interface RecordMoodTakeOptions {
  onError?: (message: string) => void;
  stream?: MediaStream;
}

let currentController: AbortController | null = null;
let currentFlow: Promise<boolean> | null = null;
let currentStopController: RecordClipStopController | null = null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function makeAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function throwIfFlowAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) {
    throw makeAbortError(message);
  }
}

function getAbortReason(signal: AbortSignal): MoodRecordingCancelReason {
  return signal.reason === "interrupted" ? "interrupted" : "user";
}

function isFlowAbort(err: unknown, signal: AbortSignal): boolean {
  return isAbortError(err) || (signal.aborted && err === signal.reason);
}

function waitMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbortError("Aborted before wait started"));
      return;
    }
    const delayMs = Math.max(0, ms);
    if (delayMs === 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(makeAbortError("Aborted during wait"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

function cycleCountdownDeadline(
  epoch: number,
  cycleSeconds: number,
  now: number,
): number {
  const beatSeconds = cycleSeconds / DROP_BEATS_PER_CYCLE;
  const boundary = nextCycleBoundary(epoch, cycleSeconds, now);
  return boundary - now >= beatSeconds ? boundary : boundary + cycleSeconds;
}

async function waitUntilAudioTime(
  deadlineSeconds: number,
  audioContext: Pick<BaseAudioContext, "currentTime">,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    throwIfFlowAborted(signal, "Aborted before countdown completed");
    const remainingMs = (deadlineSeconds - audioContext.currentTime) * 1000;
    if (remainingMs <= 0) return;
    await waitMs(remainingMs, signal);
  }
}

function isMoodRecordingInFlight(): boolean {
  return currentFlow !== null;
}

export function cancelCurrentMoodTake(
  reason: MoodRecordingCancelReason = "user",
): void {
  currentController?.abort(reason);
}

export function stopMoodTakeEarly(): boolean {
  if (!currentStopController) return false;
  currentStopController.stop();
  return true;
}

registerRecordingInterruptHandler({
  isActive: isMoodRecordingInFlight,
  interrupt: (reason) => cancelCurrentMoodTake(reason),
});

function countInBpm(timeFeel: MoodTimeFeel, bpm: number | null): number {
  if (timeFeel === "click" && bpm !== null && Number.isFinite(bpm) && bpm > 0) {
    return bpm;
  }
  return POCKET_FIRST_TAKE_COUNT_IN_BPM;
}

function firstTakeCaptureCapSeconds(
  timeFeel: MoodTimeFeel,
  bpm: number | null,
  cycleBars: 1 | 2 | 4 | null,
  cycleSeconds: number | null,
): number {
  if (cycleSeconds !== null) return allowedCaptureCapSeconds(cycleSeconds);
  if (timeFeel === "click" && bpm !== null && cycleBars !== null) {
    return Math.min(allowedCaptureCapSeconds(null), 4 * establishCycleFromClick(bpm, cycleBars));
  }
  return allowedCaptureCapSeconds(null);
}

function createMoodTakeId(): string {
  const cryptoWithRandomUuid = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoWithRandomUuid?.randomUUID === "function") {
    return `take-${cryptoWithRandomUuid.randomUUID()}`;
  }
  return `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function micHasStackRoom(micId: string): boolean {
  const piece = useAppStore.getState().mood.piece;
  const mic = piece?.mics.find((candidate) => candidate.id === micId);
  return Boolean(mic && mic.takes.length < MAX_TAKES_PER_MIC);
}

function takeWasApplied(micId: string, takeId: string): boolean {
  return (
    useAppStore
      .getState()
      .mood.piece?.mics.find((mic) => mic.id === micId)
      ?.takes.some((take) => take.id === takeId) === true
  );
}

function revokeTakeUrls(take: Pick<MoodTake, "url" | "posterUrl">): void {
  if (take.url) URL.revokeObjectURL(take.url);
  if (take.posterUrl) URL.revokeObjectURL(take.posterUrl);
}

function attachPosterWhenReady(
  micId: string,
  takeId: string,
  sourceBlob: Blob,
  signal: AbortSignal,
): void {
  void (async () => {
    let posterBlob: Blob | null = null;
    try {
      posterBlob = await captureFirstFrame(sourceBlob);
    } catch (err) {
      logger.warn(LOG_EVENTS.VIDEO_DRAW_ERROR, {
        phase: "mood-poster",
        message: errorMessage(err),
      });
      posterBlob = null;
    }
    if (!posterBlob) return;

    const posterUrl = URL.createObjectURL(posterBlob);
    try {
      throwIfFlowAborted(signal, "Aborted after poster extraction");
    } catch (err) {
      if (isFlowAbort(err, signal)) {
        URL.revokeObjectURL(posterUrl);
        return;
      }
      throw err;
    }
    useAppStore.getState().actions.attachMoodTakePoster(micId, takeId, posterBlob, posterUrl);
    // The attach action no-ops when the take is gone or an export started —
    // verify it applied, else this flow still owns the URL and must revoke it.
    const attached =
      useAppStore
        .getState()
        .mood.piece?.mics.find((mic) => mic.id === micId)
        ?.takes.some((take) => take.id === takeId && take.posterUrl === posterUrl) === true;
    if (!attached) URL.revokeObjectURL(posterUrl);
  })();
}

async function recordWithEarlyStop(
  stream: MediaStream,
  capMs: number,
  audioContext: AudioContext,
  signal: AbortSignal,
) {
  const stopController = createRecordClipStopController();
  currentStopController = stopController;
  try {
    return await recordClip(stream, capMs, audioContext, { signal, stopController });
  } finally {
    if (currentStopController === stopController) currentStopController = null;
  }
}

export async function recordMoodTake(
  micId: string,
  options: RecordMoodTakeOptions = {},
): Promise<boolean> {
  if (currentFlow) return false;
  const state = useAppStore.getState();
  if (!canStartMoodTake(state)) return false;
  const piece = state.mood.piece;
  if (!piece) return false;
  if (!micHasStackRoom(micId)) return false;

  const actions = state.actions;
  actions.setRecordingState("preparing", null);
  actions.setMoodHotMic(micId);

  const controller = new AbortController();
  currentController = controller;
  const flow = runFlow(micId, options, controller.signal);
  currentFlow = flow;
  try {
    return await flow;
  } finally {
    if (currentController === controller) currentController = null;
    if (currentFlow === flow) currentFlow = null;
  }
}

async function runFlow(
  micId: string,
  options: RecordMoodTakeOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const actions = useAppStore.getState().actions;
  const startingPiece = useAppStore.getState().mood.piece;
  const externalStream = options.stream ?? null;
  let stream: MediaStream | null = null;

  if (!startingPiece) return false;
  const descriptor = STAGE_DESCRIPTORS[startingPiece.stage];
  const capSeconds =
    startingPiece.cycleSeconds === null
      ? firstTakeCaptureCapSeconds(
          startingPiece.timeFeel,
          startingPiece.bpm,
          startingPiece.cycleBars,
          startingPiece.cycleSeconds,
        )
      : allowedCaptureCapSeconds(startingPiece.cycleSeconds);
  const capMs = Math.round(capSeconds * 1000);

  try {
    try {
      await ensureAudioRunning();
    } catch (e) {
      if (e instanceof AudioUnavailableError) {
        options.onError?.(AUDIO_UNAVAILABLE_COPY);
        return false;
      }
      // As in Chop, capture can continue because recordClip has a decode fallback.
    }
    throwIfFlowAborted(signal, "Aborted before media acquisition");

    if (
      startingPiece.cycleSeconds !== null &&
      !useAppStore.getState().mood.performance.isPerforming
    ) {
      await startMoodPerformanceForRecordingFlow();
      throwIfFlowAborted(signal, "Aborted before overdub performance start");
    }

    if (externalStream) {
      stream = externalStream;
    } else {
      try {
        stream = await acquireRecordingStreamUntilAbort(signal, descriptor.captureAspect);
      } catch (e) {
        if (signal.aborted) {
          throw makeAbortError("Aborted during media acquisition");
        }
        void requestMedia();
        options.onError?.(errorMessage(e));
        return false;
      }
    }
    if (!stream) return false;
    throwIfFlowAborted(signal, "Aborted before countdown");

    if (!allTracksUsable(stream)) {
      actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      options.onError?.(RECORDING_INTERRUPTED_COPY);
      return false;
    }

    const audioContext = getAudioContext();
    let countdownEndsAt: number;
    if (startingPiece.cycleSeconds === null) {
      const beatSeconds = 60 / countInBpm(startingPiece.timeFeel, startingPiece.bpm);
      countdownEndsAt = audioContext.currentTime + COUNT_IN_BEATS * beatSeconds;
    } else {
      const performance = useAppStore.getState().mood.performance;
      if (!performance.isPerforming || performance.epoch === null) return false;
      countdownEndsAt = cycleCountdownDeadline(
        performance.epoch,
        startingPiece.cycleSeconds,
        audioContext.currentTime,
      );
    }
    actions.setCountdownEndsAt(countdownEndsAt);
    actions.setRecordingState("countdown", null);

    await waitUntilAudioTime(countdownEndsAt, audioContext, signal);
    actions.setRecordingState("recording", null);
    const result = await recordWithEarlyStop(stream, capMs, audioContext, signal);
    throwIfFlowAborted(signal, "Aborted after capture");

    const trim = autoTrim(result.audioBuffer, capMs);
    const bufferDurationMs = Math.max(0, Math.round(result.audioBuffer.duration * 1000));
    const trimStartMs = Math.max(0, Math.min(trim.trimStartMs, bufferDurationMs));
    const trimEndFromContent = Math.max(
      trimStartMs,
      Math.min(trim.trimEndMs, bufferDurationMs),
    );
    const contentSeconds = Math.max(0, (trimEndFromContent - trimStartMs) / 1000);
    const snap = snapTake(contentSeconds, startingPiece.cycleSeconds);
    if (!snap.ok) return false;

    const trimEndMs =
      !snap.isOne && snap.trimTo !== undefined
        ? Math.min(trimEndFromContent, trimStartMs + Math.round(snap.trimTo * 1000))
        : trimEndFromContent;

    if (!micHasStackRoom(micId)) return false;

    const take: MoodTake = {
      id: createMoodTakeId(),
      videoBlob: result.blob,
      audioBlob: audioBufferToWav(result.audioBuffer),
      posterBlob: null,
      url: URL.createObjectURL(result.blob),
      audioBuffer: result.audioBuffer,
      audioStatus: "ok",
      posterUrl: null,
      trimStartMs,
      trimEndMs,
      durationSeconds: snap.durationSeconds,
      cycleMultiple: snap.isOne ? 1 : snap.cycleMultiple,
      syncOffsetMs: 0,
      part: null,
      partSource: null,
      recordedAt: Date.now(),
    };

    actions.setMoodTake(micId, take);
    if (!takeWasApplied(micId, take.id)) {
      revokeTakeUrls(take);
      return false;
    }

    try {
      if (await saveNow("mood")) requestPersistenceAfterClipSave();
    } catch {
      // saveNow logs autosave.error; durability failure is not a recording failure.
    }
    throwIfFlowAborted(signal, "Aborted after Mood take durability save");
    if (startingPiece.cycleSeconds !== null) {
      actions.setRecordingState("idle", null);
      armSelection(micId, take.id);
    }
    attachPosterWhenReady(micId, take.id, result.blob, signal);
    return true;
  } catch (e) {
    if (isFlowAbort(e, signal)) {
      if (getAbortReason(signal) === "interrupted") {
        actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      }
      return false;
    }
    options.onError?.(errorMessage(e));
    return false;
  } finally {
    if (!externalStream && stream) releaseRecordingStream(stream);
    actions.setCountdownEndsAt(null);
    actions.setRecordingState("idle", null);
    actions.setMoodHotMic(null);
  }
}

export function __resetMoodRecordingFlowForTesting(): void {
  currentController = null;
  currentFlow = null;
  currentStopController = null;
}
