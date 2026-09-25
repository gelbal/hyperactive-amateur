// ABOUTME: autoSave — subscribes to the store and persists Chop/Mood changes after a 500ms idle.
// ABOUTME: Defers saves while recording is active, then flushes each latest complete scope.
import { useAppStore } from "../store/useAppStore";
import { saveProject } from "./persistence";
import { clearMoodPiece, saveMoodPiece } from "./moodPersistence";
import { logger, LOG_EVENTS } from "./logger";

const DEBOUNCE_MS = 500;
const AUTO_SAVE_SCOPES = ["chop", "mood"] as const;

type AutoSaveScope = (typeof AUTO_SAVE_SCOPES)[number];
type SaveNowScope = AutoSaveScope | "all";
type ScopeFlags = Record<AutoSaveScope, boolean>;

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let saveInProgress: Promise<void> | null = null;
const dirtyScopes: ScopeFlags = { chop: false, mood: false };
const dirtyWhileRecording: ScopeFlags = { chop: false, mood: false };
const queuedScopes: ScopeFlags = { chop: false, mood: false };
const pausedScopes: ScopeFlags = { chop: false, mood: false };

function reportSaveError(err: unknown): void {
  logger.error(LOG_EVENTS.AUTOSAVE_ERROR, {
    message: err instanceof Error ? err.message : String(err),
  });
}

function scopesWithFlag(flags: ScopeFlags): AutoSaveScope[] {
  return AUTO_SAVE_SCOPES.filter((scope) => flags[scope]);
}

function hasFlaggedScope(flags: ScopeFlags): boolean {
  return AUTO_SAVE_SCOPES.some((scope) => flags[scope]);
}

function clearFlags(flags: ScopeFlags): void {
  for (const scope of AUTO_SAVE_SCOPES) flags[scope] = false;
}

// Chop never pauses: its autosave only starts once the Chop load resolved.
// Mood loads lazily, so a Mood record that could not be opened pauses the
// Mood scope for the session; a write would replace it with a new piece.
function syncPausedScopes(): void {
  pausedScopes.chop = false;
  pausedScopes.mood = useAppStore.getState().mood.hydration === "failed";
}

function unpausedScopes(scopes: AutoSaveScope[]): AutoSaveScope[] {
  return scopes.filter((scope) => !pausedScopes[scope]);
}

function pendingScopes(): AutoSaveScope[] {
  return AUTO_SAVE_SCOPES.filter((scope) => dirtyScopes[scope] || dirtyWhileRecording[scope]);
}

function requestedScopes(scope: SaveNowScope): AutoSaveScope[] {
  if (scope !== "all") return [scope];
  const pending = pendingScopes();
  return pending.length > 0 ? pending : ["chop"];
}

function markDirty(scope: AutoSaveScope): void {
  dirtyScopes[scope] = true;
  scheduleSave();
}

function persistScope(scope: AutoSaveScope): Promise<void> {
  const state = useAppStore.getState();
  const write =
    scope === "chop"
      ? saveProject(state)
      : state.mood.piece
        ? saveMoodPiece(state.mood.piece)
        : clearMoodPiece();
  return write.catch((err: unknown) => {
    reportSaveError(err);
    throw err;
  });
}

async function drainSaveQueue(): Promise<void> {
  let firstError: unknown = null;
  while (hasFlaggedScope(queuedScopes)) {
    const scopes = scopesWithFlag(queuedScopes);
    clearFlags(queuedScopes);
    for (const scope of scopes) {
      dirtyScopes[scope] = false;
      dirtyWhileRecording[scope] = false;
    }
    for (const scope of scopes) {
      try {
        await persistScope(scope);
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
  }
  if (firstError) throw firstError;
}

function requestSave(scopes: AutoSaveScope[]): Promise<void> {
  const savableScopes = unpausedScopes(scopes);
  if (savableScopes.length === 0) return saveInProgress ?? Promise.resolve();
  for (const scope of savableScopes) queuedScopes[scope] = true;
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
  const scopes = scopesWithFlag(dirtyWhileRecording);
  if (scopes.length === 0) return;
  const state = useAppStore.getState();
  if (state.recording.state !== "idle") return;
  clearPendingTimer();
  void requestSave(scopes).catch(() => undefined);
}

function scheduleSave(): void {
  clearPendingTimer();
  timer = setTimeout(() => {
    timer = null;
    const state = useAppStore.getState();
    if (state.recording.state !== "idle") {
      for (const scope of pendingScopes()) dirtyWhileRecording[scope] = true;
      return;
    }
    void requestSave(pendingScopes()).catch(() => undefined);
  }, DEBOUNCE_MS);
}

// Immediate save for durability boundaries (e.g. a freshly captured clip).
// Respects the same gate as debounced autosave: before autosave has started
// (the load has not settled, or it failed after its retries) or while a scope
// is paused (its saved record could not be opened), the write is skipped.
// Resolves false for a skipped save so callers do not treat it as persisted;
// the state stays in memory and the next save that runs persists everything.
export function saveNow(scope: SaveNowScope = "all"): Promise<boolean> {
  if (!unsubscribe) return Promise.resolve(false);
  clearPendingTimer();
  syncPausedScopes();
  const savableScopes = unpausedScopes(requestedScopes(scope));
  if (savableScopes.length === 0) {
    return (saveInProgress ?? Promise.resolve()).then(() => false);
  }
  return requestSave(savableScopes).then(() => true);
}

export function flushPending(): boolean {
  syncPausedScopes();
  const savableScopes = unpausedScopes(pendingScopes());
  if (timer === null && savableScopes.length === 0) return false;
  clearPendingTimer();
  if (savableScopes.length === 0) return false;
  logger.info(LOG_EVENTS.AUTOSAVE_FLUSH);
  void requestSave(savableScopes).catch(() => undefined);
  return true;
}

export function startAutoSave(): void {
  if (unsubscribe) return;
  syncPausedScopes();
  unsubscribe = useAppStore.subscribe((state, prev) => {
    syncPausedScopes();
    if (state.project !== prev.project) markDirty("chop");
    if (state.mood.piece !== prev.mood.piece) markDirty("mood");
    if (prev.recording.state !== "idle" && state.recording.state === "idle") {
      flushAfterRecordingIfNeeded();
    }
  });
}

// Destructive stop: drops any pending debounced write on purpose. Use when
// saving must not happen (tests, teardown without a flush).
export function stopAutoSave(): void {
  clearPendingTimer();
  clearFlags(dirtyScopes);
  clearFlags(dirtyWhileRecording);
  clearFlags(pausedScopes);
  // Only discard queued scopes when nothing is draining. A clean shutdown
  // (flushPending -> stopAutoSave) queues a last change behind an in-flight
  // save; that drain must still write it to disk. When a save is in flight
  // the running drain owns queuedScopes and clears each as it persists it.
  if (!saveInProgress) clearFlags(queuedScopes);
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
    for (const scope of pendingScopes()) dirtyWhileRecording[scope] = true;
    return;
  }
  syncPausedScopes();
  const savableScopes = unpausedScopes(pendingScopes());
  if (savableScopes.length === 0) return;
  await requestSave(savableScopes);
}
