// ABOUTME: autoSave — subscribes to the store and persists project changes after a 500ms idle.
// ABOUTME: Defers saves while recording is active, then flushes the latest complete state.
import { useAppStore } from "../store/useAppStore";
import { saveProject } from "./persistence";
import { logger, LOG_EVENTS } from "./logger";

const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let dirtyWhileRecording = false;

function reportSaveError(err: unknown): void {
  logger.error(LOG_EVENTS.AUTOSAVE_ERROR, {
    message: err instanceof Error ? err.message : String(err),
  });
}

function persistLatest(): Promise<void> {
  return saveProject(useAppStore.getState()).catch((err: unknown) => {
    reportSaveError(err);
    throw err;
  });
}

function clearPendingTimer(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}

function flushAfterRecordingIfNeeded(): void {
  if (!dirtyWhileRecording) return;
  const state = useAppStore.getState();
  if (state.recording.state !== "idle") return;
  dirtyWhileRecording = false;
  clearPendingTimer();
  void persistLatest().catch(() => undefined);
}

function scheduleSave(): void {
  clearPendingTimer();
  timer = setTimeout(() => {
    timer = null;
    const state = useAppStore.getState();
    if (state.recording.state !== "idle") {
      dirtyWhileRecording = true;
      return;
    }
    void persistLatest().catch(() => undefined);
  }, DEBOUNCE_MS);
}

export function startAutoSave(): void {
  if (unsubscribe) return;
  unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project !== prev.project) scheduleSave();
    if (prev.recording.state !== "idle" && state.recording.state === "idle") {
      flushAfterRecordingIfNeeded();
    }
  });
}

export function stopAutoSave(): void {
  clearPendingTimer();
  dirtyWhileRecording = false;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// Test-only flush of any pending debounced save.
export async function __flushAutoSaveForTesting(): Promise<void> {
  clearPendingTimer();
  const state = useAppStore.getState();
  if (state.recording.state !== "idle") {
    dirtyWhileRecording = true;
    return;
  }
  dirtyWhileRecording = false;
  await persistLatest();
}
