// ABOUTME: Shared offline copy and feature checks for AI controls.
// ABOUTME: Keeps transport-specific GeminiOfflineError rendering consistent across components.
import { GeminiOfflineError } from "./aiErrors";

export const AI_OFFLINE_COPY = "AI needs an internet connection.";

export function aiErrorMessage(error: unknown): string {
  if (error instanceof GeminiOfflineError) return AI_OFFLINE_COPY;
  return error instanceof Error ? error.message : String(error);
}

export function aiOfflineHint(): string | null {
  return navigator.onLine === false ? AI_OFFLINE_COPY : null;
}
