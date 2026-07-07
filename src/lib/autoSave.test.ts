// ABOUTME: autoSave tests — debounce coalesces rapid changes; recording state suppresses writes.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import * as persistence from "./persistence";
import * as moodPersistence from "./moodPersistence";
import {
  __flushAutoSaveForTesting,
  flushPending,
  saveNow,
  shutdownAutoSave,
  startAutoSave,
  stopAutoSave,
} from "./autoSave";
import { useAppStore } from "../store/useAppStore";
import { loadProject, clearProject } from "./persistence";
import { clearLogs, getLogs, LOG_EVENTS } from "./logger";

function makeDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = (value) => res(value as T | PromiseLike<T>);
  });
  return { promise, resolve };
}

describe("autoSave", () => {
  beforeEach(async () => {
    stopAutoSave();
    useAppStore.getState().actions.reset();
    await clearProject();
    clearLogs();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    stopAutoSave();
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

  it("saveNow persists immediately without waiting for the debounce window", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(130);

    await saveNow();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].project.bpm).toBe(130);
  });

  it("mood piece changes debounce into a mood save without writing Chop", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();

    useAppStore.getState().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
    await vi.advanceTimersByTimeAsync(600);

    expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    expect(saveMoodSpy.mock.calls[0][0]).toMatchObject({
      stage: "row",
      timeFeel: "click",
      bpm: 120,
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("Chop and Mood dirty scopes coalesce independently", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();

    useAppStore.getState().actions.setBpm(122);
    await vi.advanceTimersByTimeAsync(600);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveMoodSpy).not.toHaveBeenCalled();

    saveSpy.mockClear();
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    await vi.advanceTimersByTimeAsync(600);
    expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("saveNow(\"mood\") persists only the mood piece immediately", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.createMoodPiece("stack", "pocket");

    await expect(saveNow("mood")).resolves.toBe(true);

    expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    expect(saveMoodSpy.mock.calls[0][0]).toMatchObject({ stage: "stack" });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saveNow(\"mood\") skips a degraded mood pause and writes nothing", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore
      .getState()
      .actions.setRecoveryWarningsForScope(
        "mood",
        ["Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."],
        true,
      );
    useAppStore.getState().actions.createMoodPiece("row", "pocket");

    await expect(saveNow("mood")).resolves.toBe(false);

    expect(saveMoodSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("saveNow during the debounce window cancels the pending timer", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(131);

    await saveNow();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saveNow skips the write while autosave is paused (degraded load) and resolves false", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject");
    useAppStore.getState().actions.setBpm(160);

    await expect(saveNow()).resolves.toBe(false);

    expect(saveSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
    expect(await loadProject()).toBeNull();
  });

  it("re-enabling autosave lets the next immediate save persist state changed during the pause", async () => {
    vi.useRealTimers();
    useAppStore.getState().actions.setBpm(161);
    await expect(saveNow()).resolves.toBe(false);

    // RecoveryBanner acknowledgment re-enables saving via startAutoSave().
    startAutoSave();
    await expect(saveNow()).resolves.toBe(true);

    expect((await loadProject())?.bpm).toBe(161);
  });

  it("concurrent saveNow calls coalesce behind the in-flight save and write latest state once", async () => {
    const firstSave = makeDeferred();
    const savedBpm: number[] = [];
    vi.spyOn(persistence, "saveProject").mockImplementation(async (state) => {
      savedBpm.push(state.project.bpm);
      if (savedBpm.length === 1) await firstSave.promise;
    });

    startAutoSave();
    useAppStore.getState().actions.setBpm(132);
    const first = saveNow();
    expect(savedBpm).toEqual([132]);

    useAppStore.getState().actions.setBpm(133);
    const second = saveNow();
    expect(savedBpm).toEqual([132]);

    firstSave.resolve();
    await Promise.all([first, second]);

    expect(savedBpm).toEqual([132, 133]);
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

  it("does not save a mood piece while recording is in progress", async () => {
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    await vi.advanceTimersByTimeAsync(600);

    expect(saveMoodSpy).not.toHaveBeenCalled();

    useAppStore.getState().actions.setRecordingState("idle", null);
    await vi.waitFor(() => {
      expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("flushPending flushes a pending debounce best-effort and no-ops when clean", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(151);

    expect(flushPending()).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].project.bpm).toBe(151);
    expect(getLogs().some((entry) => entry.event === LOG_EVENTS.AUTOSAVE_FLUSH)).toBe(true);

    saveSpy.mockClear();
    expect(flushPending()).toBe(false);
    await Promise.resolve();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("flushPending flushes pending Chop and Mood saves through the shared drain", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(155);
    useAppStore.getState().actions.createMoodPiece("row", "pocket");

    expect(flushPending()).toBe(true);

    await vi.waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("shutdownAutoSave flushes a pending debounced change before detaching", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(152);

    shutdownAutoSave();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].project.bpm).toBe(152);
    // Detached: later store changes schedule nothing.
    useAppStore.getState().actions.setBpm(153);
    await vi.advanceTimersByTimeAsync(600);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("stopAutoSave drops pending work without writing (destructive pause)", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(154);

    stopAutoSave();
    await vi.advanceTimersByTimeAsync(600);

    expect(saveSpy).not.toHaveBeenCalled();
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
