// ABOUTME: persistence tests — round-trip + clear via fake-indexeddb.
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  PERSISTED_SCHEMA_VERSION,
  clearProject,
  loadProject,
  loadRecoveryBackup,
  saveProject,
  saveRecoveryBackup,
  snapshot,
} from "./persistence";
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
    expect(loaded?.schemaVersion).toBe(PERSISTED_SCHEMA_VERSION);
    expect(loaded?.bpm).toBe(110);
    expect(loaded?.cutSubdivision).toBe("4n");
    expect(loaded?.sameTierHoldMs).toBe(750);
    expect(loaded?.tracks[0].showVideo).toBe(false);
    expect(loaded?.tracks[2].steps[7]).toBe(true);
  });

  it("omits transient playback and recording fields from persistence snapshots", () => {
    useAppStore.getState().actions.setAudioState("resume-required");
    useAppStore.getState().actions.setCountdownEndsAt(123.25);
    useAppStore.getState().actions.setRecordingError("do not persist");

    const persisted = snapshot(useAppStore.getState());

    expect(persisted).not.toHaveProperty("playback");
    expect(persisted).not.toHaveProperty("audioState");
    expect(persisted).not.toHaveProperty("recording");
    expect(persisted).not.toHaveProperty("countdownEndsAt");
    expect(persisted).not.toHaveProperty("error");
  });

  it("clearProject removes the record so loadProject returns null", async () => {
    await saveProject(useAppStore.getState());
    await clearProject();
    expect(await loadProject()).toBeNull();
  });

  it("clearProject also removes the degraded recovery backup", async () => {
    await saveProject(useAppStore.getState());
    const saved = await loadProject();
    expect(saved).not.toBeNull();
    await saveRecoveryBackup(saved!);
    expect(await loadRecoveryBackup()).not.toBeNull();

    await clearProject();

    expect(await loadRecoveryBackup()).toBeNull();
  });

  it("round-trips posterBlob alongside the clip blob", async () => {
    const posterBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    const audioBlob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "audio/wav" });
    useAppStore.getState().actions.setTrackClip(1, {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/clip",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      audioBlob,
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob,
      posterUrl: "blob:test/poster",
    });
    await saveProject(useAppStore.getState());

    const loaded = await loadProject();
    // fake-indexeddb rehydrates blobs into an opaque value; we just need to
    // confirm it round-trips as non-null where set and stays null elsewhere.
    expect(loaded?.tracks[1].posterBlob).not.toBeNull();
    expect(loaded?.tracks[1].posterBlob).toBeDefined();
    expect(loaded?.tracks[1].audioBlob).not.toBeNull();
    expect(loaded?.tracks[1].audioBlob).toBeDefined();
    expect(loaded?.tracks[0].posterBlob).toBeNull();
    expect(loaded?.tracks[0].audioBlob).toBeNull();
  });
});
