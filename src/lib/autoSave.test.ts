// ABOUTME: autoSave tests — debounce coalesces rapid changes; recording state suppresses writes.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { startAutoSave, stopAutoSave } from "./autoSave";
import { useAppStore } from "../store/useAppStore";
import { loadProject, clearProject } from "./persistence";

describe("autoSave", () => {
  beforeEach(async () => {
    stopAutoSave();
    useAppStore.getState().actions.reset();
    await clearProject();
    vi.useFakeTimers();
  });

  it("rapid changes within 500ms produce one save", async () => {
    startAutoSave();
    useAppStore.getState().actions.setBpm(100);
    useAppStore.getState().actions.setBpm(110);
    useAppStore.getState().actions.setBpm(120);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    const loaded = await loadProject();
    expect(loaded?.bpm).toBe(120);
  });

  it("does not save while recording is in progress", async () => {
    startAutoSave();
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setBpm(140);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    const loaded = await loadProject();
    expect(loaded).toBeNull();
  });
});
