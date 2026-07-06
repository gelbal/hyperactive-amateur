// ABOUTME: autoSave — subscribes to the store and persists project changes after a 500ms idle.
// ABOUTME: Defers saves while recording is active, then flushes the latest complete state.
import { useAppStore } from "../store/useAppStore";
import { saveProject } from "./persistence";
import { logger, LOG_EVENTS } from "./logger";

const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let dirtyWhileRecording = false;
let saveInProgress: Promise<void> | null = null;
let saveQueued = false;

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

async function drainSaveQueue(): Promise<void> {
  let firstError: unknown = null;
  do {
    saveQueued = false;
    try {
      await persistLatest();
    } catch (err) {
      if (!firstError) firstError = err;
    }
  } while (saveQueued);
  if (firstError) throw firstError;
}

function requestSave(): Promise<void> {
  saveQueued = true;
  if (!saveInProgress) {
    saveInProgress = drainSaveQueue().finally(() => {
      saveInProgress = null;
    });
  }
  return saveInProgress;
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
  void requestSave().catch(() => undefined);
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
    void requestSave().catch(() => undefined);
  }, DEBOUNCE_MS);
}

// Immediate save for durability boundaries (e.g. a freshly captured clip).
// Respects the same allow-gate as debounced autosave: while autosave is
// stopped or paused (degraded loads), the write is skipped so the repaired
// state cannot overwrite the protected original. Resolves false for a skipped
// save so callers do not treat it as persisted; the state stays in memory and
// the next save after autosave resumes persists everything.
export function saveNow(): Promise<boolean> {
  if (!unsubscribe) return Promise.resolve(false);
  clearPendingTimer();
  dirtyWhileRecording = false;
  return requestSave().then(() => true);
}

export function flushPending(): boolean {
  const hasPendingSave = timer !== null || dirtyWhileRecording;
  if (!hasPendingSave) return false;
  clearPendingTimer();
  dirtyWhileRecording = false;
  logger.info(LOG_EVENTS.AUTOSAVE_FLUSH);
  void requestSave().catch(() => undefined);
  return true;
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

// Destructive pause: drops any pending debounced write on purpose. Use when
// saving could overwrite a protected original (degraded loads, tests).
export function stopAutoSave(): void {
  clearPendingTimer();
  dirtyWhileRecording = false;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// Clean shutdown: best-effort flush of any pending debounced work, then
// detach. Use when autosave ends without a data-safety reason to drop edits.
export function shutdownAutoSave(): void {
  flushPending();
  stopAutoSave();
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
  await requestSave();
}
