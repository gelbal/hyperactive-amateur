// ABOUTME: Mood save-safety tests — real autosave and Mood persistence on fake IndexedDB.
// ABOUTME: A saved, quarantined, or newer-schema Mood record survives every path but an explicit Mood scratch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { get, keys, set } from "idb-keyval";
import { startAutoSave, stopAutoSave } from "./autoSave";
import { clearProject, persistenceStore } from "./persistence";
import {
  clearMoodPiece,
  MOOD_KEY,
  MOOD_QUARANTINE_KEY,
  saveMoodPiece,
} from "./moodPersistence";
import { rehydrateMoodFromStorage } from "./moodRehydrate";
import { makeMoodPiece, makeMoodTake } from "../test-utils/moodFixtures";
import { useAppStore } from "../store/useAppStore";

async function blobCount(): Promise<number> {
  return (await keys(persistenceStore())).filter((key) => String(key).startsWith("ha:blob:"))
    .length;
}

function pieceWithOneTake() {
  return makeMoodPiece({
    mics: [{ id: "mic-0", takes: [makeMoodTake({ id: "t1" })] }],
    cycleSeconds: 2,
    oneMicId: "mic-0",
    oneTakeId: "t1",
  });
}

// Past the 500 ms debounce, then let the IndexedDB writes land.
async function settleSaves(): Promise<void> {
  await vi.advanceTimersByTimeAsync(600);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("Mood save safety", () => {
  beforeEach(async () => {
    stopAutoSave();
    useAppStore.getState().actions.reset();
    await clearMoodPiece();
    await clearProject();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopAutoSave();
  });

  it("opening Mood while it is still loading never touches the saved piece", async () => {
    await saveMoodPiece(pieceWithOneTake());
    const blobs = await blobCount();
    vi.useFakeTimers();
    startAutoSave();

    useAppStore.getState().actions.setAppMode("mood");
    useAppStore.getState().actions.setMoodHydration("hydrating");
    await settleSaves();

    expect(await get(MOOD_KEY, persistenceStore())).toBeDefined();
    expect(await blobCount()).toBe(blobs);
  });

  it("a newer-schema record survives opening Mood through the default load retries", async () => {
    await saveMoodPiece(pieceWithOneTake());
    const saved = (await get(MOOD_KEY, persistenceStore())) as Record<string, unknown>;
    await set(MOOD_KEY, { ...saved, moodSchemaVersion: 2 }, persistenceStore());
    const blobs = await blobCount();
    vi.useFakeTimers();
    startAutoSave();

    useAppStore.getState().actions.setAppMode("mood");
    useAppStore.getState().actions.setMoodHydration("hydrating");
    // What MoodMode does with the outcome.
    void rehydrateMoodFromStorage().then(
      () => undefined,
      () => useAppStore.getState().actions.setMoodHydration("failed"),
    );
    await vi.advanceTimersByTimeAsync(2000);
    await settleSaves();

    expect(useAppStore.getState().mood.hydration).toBe("failed");
    expect(await get(MOOD_KEY, persistenceStore())).toMatchObject({ moodSchemaVersion: 2 });
    expect(await blobCount()).toBe(blobs);
  });

  it("a quarantined load keeps its quarantine record and the blobs it names", async () => {
    await saveMoodPiece(pieceWithOneTake());
    const saved = (await get(MOOD_KEY, persistenceStore())) as Record<string, unknown>;
    await set(MOOD_KEY, { ...saved, moodSchemaVersion: 0 }, persistenceStore());
    const blobs = await blobCount();
    startAutoSave();

    const loaded = await rehydrateMoodFromStorage({ retryDelaysMs: [0, 0] });
    expect(loaded.status).toBe("quarantined");
    vi.useFakeTimers();
    useAppStore.getState().actions.hydrateMoodPiece(null);
    await settleSaves();

    expect(await get(MOOD_QUARANTINE_KEY, persistenceStore())).toBeDefined();
    expect(await blobCount()).toBe(blobs);
  });

  it.each([
    ["with Mood loaded", true],
    ["with Mood never opened", false],
  ])("Chop's scratch keeps the saved Mood piece %s", async (_label, moodLoaded) => {
    const piece = pieceWithOneTake();
    await saveMoodPiece(piece);
    const blobs = await blobCount();
    if (moodLoaded) useAppStore.getState().actions.hydrateMoodPiece(piece);
    vi.useFakeTimers();
    startAutoSave();

    useAppStore.getState().actions.scratch();
    await settleSaves();

    expect(await get(MOOD_KEY, persistenceStore())).toBeDefined();
    expect(await blobCount()).toBe(blobs);
  });

  it("an explicit Mood scratch still clears the saved piece and its blobs", async () => {
    const piece = pieceWithOneTake();
    await saveMoodPiece(piece);
    useAppStore.getState().actions.hydrateMoodPiece(piece);
    vi.useFakeTimers();
    startAutoSave();

    useAppStore.getState().actions.scratchMoodPiece();
    await settleSaves();

    expect(await get(MOOD_KEY, persistenceStore())).toBeUndefined();
    expect(await blobCount()).toBe(0);
  });
});
