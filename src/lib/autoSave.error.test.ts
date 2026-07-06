// ABOUTME: autoSave error tests — save failures must be observable through the app logger.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { clearLogs, getLogs, LOG_EVENTS } from "./logger";

const persistenceMock = vi.hoisted(() => ({
  saveProject: vi.fn(),
}));

vi.mock("./persistence", () => ({
  saveProject: persistenceMock.saveProject,
}));

import { saveNow, startAutoSave, stopAutoSave } from "./autoSave";

describe("autoSave error reporting", () => {
  beforeEach(() => {
    stopAutoSave();
    clearLogs();
    persistenceMock.saveProject.mockReset();
    useAppStore.getState().actions.reset();
    vi.useFakeTimers();
  });

  it("logs a structured autosave error when persistence rejects", async () => {
    persistenceMock.saveProject.mockRejectedValueOnce(new Error("quota exceeded"));

    startAutoSave();
    useAppStore.getState().actions.setBpm(121);
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();

    const entry = getLogs().find((log) => log.event === LOG_EVENTS.AUTOSAVE_ERROR);
    expect(entry?.level).toBe("error");
    expect(entry?.payload).toEqual({ message: "quota exceeded" });
  });

  it("logs a structured autosave error when saveNow rejects", async () => {
    persistenceMock.saveProject.mockRejectedValueOnce(new Error("quota exceeded"));

    await expect(saveNow()).rejects.toThrow("quota exceeded");

    const entry = getLogs().find((log) => log.event === LOG_EVENTS.AUTOSAVE_ERROR);
    expect(entry?.level).toBe("error");
    expect(entry?.payload).toEqual({ message: "quota exceeded" });
  });
});
