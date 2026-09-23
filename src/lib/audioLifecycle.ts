// ABOUTME: Verified Web Audio lifecycle helpers for gesture-started audible actions.
// ABOUTME: Waits for AudioContext running state before callers claim sound is available.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { getAudioContext, stopPlayback } from "./audio";
import { abortActiveExport } from "./exportSession";
import { LOG_EVENTS, logger } from "./logger";
import { interruptActiveRecording } from "./recordingInterrupt";

const RUNNING_WAIT_TIMEOUT_MS = 500;
const RUNNING_POLL_MS = 100;
const EXPORT_AUDIO_INTERRUPTED_REASON =
  "Audio was interrupted — rendering stopped. Tap Render to try again.";
// The audio session type is derived from three facts and written from one
// place. WebKit rejects every audio getUserMedia while the page's type is
// "playback" (MediaDevices.cpp: InvalidStateError "AudioSession category is
// not compatible with audio capture."), so the type must already be
// "play-and-record" before a capture call — hence acquires are counted, not
// just held streams. "playback" keeps Web Audio audible with the ringer
// switch on; "auto" is the platform default when nothing is claimed.
let micHeld = false;
let pendingAcquires = 0;
let playbackDeclared = false;
let lastSessionType: AudioSessionLike["type"] | null = null;
let silentSwitchHintReady = false;
let silentSwitchHintDismissed = false;

export class AudioUnavailableError extends Error {
  constructor(message = "AudioContext did not reach running state.", options?: ErrorOptions) {
    super(message, options);
    this.name = "AudioUnavailableError";
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isDocumentHidden(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || document.hidden;
}

function desiredSessionType(): AudioSessionLike["type"] {
  if (micHeld || pendingAcquires > 0) return "play-and-record";
  if (playbackDeclared) return "playback";
  return "auto";
}

// Writes the derived type only when it changed; a null last write counts as
// the platform default ("auto"), so nothing is written until a claim exists.
function syncSessionType(): void {
  if (typeof navigator === "undefined" || !navigator.audioSession) return;
  const type = desiredSessionType();
  if (type === (lastSessionType ?? "auto")) return;
  try {
    navigator.audioSession.type = type;
    lastSessionType = type;
  } catch (err) {
    logger.error(LOG_EVENTS.AUDIO_SESSION_ERROR, { message: errMessage(err), type });
  }
}

function canOfferSilentSwitchHint(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.maxTouchPoints > 0 &&
    !("audioSession" in navigator)
  );
}

export function noteMicHeld(): void {
  micHeld = true;
  syncSessionType();
}

export function noteMicReleased(): void {
  micHeld = false;
  syncSessionType();
}

// Bracket every getUserMedia call (and a record flow that will make one) so
// the type is capture-compatible before the call, not after it resolves.
// Returns the claim's own release, idempotent, so an acquire that is
// invalidated (playback started, page hidden) can drop its claim at once
// while the native call is still pending, and the late settle is a no-op.
export function noteMicAcquireStarted(): () => void {
  pendingAcquires += 1;
  syncSessionType();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingAcquires = Math.max(0, pendingAcquires - 1);
    syncSessionType();
  };
}

async function waitForRunning(context: AudioContext): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let onStateChange: (() => void) | null = null;

  const cleanup = () => {
    if (onStateChange) {
      context.removeEventListener("statechange", onStateChange);
      onStateChange = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const checkRunning = () => {
        if (context.state === "running") resolve();
      };

      onStateChange = () => checkRunning();
      context.addEventListener("statechange", onStateChange);
      intervalId = setInterval(checkRunning, RUNNING_POLL_MS);
      timeoutId = setTimeout(() => {
        if (context.state === "running") {
          resolve();
          return;
        }
        reject(new AudioUnavailableError());
      }, RUNNING_WAIT_TIMEOUT_MS);
      checkRunning();
    });
  } finally {
    cleanup();
  }
}

export async function ensureAudioRunning(): Promise<void> {
  try {
    // Declared before the unlock so the first write keeps today's timing;
    // a held or pending capture keeps "play-and-record" regardless.
    playbackDeclared = true;
    syncSessionType();
    await Tone.start();
    const context = getAudioContext();
    if (context.state !== "running") {
      await waitForRunning(context);
    }
    if (canOfferSilentSwitchHint() && !silentSwitchHintDismissed) {
      silentSwitchHintReady = true;
    }
    useAppStore.getState().actions.setAudioState("running");
  } catch (err) {
    useAppStore.getState().actions.setAudioState("resume-required");
    if (err instanceof AudioUnavailableError) throw err;
    throw new AudioUnavailableError(undefined, { cause: err });
  }
}

export function initAudioLifecycle(): () => void {
  const context = getAudioContext();
  const onStateChange = () => {
    if (context.state === "running") return;

    const recordingInterrupted = interruptActiveRecording("interrupted");
    const { playback } = useAppStore.getState();
    if (!recordingInterrupted && !playback.isPlaying && !playback.isExporting) return;

    logger.warn(LOG_EVENTS.AUDIO_INTERRUPTED, {
      state: context.state,
      wasExporting: playback.isExporting,
      wasPlaying: playback.isPlaying,
    });

    if (playback.isExporting) {
      if (!isDocumentHidden()) {
        abortActiveExport(EXPORT_AUDIO_INTERRUPTED_REASON);
      }
      stopPlayback({ allowExportStop: true });
    } else if (playback.isPlaying) {
      stopPlayback();
    }

    useAppStore.getState().actions.setAudioState("resume-required");
  };

  context.addEventListener("statechange", onStateChange);
  return () => {
    context.removeEventListener("statechange", onStateChange);
  };
}

export function shouldShowSilentSwitchHint(): boolean {
  return silentSwitchHintReady && !silentSwitchHintDismissed && canOfferSilentSwitchHint();
}

export function markSilentSwitchHintDismissed(): void {
  silentSwitchHintDismissed = true;
  silentSwitchHintReady = false;
}

export function __resetAudioLifecycleForTesting(): void {
  micHeld = false;
  pendingAcquires = 0;
  playbackDeclared = false;
  lastSessionType = null;
  silentSwitchHintReady = false;
  silentSwitchHintDismissed = false;
}
