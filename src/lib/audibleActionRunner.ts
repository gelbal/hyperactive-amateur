// ABOUTME: Fire-and-forget wrapper for UI-triggered audible action promises.
// ABOUTME: Keeps expected audio-unlock failures off the unhandled-rejection path.
import { AudioUnavailableError } from "./audioLifecycle";
import { LOG_EVENTS, logger } from "./logger";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function runAudibleAction(promise: Promise<unknown>): void {
  void promise.catch((err: unknown) => {
    if (err instanceof AudioUnavailableError) return;
    logger.error(LOG_EVENTS.AUDIO_ACTION_ERROR, { message: errorMessage(err) });
  });
}
