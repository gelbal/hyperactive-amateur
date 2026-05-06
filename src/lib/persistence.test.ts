// ABOUTME: persistence tests — round-trip save/load via fake-indexeddb, plus v1 → v2 migration.
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { set as idbSet } from "idb-keyval";
import {
  saveProject,
  loadProject,
  clearProject,
  snapshot,
  migrate,
  PROJECT_KEY,
  CURRENT_SCHEMA_VERSION,
} from "./persistence";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([7, 8, 9])], { type: "video/webm" }),
    url: "blob:test/abc",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 100,
    trimEndMs: 1100,
    durationMs: 2000,
  };
}

describe("persistence", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
  });

  it("snapshot strips the AudioBuffer and url, keeps blob+trim+steps+showVideo", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    useAppStore.getState().actions.toggleStep(0, 4);
    useAppStore.getState().actions.setTrackTag(0, "kick");
    useAppStore.getState().actions.setTrackShowVideo(2, false);
    const snap = snapshot(useAppStore.getState());
    expect(snap.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(snap.bpm).toBe(90);
    expect(snap.tracks[0].clipBlob).toBeInstanceOf(Blob);
    expect(snap.tracks[0].trimStartMs).toBe(100);
    expect(snap.tracks[0].steps[4]).toBe(true);
    expect(snap.tracks[0].tag).toBe("kick");
    expect(snap.tracks[0].showVideo).toBe(true);
    expect(snap.tracks[2].showVideo).toBe(false);
    expect(snap.tracks[1].clipBlob).toBeNull();
  });

  it("save then load returns an equivalent shape", async () => {
    useAppStore.getState().actions.setBpm(110);
    useAppStore.getState().actions.toggleStep(2, 7);
    await saveProject(useAppStore.getState());
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();
    expect(loaded?.bpm).toBe(110);
    expect(loaded?.tracks[2].steps[7]).toBe(true);
    expect(loaded?.tracks[0].steps[0]).toBe(false);
  });

  it("clearProject removes the record", async () => {
    await saveProject(useAppStore.getState());
    await clearProject();
    const loaded = await loadProject();
    expect(loaded).toBeNull();
  });

  describe("migration", () => {
    it("migrates a v1 fixture by defaulting showVideo + cutSubdivision", () => {
      const v1 = {
        version: 1,
        bpm: 100,
        swing: 0,
        tracks: Array.from({ length: 8 }, (_, i) => ({
          id: i,
          clipBlob: null,
          trimStartMs: 0,
          trimEndMs: 0,
          durationMs: 0,
          tag: null,
          steps: new Array(16).fill(false),
          volume: 1,
          muted: false,
          // no showVideo field
        })),
        updatedAt: 0,
      };
      const migrated = migrate(v1);
      expect(migrated).not.toBeNull();
      expect(migrated?.version).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated?.bpm).toBe(100);
      expect(migrated?.cutSubdivision).toBe("8n");
      expect(migrated?.tracks).toHaveLength(8);
      for (const track of migrated!.tracks) {
        expect(track.showVideo).toBe(true);
      }
    });

    it("loadProject upgrades a v1 record on disk", async () => {
      await idbSet(PROJECT_KEY, {
        version: 1,
        bpm: 110,
        swing: 0,
        tracks: Array.from({ length: 8 }, (_, i) => ({
          id: i,
          clipBlob: null,
          trimStartMs: 0,
          trimEndMs: 0,
          durationMs: 0,
          tag: null,
          steps: new Array(16).fill(false),
          volume: 1,
          muted: false,
        })),
        updatedAt: 0,
      });
      const loaded = await loadProject();
      expect(loaded?.version).toBe(CURRENT_SCHEMA_VERSION);
      expect(loaded?.bpm).toBe(110);
      expect(loaded?.tracks.every((t) => t.showVideo === true)).toBe(true);
    });

    it("preserves explicit showVideo: false through migration", () => {
      const v1WithField = {
        version: 1,
        bpm: 90,
        swing: 0,
        tracks: Array.from({ length: 8 }, (_, i) => ({
          id: i,
          clipBlob: null,
          trimStartMs: 0,
          trimEndMs: 0,
          durationMs: 0,
          tag: null,
          steps: new Array(16).fill(false),
          volume: 1,
          muted: false,
          showVideo: i === 2 ? false : true,
        })),
        updatedAt: 0,
      };
      const migrated = migrate(v1WithField);
      expect(migrated?.tracks[2].showVideo).toBe(false);
      expect(migrated?.tracks[0].showVideo).toBe(true);
    });
  });
});
