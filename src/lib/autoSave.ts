// ABOUTME: autoSave — subscribes to the store and persists project changes after a 500ms idle.
// ABOUTME: Skips saving while recording is active to avoid persisting half-built state.
import { useAppStore } from "../store/useAppStore";
import { saveProject } from "./persistence";

const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const state = useAppStore.getState();
    if (state.recording.state !== "idle") return;
    void saveProject(state);
  }, DEBOUNCE_MS);
}

export function startAutoSave(): void {
  if (unsubscribe) return;
  unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project !== prev.project) scheduleSave();
  });
}

export function stopAutoSave(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// Test-only flush of any pending debounced save.
export async function __flushAutoSaveForTesting(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    const state = useAppStore.getState();
    if (state.recording.state === "idle") await saveProject(state);
  }
}
