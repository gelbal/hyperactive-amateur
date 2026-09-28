// ABOUTME: Mood recording flow — captures the first take ("the One") into a mic stack.
// ABOUTME: Reuses Chop recording seams for audio-clock countdown, abort safety, durability, and posters.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import type { MoodPiece, MoodTake, MoodTimeFeel } from "../types";
import { getAudioContext, triggerMoodCountInTick } from "./audio";
import { AudioUnavailableError, ensureAudioRunning, noteMicAcquireStarted } from "./audioLifecycle";
import {
  errorMessage,
  getAbortReason,
  isFlowAbort,
  makeAbortError,
  throwIfFlowAborted,
  waitUntilAudioTime,
} from "./async";
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
import { suspendMoodPadsForCapture } from "./moodFx";
import { setCaptureGain } from "./moodPlayers";
import { MAX_TAKES_PER_MIC, STAGE_DESCRIPTORS } from "./moodStages";
import { classifyPart } from "./moodPartTag";
import { syncAssist } from "./moodSyncAssist";
import { snapTake } from "./moodTakeSnap";
import {
  armMoodSelectionCommit,
  startMoodPerformanceForRecordingFlow,
  stopMoodPerformance,
} from "./moodTransport";
import { setCaptureVideoPolicy } from "./moodVideoPool";
import { captureFirstFrame } from "./posterFrame";
import {
  allTracksUsable,
  registerRecordingInterruptHandler,
  waitForUsableTracks,
} from "./streamLifecycle";
import { audioBufferToWav } from "./wavEncoder";

const POCKET_FIRST_TAKE_COUNT_IN_BPM = 90;
const COUNT_IN_BEATS = 3;
const AUDIO_UNAVAILABLE_COPY = "Couldn't start audio — try again.";
const RECORDING_INTERRUPTED_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";
const INSTANT_PUNCH_OUT_SECONDS = 0.15;

type MoodRecordingCancelReason = "user" | "interrupted";

export { getMoodRecordingPreviewStream } from "./moodCapture";

interface RecordMoodTakeOptions {
  onError?: (message: string) => void;
  stream?: MediaStream;
}

let currentController: AbortController | null = null;
let currentFlow: Promise<boolean> | null = null;
interface ActiveMoodStopController {
  controller: RecordClipStopController;
  startedAt: number;
  stoppedAt: number | null;
}
let currentStopController: ActiveMoodStopController | null = null;
const backfilledOneTakeIds = new Set<string>();
let backfillClassificationController: AbortController | null = null;

class InstantMoodPunchOutError extends Error {}

