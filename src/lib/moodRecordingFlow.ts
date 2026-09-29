// ABOUTME: Mood recording flow — captures the first take ("the One") into a mic stack.
// ABOUTME: Reuses Chop recording seams for audio-clock countdown, abort safety, durability, and posters.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import type { MoodPiece, MoodTake, MoodTimeFeel } from "../types";
import { getAudioContext, triggerCountInClick } from "./audio";
import { AudioUnavailableError, ensureAudioRunning, noteMicAcquireStarted } from "./audioLifecycle";
import { isAbortError } from "./aiClient";
import { saveNow } from "./autoSave";
import { autoTrim } from "./autoTrim";
import { sliceAudioBuffer } from "./audioBufferSlice";
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
import {
  ACQUIRE_FAILED_COPY,
  CAMERA_DENIED_COPY,
  isPermissionDenial,
  releaseRecordingStream,
  requestMedia,
} from "./media";
import {
  allowedCaptureCapSeconds,
  DROP_BEATS_PER_CYCLE,
  establishCycleFromClick,
  nextCycleBoundary,
} from "./moodClock";
import {
  deriveMoodMetronomeTakeId,
  getMoodRecordingPreviewStream,
  setMoodRecordingPreviewStream,
} from "./moodCapture";
import { setCaptureGain } from "./moodPlayers";
import { MAX_TAKES_PER_MIC, STAGE_DESCRIPTORS } from "./moodStages";
import { classifyPart } from "./moodPartTag";
import { syncAssist } from "./moodSyncAssist";
import { snapTake } from "./moodTakeSnap";
import {
  armMoodSelectionCommit,
  startMoodPerformanceForRecordingFlow,
} from "./moodTransport";
import { setCaptureVideoPolicy } from "./moodVideoPool";
import { captureFirstFrame } from "./posterFrame";
import {
  allTracksUsable,
  registerRecordingInterruptHandler,
  waitForUsableTracks,
} from "./streamLifecycle";
import { makeAbortError, throwIfFlowAborted, waitMs } from "./async";
import { audioBufferToWav } from "./wavEncoder";

const POCKET_FIRST_TAKE_COUNT_IN_BPM = 90;
const COUNT_IN_BEATS = 3;
const AUDIO_UNAVAILABLE_COPY = "Couldn't start audio — try again.";
const RECORDING_INTERRUPTED_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";

type MoodRecordingCancelReason = "user" | "interrupted";

export { getMoodRecordingPreviewStream } from "./moodCapture";

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

function getAbortReason(signal: AbortSignal): MoodRecordingCancelReason {
  return signal.reason === "interrupted" ? "interrupted" : "user";
}

