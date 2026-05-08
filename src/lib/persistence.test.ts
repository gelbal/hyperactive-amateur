// ABOUTME: persistence tests — round-trip + clear via fake-indexeddb.
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { saveProject, loadProject, clearProject } from "./persistence";
import { useAppStore } from "../store/useAppStore";

describe("persistence", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
  });

  it("round-trips bpm + steps + cutSubdivision + sameTierHoldMs + showVideo", async () => {
    useAppStore.getState().actions.setBpm(110);
    useAppStore.getState().actions.toggleStep(2, 7);
    useAppStore.getState().actions.setCutSubdivision("4n");
    useAppStore.getState().actions.setSameTierHoldMs(750);
    useAppStore.getState().actions.setTrackShowVideo(0, false, "user");
    await saveProject(useAppStore.getState());

    const loaded = await loadProject();
    expect(loaded?.bpm).toBe(110);
    expect(loaded?.cutSubdivision).toBe("4n");
    expect(loaded?.sameTierHoldMs).toBe(750);
    expect(loaded?.tracks[0].showVideo).toBe(false);
    expect(loaded?.tracks[2].steps[7]).toBe(true);
  });

  it("clearProject removes the record so loadProject returns null", async () => {
    await saveProject(useAppStore.getState());
    await clearProject();
    expect(await loadProject()).toBeNull();
  });
});
