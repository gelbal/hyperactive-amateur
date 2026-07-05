// ABOUTME: Verified Web Audio lifecycle helpers for gesture-started audible actions.
// ABOUTME: Waits for AudioContext running state before callers claim sound is available.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { getAudioContext, stopPlayback } from "./audio";
import { abortActiveExport } from "./exportSession";
import { LOG_EVENTS, logger } from "./logger";

const RUNNING_WAIT_TIMEOUT_MS = 500;
const RUNNING_POLL_MS = 100;
const EXPORT_AUDIO_INTERRUPTED_REASON =
  "Audio was interrupted — rendering stopped. Tap Render to try again.";
let hasStartedAudibleAction = false;
let micHeld = false;
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

function setSessionType(type: AudioSessionLike["type"]): void {
  if (typeof navigator === "undefined" || !navigator.audioSession) return;
  try {
    navigator.audioSession.type = type;
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
  setSessionType("play-and-record");
}

export function noteMicReleased(): void {
  micHeld = false;
  if (hasStartedAudibleAction) setSessionType("playback");
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
    if (!micHeld) setSessionType("playback");
    await Tone.start();
    const context = getAudioContext();
    if (context.state !== "running") {
      await waitForRunning(context);
    }
    hasStartedAudibleAction = true;
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

    const { playback } = useAppStore.getState();
    if (!playback.isPlaying && !playback.isExporting) return;

    logger.warn(LOG_EVENTS.AUDIO_INTERRUPTED, {
      state: context.state,
      wasExporting: playback.isExporting,
      wasPlaying: playback.isPlaying,
    });

    if (playback.isExporting) {
      abortActiveExport(EXPORT_AUDIO_INTERRUPTED_REASON);
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
  hasStartedAudibleAction = false;
  micHeld = false;
  silentSwitchHintReady = false;
  silentSwitchHintDismissed = false;
}