function isFlowAbort(err: unknown, signal: AbortSignal): boolean {
  return isAbortError(err) || (signal.aborted && err === signal.reason);
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

function scheduleCountInClicks(
  startAt: number,
  countdownEndsAt: number,
  beatSeconds: number,
  mode: "first-take" | "overdub",
): () => void {
  const noop = () => undefined;
  if (!Number.isFinite(beatSeconds) || beatSeconds <= 0) return noop;
  const lastTickBeforePunchIn = countdownEndsAt - 0.000_001;
  if (mode === "first-take") {
    // First-take count-ins can run before the Transport starts; pre-scheduling
    // leaves at most two residual ticks inside the silent pre-capture stage.
    for (let when = startAt; when < lastTickBeforePunchIn; when += beatSeconds) {
      triggerCountInClick(when);
    }
    return noop;
  }

  const transport = Tone.getTransport();
  const scheduledIds = new Set<number>();
  let cancelled = false;
  // scheduleOnce takes TRANSPORT time (seconds since position 0), not the
  // audio clock — convert each absolute tick time to a transport offset or
  // every tick fires late by the transport's start-time offset.
  const transportNow = transport.seconds;
  for (let when = startAt; when < lastTickBeforePunchIn; when += beatSeconds) {
    let scheduledId: number | null = null;
    scheduledId = transport.scheduleOnce((time) => {
      if (cancelled) return;
      if (scheduledId !== null) scheduledIds.delete(scheduledId);
      triggerCountInClick(time);
    }, transportNow + (when - startAt));
    scheduledIds.add(scheduledId);
  }
  return () => {
    if (cancelled) return;
    cancelled = true;
    for (const scheduledId of scheduledIds) {
      transport.clear(scheduledId);
    }
    scheduledIds.clear();
  };
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

// One count-in beat: the cycle's beat grid once a cycle exists, else the
// first-take count-in tempo. The countdown overlay derives its digits from
// this same value so the digits match the ticks you hear.
export function countInBeatSeconds(
  piece: Pick<MoodPiece, "timeFeel" | "bpm" | "cycleSeconds">,
): number {
  if (piece.cycleSeconds !== null) {
    return piece.cycleSeconds / DROP_BEATS_PER_CYCLE;
  }
  return 60 / countInBpm(piece.timeFeel, piece.bpm);
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

function findMoodTake(piece: MoodPiece, micId: string | null, takeId: string | null): MoodTake | null {
  if (!micId || !takeId) return null;
  return piece.mics.find((mic) => mic.id === micId)?.takes.find((take) => take.id === takeId) ?? null;
}

function fireSyncAssistWhenReady(
  micId: string,
  take: MoodTake,
  signal: AbortSignal,
): void {
  const state = useAppStore.getState();
  const piece = state.mood.piece;
  const cycleSeconds = piece?.cycleSeconds ?? null;
  if (!piece || cycleSeconds === null || piece.oneTakeId === take.id) return;

  const oneTake = findMoodTake(piece, piece.oneMicId, piece.oneTakeId);
  if (!oneTake || oneTake.audioStatus !== "ok" || !oneTake.audioBuffer) {
    logger.warn(LOG_EVENTS.MOOD_SYNC_MISS, {
      reason: "missing-reference-audio",
      takeId: take.id,
    });
    return;
  }

  let oneSlice: AudioBuffer;
  try {
    const cycleMs = cycleSeconds * 1000;
    oneSlice = sliceAudioBuffer(
      oneTake.audioBuffer,
      oneTake.trimStartMs,
      Math.min(oneTake.trimEndMs, oneTake.trimStartMs + cycleMs),
    );
  } catch (err) {
    logger.warn(LOG_EVENTS.MOOD_SYNC_MISS, {
      reason: "slice",
      takeId: take.id,
      message: errorMessage(err),
    });
    return;
  }

  const expectedRevision = state.session.moodRevision;
  void syncAssist(take, oneSlice, cycleSeconds, undefined, signal)
    .then((result) => {
      if (!result) return;
      const applied = useAppStore
        .getState()
        .actions.applyMoodSyncOffsetIfCurrent(
          micId,
          take.id,
          result.offsetMs,
          expectedRevision,
        );
      if (applied) resyncLiveTakeAtBoundary(micId, take.id);
    })
    .catch((err) => {
      logger.warn(LOG_EVENTS.MOOD_SYNC_MISS, {
        reason: "flow-error",
        takeId: take.id,
        message: errorMessage(err),
      });
    });
}

// A landed offset only reaches the audio when players rebuild. If the take
// is live in a running performance and the performer has nothing armed on
// that mic, re-arm the CURRENT selection so the existing boundary drain
// rebuilds the player in phase; an armed mic resyncs via its own commit.
function resyncLiveTakeAtBoundary(micId: string, takeId: string): void {
  const state = useAppStore.getState();
  const piece = state.mood.piece;
  const { performance } = state.mood;
  if (
    !piece ||
    piece.cycleSeconds === null ||
    !performance.isPerforming ||
    performance.epoch === null
  ) {
    return;
  }
  if (performance.selections[micId] !== takeId) return;
  if ((performance.armed[micId] ?? null) !== null) return;
  const now = Tone.now();
  armMoodSelectionCommit(
    { micId, entry: takeId },
    nextCycleBoundary(performance.epoch, piece.cycleSeconds, now),
    now,
  );
}

function firePartClassificationWhenReady(
  micId: string,
  take: MoodTake,
  signal: AbortSignal,
): void {
  const expectedRevision = useAppStore.getState().session.moodRevision;
  void classifyPart(take, undefined, signal)
    .then((result) => {
      if (!result) return;
      useAppStore
        .getState()
        .actions.applyMoodPartIfCurrent(
          micId,
          take.id,
          result.part,
          "ai",
          expectedRevision,
        );
    })
    .catch((err) => {
      logger.warn(LOG_EVENTS.MOOD_PART_MISS, {
        reason: "flow-error",
        takeId: take.id,
        message: errorMessage(err),
      });
    });
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
  let cancelCountInClicks: () => void = () => undefined;

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

  // A flow that will acquire its own stream declares capture intent before
  // the audio unlock, so the session type never passes through "playback"
  // on the way to getUserMedia. A supplied stream is already held.
  const releaseCaptureIntent = externalStream ? null : noteMicAcquireStarted();
  try {
    try {
      await ensureAudioRunning();
    } catch (e) {
      // A hide during the unlock aborts the flow; report the abort, not the
      // audio failure the bounded unlock surfaces on its way out.
      throwIfFlowAborted(signal, "Aborted during audio unlock");
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
        // Re-probe so the viewport gate can take over, without waiting on
        // it; the line names the next action: the settings for a denial, a
        // retry for anything else. Engine error text stays off the screen.
        void requestMedia();
        options.onError?.(isPermissionDenial(e) ? CAMERA_DENIED_COPY : ACQUIRE_FAILED_COPY);
        return false;
      }
    }
    if (!stream) return false;
    setMoodRecordingPreviewStream(stream);
    const captureState = useAppStore.getState().mood;
    setCaptureVideoPolicy(
      true,
      captureState.monitorWithHeadphones || !captureState.piece
        ? null
        : deriveMoodMetronomeTakeId(captureState.piece, captureState.performance),
    );
    throwIfFlowAborted(signal, "Aborted before countdown");

    // Already-usable tracks take the synchronous path; a cold track (muted
    // for a few hundred ms after acquisition on phones) gets a bounded grace.
    const tracksUsable = allTracksUsable(stream) || (await waitForUsableTracks(stream, { signal }));
    if (!tracksUsable) {
      actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      options.onError?.(RECORDING_INTERRUPTED_COPY);
      return false;
    }

    const audioContext = getAudioContext();
    const beatSeconds = countInBeatSeconds(startingPiece);
    let countdownEndsAt: number;
    if (startingPiece.cycleSeconds === null) {
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
    cancelCountInClicks = scheduleCountInClicks(
      audioContext.currentTime,
      countdownEndsAt,
      beatSeconds,
      startingPiece.cycleSeconds === null ? "first-take" : "overdub",
    );
    actions.setCountdownEndsAt(countdownEndsAt);
    actions.setRecordingState("countdown", null);

    await waitUntilAudioTime(countdownEndsAt, audioContext, signal);
    setCaptureGain(!useAppStore.getState().mood.monitorWithHeadphones);
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
    actions.setRecordingState("idle", null);
    armSelection(micId, take.id);
    attachPosterWhenReady(micId, take.id, result.blob, signal);
    fireSyncAssistWhenReady(micId, take, signal);
    firePartClassificationWhenReady(micId, take, signal);
    return true;
  } catch (e) {
    if (isFlowAbort(e, signal)) {
      cancelCountInClicks();
      if (getAbortReason(signal) === "interrupted") {
        actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      }
      return false;
    }
    options.onError?.(errorMessage(e));
    return false;
  } finally {
    cancelCountInClicks();
    if (getMoodRecordingPreviewStream() === stream) {
      setMoodRecordingPreviewStream(null);
    }
    setCaptureVideoPolicy(false);
    if (!externalStream && stream) releaseRecordingStream(stream);
    releaseCaptureIntent?.();
    setCaptureGain(false);
    actions.setCountdownEndsAt(null);
    actions.setRecordingState("idle", null);
    actions.setMoodHotMic(null);
  }
}

export function __resetMoodRecordingFlowForTesting(): void {
  currentController = null;
  currentFlow = null;
  currentStopController = null;
  setMoodRecordingPreviewStream(null);
}
