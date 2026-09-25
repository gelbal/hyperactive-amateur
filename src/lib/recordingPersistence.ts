// ABOUTME: Shared post-recording persistence request boundary for saved captures.
// ABOUTME: Coalesces durable-storage requests across Chop and Mood successful saves.
import { useAppStore } from "../store/useAppStore";
import { requestPersistence } from "./install";

// Durable-storage request state. The request anchors to the first SUCCESSFUL
// clip save and retries on later successful saves until the browser answers
// (granted or definitively denied); an "unknown" outcome stays retryable.
// Requests are single-flight: saves that land while one is still pending
// coalesce into it instead of issuing overlapping persist() calls.
let persistenceRequestSettled = false;
let persistenceRequestPending = false;

export function requestPersistenceAfterClipSave(): void {
  if (persistenceRequestSettled || persistenceRequestPending) return;
  if (useAppStore.getState().session.storageDurability === "persistent") {
    persistenceRequestSettled = true;
    return;
  }
  persistenceRequestPending = true;
  void requestPersistence().then((storageDurability) => {
    persistenceRequestPending = false;
    if (storageDurability !== "unknown") persistenceRequestSettled = true;
    useAppStore.getState().actions.setStorageDurability(storageDurability);
  });
}

// Test-only — clears the settled persistence-request state between cases.
export function __resetPersistenceRequestForTesting(): void {
  persistenceRequestSettled = false;
  persistenceRequestPending = false;
}
