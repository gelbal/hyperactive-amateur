// ABOUTME: Verified Web Audio lifecycle helpers for gesture-started audible actions.
// ABOUTME: Waits for AudioContext running state before callers claim sound is available.
import * as Tone from "tone";
import { getAudioContext } from "./audio";

const RUNNING_WAIT_TIMEOUT_MS = 500;
const RUNNING_POLL_MS = 100;

export class AudioUnavailableError extends Error {
  constructor(message = "AudioContext did not reach running state.") {
    super(message);
    this.name = "AudioUnavailableError";
  }
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
  await Tone.start();
  const context = getAudioContext();
  if (context.state === "running") return;
  await waitForRunning(context);
}
