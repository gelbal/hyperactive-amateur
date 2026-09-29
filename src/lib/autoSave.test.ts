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
import { decodeMoodTakes, rehydrateMoodFromStorage } from "./moodRehydrate";
import { makeMoodTake } from "../test-utils/moodFixtures";

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
    await moodPersistence.clearMoodPiece();
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

  it("saveNow persists immediately and cancels the pending debounce timer", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setBpm(130);

    await saveNow();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].project.bpm).toBe(130);
    // The pending debounce timer is cancelled, not left to save again.
    expect(vi.getTimerCount()).toBe(0);
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

  it("a Chop scratch never writes or clears the saved Mood piece", async () => {
    vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    vi.spyOn(persistence, "clearProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    const clearMoodSpy = vi.spyOn(moodPersistence, "clearMoodPiece").mockResolvedValue(undefined);
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    startAutoSave();

    useAppStore.getState().actions.scratch();
    await vi.advanceTimersByTimeAsync(600);

    expect(clearMoodSpy).not.toHaveBeenCalled();
    expect(saveMoodSpy).not.toHaveBeenCalled();
  });

  it("debounces a stopped Mood selection commit with the current mix snapshot", async () => {
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-live" }));
    actions.commitMoodSelections([{ micId: "mic-0", entry: "take-live" }]);
    await __flushAutoSaveForTesting();
    saveMoodSpy.mockClear();

    actions.commitMoodSelections([{ micId: "mic-0", entry: "off" }]);
    await vi.advanceTimersByTimeAsync(600);

    expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    expect(saveMoodSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ "mic-0": "off" }),
    );
  });

  it("post-recording flush captures the auto-armed selection, not the pre-arm mix", async () => {
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-live" }));
    await __flushAutoSaveForTesting();
    saveMoodSpy.mockClear();
    actions.setRecordingState("recording", 0);
    actions.setMoodTake("mic-1", makeMoodTake({ id: "take-new" }));

    // Finalize order in the flow: idle first, arm on the next statement. The
    // flush must snapshot AFTER the arm lands.
    actions.setRecordingState("idle", null);
    actions.commitMoodSelections([{ micId: "mic-1", entry: "take-new" }]);
    await vi.advanceTimersByTimeAsync(600);

    expect(saveMoodSpy).toHaveBeenCalled();
    const lastCall = saveMoodSpy.mock.calls[saveMoodSpy.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({ "mic-1": "take-new" });
  });

  it("mid-recording saves omit the hot mic from the persisted mix", async () => {
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-live" }));
    actions.commitMoodSelections([{ micId: "mic-0", entry: "take-live" }]);
    await __flushAutoSaveForTesting();
    saveMoodSpy.mockClear();
    actions.setRecordingState("recording", 0);
    actions.setMoodHotMic("mic-1");
    actions.setMoodTake("mic-1", makeMoodTake({ id: "take-new" }));

    await saveNow("mood");

    expect(saveMoodSpy).toHaveBeenCalledTimes(1);
    const snapshot = saveMoodSpy.mock.calls[0][1] as Record<string, string>;
    expect(snapshot["mic-0"]).toBe("take-live");
    expect(snapshot).not.toHaveProperty("mic-1");
  });

  it("keeps performing-time Mood arms transient and out of autosave", async () => {
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-live" }));
    actions.commitMoodSelections([{ micId: "mic-0", entry: "take-live" }]);
    await __flushAutoSaveForTesting();
    saveMoodSpy.mockClear();

    actions.setMoodPerforming(true, 4);
    actions.armMoodSelection("mic-0", "off");
    await vi.advanceTimersByTimeAsync(600);

    expect(saveMoodSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["Stop", () => useAppStore.getState().actions.setMoodPerforming(false)],
    ["a switch to Chop", () => useAppStore.getState().actions.setAppMode("chop")],
  ])("stopping a performance through %s saves the mix it committed", async (_label, stop) => {
    vi.useRealTimers();
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.setAppMode("mood");
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-live" }));
    actions.commitMoodSelections([{ micId: "mic-0", entry: "take-live" }]);
    await __flushAutoSaveForTesting();

    actions.setMoodPerforming(true, 4);
    actions.commitMoodSelections([{ micId: "mic-0", entry: "off" }]);
    stop();
    expect(useAppStore.getState().mood.performance.isPerforming).toBe(false);
    await __flushAutoSaveForTesting();
    stopAutoSave();
    actions.reset();

    const loaded = await rehydrateMoodFromStorage();
    if (!loaded.ok || !loaded.piece) throw new Error("Expected a saved Mood piece");
    expect(loaded.piece.savedSelections?.["mic-0"]).toBe("off");
  });

  it("round-trips an off mic through the real Mood save and rehydrate path", async () => {
    vi.useRealTimers();
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-live" }));
    actions.commitMoodSelections([{ micId: "mic-0", entry: "take-live" }]);
    actions.commitMoodSelections([{ micId: "mic-0", entry: "off" }]);
    await __flushAutoSaveForTesting();
    stopAutoSave();
    actions.reset();

    const loaded = await rehydrateMoodFromStorage();
    if (!loaded.ok || !loaded.piece) throw new Error("Expected a saved Mood piece");
    const decoded = await decodeMoodTakes(loaded.piece, {
      decodeAudioData: vi
        .fn()
        .mockResolvedValue({ duration: 2, sampleRate: 48_000 } as AudioBuffer),
    });
    useAppStore.getState().actions.hydrateMoodPiece(decoded.piece);

    expect(useAppStore.getState().mood.piece?.savedSelections).toEqual({
      "mic-0": "off",
      "mic-1": "off",
    });
    expect(useAppStore.getState().mood.performance.selections["mic-0"]).toBe("off");
  });

  it("retries a failed Mood scratch clear on the next save", async () => {
    vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    const clearMoodSpy = vi
      .spyOn(moodPersistence, "clearMoodPiece")
      .mockRejectedValueOnce(new Error("database connection is closing"))
      .mockResolvedValue(undefined);
    useAppStore.getState().actions.createMoodPiece("row", "pocket");
    startAutoSave();

    useAppStore.getState().actions.scratchMoodPiece();
    await vi.advanceTimersByTimeAsync(600);
    expect(clearMoodSpy).toHaveBeenCalledTimes(1);

    // Any later save carries the owed clear.
    useAppStore.getState().actions.setBpm(130);
    await vi.advanceTimersByTimeAsync(600);
    expect(clearMoodSpy).toHaveBeenCalledTimes(2);
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

  it("saveNow(\"mood\") writes nothing while the saved mood could not be opened", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    startAutoSave();
    useAppStore.getState().actions.setMoodHydration("failed");
    useAppStore.getState().actions.createMoodPiece("row", "pocket");

    await expect(saveNow("mood")).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(600);

    expect(saveMoodSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("a scoped saveNow leaves another scope's pending change on its debounce", async () => {
    const saveMoodSpy = vi.spyOn(moodPersistence, "saveMoodPiece").mockResolvedValue(undefined);
    vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("row", "pocket");
    await __flushAutoSaveForTesting();
    saveMoodSpy.mockClear();

    // A Mood change, then a Chop clip's durability save before the debounce.
    actions.setMoodTake("mic-0", makeMoodTake({ id: "take-late" }));
    actions.setBpm(128);
    await saveNow("chop");
    expect(saveMoodSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(saveMoodSpy).toHaveBeenCalledTimes(1);
  });

  it("a scoped saveNow of a paused scope leaves another scope's pending save on its timer", async () => {
    const saveSpy = vi.spyOn(persistence, "saveProject").mockResolvedValue(undefined);
    startAutoSave();
    // Mood's saved record could not be opened: its saving stays paused.
    useAppStore.getState().actions.setMoodHydration("failed");
    useAppStore.getState().actions.setBpm(131);

    await expect(saveNow("mood")).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(600);

    expect(saveSpy).toHaveBeenCalledTimes(1);
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

  it("saveNow resolves false before autosave has started", async () => {
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

    // Autosave starts once the load settles; the next immediate save persists.
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

  it("shutdownAutoSave still writes a change queued behind an in-flight save", async () => {
    const firstSave = makeDeferred();
    const savedBpm: number[] = [];
    vi.spyOn(persistence, "saveProject").mockImplementation(async (state) => {
      savedBpm.push(state.project.bpm);
      if (savedBpm.length === 1) await firstSave.promise;
    });

    startAutoSave();
    useAppStore.getState().actions.setBpm(150);
    const first = saveNow();
    expect(savedBpm).toEqual([150]);

    // A newer change lands, then a clean shutdown fires while the first save is
    // still in flight. flushPending queues the change behind the in-flight
    // drain; stopAutoSave must not discard it — a clean shutdown is a flush.
    useAppStore.getState().actions.setBpm(151);
    shutdownAutoSave();

    firstSave.resolve();
    await first;

    expect(savedBpm).toEqual([150, 151]);
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
