// ABOUTME: autoSave tests — debounce coalesces rapid changes; recording state suppresses writes.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { __flushAutoSaveForTesting, startAutoSave, stopAutoSave } from "./autoSave";
import { useAppStore } from "../store/useAppStore";
import { loadProject, clearProject } from "./persistence";

describe("autoSave", () => {
  beforeEach(async () => {
    stopAutoSave();
    useAppStore.getState().actions.reset();
    await clearProject();
    vi.useFakeTimers();
  });

  async function waitForPersistedBpm(bpm: number): Promise<void> {
    await vi.waitFor(async () => {
      expect((await loadProject())?.bpm).toBe(bpm);
    });
  }

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

  it("flushes project changes made during recording once recording returns idle", async () => {
    startAutoSave();
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setBpm(140);

    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    expect(await loadProject()).toBeNull();

    useAppStore.getState().actions.setRecordingState("idle", null);
    await waitForPersistedBpm(140);

    const loaded = await loadProject();
    expect(loaded?.bpm).toBe(140);
  });

  it("test flush marks an active recording dirty instead of saving partial state", async () => {
    startAutoSave();
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setBpm(150);

    await __flushAutoSaveForTesting();
    vi.useRealTimers();
    expect(await loadProject()).toBeNull();

    useAppStore.getState().actions.setRecordingState("idle", null);
    await waitForPersistedBpm(150);

    expect((await loadProject())?.bpm).toBe(150);
  });
});