function reportMoodTakeFailure(
  options: RecordMoodTakeOptions,
  reason: string,
): false {
  logger.warn(LOG_EVENTS.MOOD_TAKE_FAILED, { reason });
  options.onError?.(reason);
  return false;
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

// A transport event this close to the lookahead clock may already be
// behind the transport's scheduling position.
const COUNT_IN_TRANSPORT_MARGIN_SECONDS = 0.02;

function scheduleCountInClicks(
  startAt: number,
  countdownEndsAt: number,
  beatSeconds: number,
  mode: "first-take" | "overdub",
): () => void {
  const noop = () => undefined;
  if (!Number.isFinite(beatSeconds) || beatSeconds <= 0) return noop;
  const lastTickBeforePunchIn = countdownEndsAt - 0.000_001;
  const optionsAt = (when: number) => {
    const beatsRemaining =
      Math.floor((lastTickBeforePunchIn - when) / beatSeconds) + 1;
    return { beatsRemaining, accent: beatsRemaining === 1 };
  };
  if (mode === "first-take") {
    // First-take count-ins can run before the Transport starts; pre-scheduling
    // leaves at most two residual ticks inside the silent pre-capture stage.
    // A cancelled first take may therefore still play up to two residual, possibly
    // accented ticks; that is the deliberate pre-scheduling trade.
    for (let when = startAt; when < lastTickBeforePunchIn; when += beatSeconds) {
      triggerMoodCountInTick(when, optionsAt(when));
    }
    return noop;
  }

  const transport = Tone.getTransport();
  const scheduledIds = new Set<number>();
  let cancelled = false;
  // Overdub ticks sit on the loops' beat grid, counted back from the
  // punch-in (a cycle boundary), so the accented one is the last beat before
  // it. They are carried by the transport so a cancelled take can clear them;
  // scheduleOnce takes TRANSPORT time, so each audio-clock tick is converted.
  // A tick already inside the lookahead may be behind the transport's
  // scheduling position, so it plays on the audio clock directly.
  const beatsBeforePunchIn = Math.floor((countdownEndsAt - startAt) / beatSeconds + 1e-9);
  for (let beat = beatsBeforePunchIn; beat >= 1; beat -= 1) {
    const when = countdownEndsAt - beat * beatSeconds;
    if (when <= Tone.now() + COUNT_IN_TRANSPORT_MARGIN_SECONDS) {
      triggerMoodCountInTick(when, optionsAt(when));
      continue;
    }
    let scheduledId: number | null = null;
    scheduledId = transport.scheduleOnce(() => {
      if (cancelled) return;
      if (scheduledId !== null) scheduledIds.delete(scheduledId);
      triggerMoodCountInTick(when, optionsAt(when));
    }, transport.getSecondsAtTime(when));
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

function isMoodRecordingInFlight(): boolean {
  return currentFlow !== null;
}

export function cancelCurrentMoodTake(
  reason: MoodRecordingCancelReason = "user",
): void {
  currentController?.abort(reason);
}

export function stopMoodTakeEarly(): boolean {
  const activeStop = currentStopController;
  if (!activeStop) return false;
  currentStopController = null;
  const stoppedAt = getAudioContext().currentTime;
  activeStop.stoppedAt = stoppedAt;
  useAppStore.getState().actions.setCaptureEndsAt(stoppedAt);
  activeStop.controller.stop();
  return true;
}

export function registerMoodRecordingInterrupt(): () => void {
  return registerRecordingInterruptHandler({
    isActive: isMoodRecordingInFlight,
    interrupt: (reason) => cancelCurrentMoodTake(reason),
  });
}

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

// The cycle a take snaps against: the piece's own, or for a first Click take
// the one its BPM and bars establish, so a first take may span up to four
// cycles like any overdub.
function snapCycleSeconds(piece: MoodPiece): number | null {
  if (piece.cycleSeconds !== null) return piece.cycleSeconds;
  if (piece.timeFeel === "click" && piece.bpm !== null && piece.cycleBars !== null) {
    return establishCycleFromClick(piece.bpm, piece.cycleBars);
  }
  return null;
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
      logger.warn(LOG_EVENTS.POSTER_CAPTURE_ERROR, {
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
  const { performance: performanceState } = state.mood;
  if (
    !piece ||
    piece.cycleSeconds === null ||
    !performanceState.isPerforming ||
    performanceState.epoch === null
  ) {
    return;
  }
  if (performanceState.selections[micId] !== takeId) return;
  if ((performanceState.armed[micId] ?? null) !== null) return;
  const now = Tone.now();
  armMoodSelectionCommit(
    { micId, entry: takeId },
    nextCycleBoundary(performanceState.epoch, piece.cycleSeconds, now),
    now,
  );
}

function firePartClassificationWhenReady(
  micId: string,
  take: MoodTake,
  isOne: boolean,
  signal: AbortSignal,
  options: {
    applyPartOnlyIfMissing?: boolean;
    retryBackfillOnMiss?: boolean;
  } = {},
): void {
  const state = useAppStore.getState();
  const expectedRevision = state.session.moodRevision;
  const expectedSessionId = state.session.moodSessionId;
  state.actions.setMoodPartChecking(take.id, true);
  void classifyPart(take, isOne, undefined, signal)
    .then((result) => {
      if (!result) {
        if (options.retryBackfillOnMiss && !signal.aborted) {
          backfilledOneTakeIds.delete(take.id);
        }
        return;
      }
      const actions = useAppStore.getState().actions;
      const currentPiece = useAppStore.getState().mood.piece;
      const currentTake = currentPiece
        ? findMoodTake(currentPiece, micId, take.id)
        : null;
      if (!options.applyPartOnlyIfMissing || currentTake?.part === null) {
        actions.applyMoodPartIfCurrent(
          micId,
          take.id,
          result.part,
          "ai",
          expectedRevision,
        );
      }
      if (result.artDirection) {
        actions.applyMoodArtDirectionIfCurrent(
          take.id,
          result.artDirection,
          expectedSessionId,
        );
      }
      if (result.keyEstimate) {
        actions.applyMoodKeyEstimateIfCurrent(
          take.id,
          result.keyEstimate,
          expectedSessionId,
        );
      }
    })
    .catch((err) => {
      logger.warn(LOG_EVENTS.MOOD_PART_MISS, {
        reason: "flow-error",
        takeId: take.id,
        message: errorMessage(err),
      });
    })
    .finally(() => {
      useAppStore.getState().actions.setMoodPartChecking(take.id, false);
    });
}

export function backfillMoodOneClassification(): void {
  const state = useAppStore.getState();
  if (state.playback.isExporting) return;
  const piece = state.mood.piece;
  if (!piece || !piece.oneMicId || !piece.oneTakeId) return;
  const oneTake = findMoodTake(piece, piece.oneMicId, piece.oneTakeId);
  if (!oneTake) return;
  if (piece.keyEstimate && piece.artDirection) return;
  if (oneTake.audioStatus !== "ok" || !oneTake.audioBuffer) return;
  if (backfilledOneTakeIds.has(oneTake.id)) return;

  backfillClassificationController?.abort();
  const controller = new AbortController();
  backfillClassificationController = controller;
  backfilledOneTakeIds.add(oneTake.id);
  firePartClassificationWhenReady(piece.oneMicId, oneTake, true, controller.signal, {
    applyPartOnlyIfMissing: true,
    retryBackfillOnMiss: true,
  });
}

async function recordWithEarlyStop(
  stream: MediaStream,
  capMs: number,
  audioContext: AudioContext,
  signal: AbortSignal,
) {
  const activeStop: ActiveMoodStopController = {
    controller: createRecordClipStopController(),
    startedAt: audioContext.currentTime,
    stoppedAt: null,
  };
  currentStopController = activeStop;
  try {
    return await recordClip(stream, capMs, audioContext, {
      signal,
      stopController: activeStop.controller,
    });
  } catch (error) {
    if (
      activeStop.stoppedAt !== null &&
      activeStop.stoppedAt >= activeStop.startedAt &&
      activeStop.stoppedAt - activeStop.startedAt <= INSTANT_PUNCH_OUT_SECONDS
    ) {
      throw new InstantMoodPunchOutError();
    }
    throw error;
  } finally {
    if (currentStopController === activeStop) currentStopController = null;
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
  actions.setLastTakeReceipt(null);
  actions.setRecordingState("preparing", null);
  suspendMoodPadsForCapture();
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
  let performanceStartedByFlow: { epoch: number } | null = null;
  let completed = false;

  if (!startingPiece) return false;
  const isOne = startingPiece.cycleSeconds === null;
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
        return reportMoodTakeFailure(options, AUDIO_UNAVAILABLE_COPY);
      }
      // As in Chop: ensureAudioRunning wraps every failure in
      // AudioUnavailableError, so a failed unlock always aborts the flow.
      // Rethrow so a future unwrapped error surfaces via the outer catch.
      throw e;
    }
    throwIfFlowAborted(signal, "Aborted before media acquisition");

    if (
      startingPiece.cycleSeconds !== null &&
      !useAppStore.getState().mood.performance.isPerforming
    ) {
      let started = false;
      try {
        started = await startMoodPerformanceForRecordingFlow();
      } finally {
        const performanceState = useAppStore.getState().mood.performance;
        if (performanceState.isPerforming && performanceState.epoch !== null) {
          performanceStartedByFlow = { epoch: performanceState.epoch };
        }
      }
      if (!started) return false;
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
        return reportMoodTakeFailure(
          options,
          isPermissionDenial(e) ? CAMERA_DENIED_COPY : ACQUIRE_FAILED_COPY,
        );
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
      return reportMoodTakeFailure(options, RECORDING_INTERRUPTED_COPY);
    }

    const audioContext = getAudioContext();
    const beatSeconds = countInBeatSeconds(startingPiece);
    let countdownEndsAt: number;
    if (startingPiece.cycleSeconds === null) {
      countdownEndsAt = audioContext.currentTime + COUNT_IN_BEATS * beatSeconds;
    } else {
      const performanceState = useAppStore.getState().mood.performance;
      if (!performanceState.isPerforming || performanceState.epoch === null) return false;
      countdownEndsAt = cycleCountdownDeadline(
        performanceState.epoch,
        startingPiece.cycleSeconds,
        audioContext.currentTime,
      );
    }
    const countInStartsAt = audioContext.currentTime;
    cancelCountInClicks = scheduleCountInClicks(
      countInStartsAt,
      countdownEndsAt,
      beatSeconds,
      startingPiece.cycleSeconds === null ? "first-take" : "overdub",
    );
    // The ticks sit on whole beats back from the punch-in, from the tap on.
    actions.setMoodCountInTicks(
      Math.floor((countdownEndsAt - countInStartsAt) / beatSeconds + 1e-9),
    );
    actions.setCountdownEndsAt(countdownEndsAt);
    actions.setRecordingState("countdown", null);

    await waitUntilAudioTime(countdownEndsAt, audioContext, signal);
    setCaptureGain(!useAppStore.getState().mood.monitorWithHeadphones);
    actions.setCaptureEndsAt(countdownEndsAt + capMs / 1000);
    actions.setRecordingState("recording", null);
    const result = await recordWithEarlyStop(stream, capMs, audioContext, signal);
    throwIfFlowAborted(signal, "Aborted after capture");
    actions.setRecordingState("reviewing", null);

    const trim = autoTrim(result.audioBuffer, capMs);
    const bufferDurationMs = Math.max(0, Math.round(result.audioBuffer.duration * 1000));
    const trimStartMs = Math.max(0, Math.min(trim.trimStartMs, bufferDurationMs));
    const trimEndFromContent = Math.max(
      trimStartMs,
      Math.min(trim.trimEndMs, bufferDurationMs),
    );
    const contentSeconds = Math.max(0, (trimEndFromContent - trimStartMs) / 1000);
    const snap = snapTake(contentSeconds, snapCycleSeconds(startingPiece));
    if (!snap.ok) {
      actions.setLastTakeReceipt({ kind: "too-short" });
      return false;
    }

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
    actions.setLastTakeReceipt({
      kind: "kept",
      seconds: take.durationSeconds,
      multiple: take.cycleMultiple,
    });
    actions.setRecordingState("idle", null);
    armSelection(micId, take.id);
    attachPosterWhenReady(micId, take.id, result.blob, signal);
    fireSyncAssistWhenReady(micId, take, signal);
    firePartClassificationWhenReady(micId, take, isOne, signal);
    completed = true;
    return true;
  } catch (e) {
    if (isFlowAbort(e, signal)) {
      cancelCountInClicks();
      if (getAbortReason(signal) === "interrupted") {
        actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
        reportMoodTakeFailure(options, RECORDING_INTERRUPTED_COPY);
      }
      return false;
    }
    if (e instanceof InstantMoodPunchOutError) {
      actions.setLastTakeReceipt({ kind: "too-short" });
      return false;
    }
    return reportMoodTakeFailure(options, errorMessage(e));
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
    actions.setCaptureEndsAt(null);
    actions.setRecordingState("idle", null);
    actions.setMoodHotMic(null);
    if (performanceStartedByFlow && !completed) {
      const performanceState = useAppStore.getState().mood.performance;
      if (
        performanceState.isPerforming &&
        performanceState.epoch === performanceStartedByFlow.epoch
      ) {
        stopMoodPerformance();
      }
    }
  }
}

export function __resetMoodRecordingFlowForTesting(): void {
  backfillClassificationController?.abort();
  backfillClassificationController = null;
  backfilledOneTakeIds.clear();
  currentController = null;
  currentFlow = null;
  currentStopController = null;
  setMoodRecordingPreviewStream(null);
}
