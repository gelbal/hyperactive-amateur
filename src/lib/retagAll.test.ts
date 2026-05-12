// ABOUTME: retagAll tests — store wiring, holistic-vs-fallback orchestration, hat audio-only respect.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { useAppStore } from "../store/useAppStore";
import { retagAllClipsWith, type RetagDeps } from "./retagAll";
import type { Clip, Tag } from "../types";

// The orchestration tests don't care about the trimmed-window slice (that
// path is covered in audioBufferSlice.test.ts). Stub the helper to an
// identity so we don't need a real AudioContext in jsdom.
vi.mock("./audioBufferSlice", () => ({
  sliceAudioBuffer: (buf: AudioBuffer) => buf,
}));

function fakeClip(): Clip {
  const sampleRate = 48000;
  const length = sampleRate * 2;
  const buffer = {
    sampleRate,
    length,
    duration: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(length),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
  return {
    blob: new Blob(["x"], { type: "audio/wav" }),
    url: "blob:test",
    audioBuffer: buffer,
    trimStartMs: 0,
    trimEndMs: 2000,
    durationMs: 2000,
  };
}

function seedTracks(trackIds: number[]): void {
  const get = useAppStore.getState();
  get.actions.reset();
  for (const id of trackIds) get.actions.setTrackClip(id, fakeClip());
}

describe("retagAllClipsWith", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns no-clips when no tracks have a clip; never calls the batch", async () => {
    useAppStore.getState().actions.reset();
    const deps: RetagDeps = { batch: vi.fn(async () => null), single: vi.fn(async () => null) };
    expect(await retagAllClipsWith(deps)).toEqual({ ok: false, tagged: 0, reason: "no-clips" });
    expect(deps.batch).not.toHaveBeenCalled();
  });

  it("batch path: writes accepted tags to the store, drops below-threshold, and respects manual showVideo on hat tracks", async () => {
    seedTracks([0, 1, 2]);
    // Track 1 has a manual showVideo=true override (user explicitly turned video back on).
    useAppStore.getState().actions.setTrackShowVideo(1, true, "user");
    const deps: RetagDeps = {
      batch: vi.fn(async () => [
        { trackId: 0, tag: "hat" as Tag, confidence: 0.9 }, // applied + auto-flipped to audio-only
        { trackId: 1, tag: "hat" as Tag, confidence: 0.9 }, // applied; user override means showVideo stays true
        { trackId: 2, tag: "kick" as Tag, confidence: 0.4 }, // dropped: below 0.6 threshold
      ]),
      single: vi.fn(async () => null),
    };
    const result = await retagAllClipsWith(deps);
    expect(result).toEqual({ ok: true, tagged: 2 });

    const tracks = useAppStore.getState().project.tracks;
    expect(tracks[0].tag).toBe("hat");
    expect(tracks[0].showVideo).toBe(false); // auto-flipped
    expect(tracks[1].tag).toBe("hat");
    expect(tracks[1].showVideo).toBe(true); // user override respected
    expect(tracks[2].tag).toBeNull(); // below-threshold dropped
    expect(deps.single).not.toHaveBeenCalled();
  });

  it("falls back to per-clip when batch returns null; threshold also applies on the fallback path", async () => {
    seedTracks([0, 1]);
    const deps: RetagDeps = {
      batch: vi.fn(async () => null),
      single: vi.fn(async (_buf, trackId) => ({
        tag: "kick" as Tag,
        confidence: trackId === 0 ? 0.9 : 0.3,
      })),
    };
    const result = await retagAllClipsWith(deps);
    expect(result).toEqual({ ok: true, tagged: 1 });
    expect(deps.single).toHaveBeenCalledTimes(2);
    const tracks = useAppStore.getState().project.tracks;
    expect(tracks[0].tag).toBe("kick");
    expect(tracks[1].tag).toBeNull();
  });

  it("returns all-failed when batch is null AND every per-clip call returns nothing", async () => {
    seedTracks([0, 1]);
    const deps: RetagDeps = {
      batch: vi.fn(async () => null),
      single: vi.fn(async () => null),
    };
    expect(await retagAllClipsWith(deps)).toEqual({ ok: false, tagged: 0, reason: "all-failed" });
  });

  it("returns all-failed on the batch path when every returned item is below the confidence threshold", async () => {
    seedTracks([0, 1]);
    const deps: RetagDeps = {
      batch: vi.fn(async () => [
        { trackId: 0, tag: "kick" as Tag, confidence: 0.3 },
        { trackId: 1, tag: "snare" as Tag, confidence: 0.4 },
      ]),
      single: vi.fn(async () => null),
    };
    expect(await retagAllClipsWith(deps)).toEqual({ ok: false, tagged: 0, reason: "all-failed" });
    expect(deps.single).not.toHaveBeenCalled();
    for (const t of useAppStore.getState().project.tracks) {
      expect(t.tag).toBeNull();
    }
  });

  it("re-tagging a system-hidden hat track to a non-hat tag restores video; manual override still wins", async () => {
    seedTracks([0, 1]);
    const actions = useAppStore.getState().actions;
    // Track 0: previously auto-tagged as hat — system flipped showVideo off.
    actions.setTrackTag(0, "hat", "system");
    actions.setTrackShowVideo(0, false, "system");
    // Track 1: user explicitly turned showVideo off — that choice must survive.
    actions.setTrackShowVideo(1, false, "user");

    const deps: RetagDeps = {
      batch: vi.fn(async () => [
        { trackId: 0, tag: "kick" as Tag, confidence: 0.9 },
        { trackId: 1, tag: "kick" as Tag, confidence: 0.9 },
      ]),
      single: vi.fn(async () => null),
    };
    await retagAllClipsWith(deps);

    const tracks = useAppStore.getState().project.tracks;
    expect(tracks[0].tag).toBe("kick");
    expect(tracks[0].showVideo).toBe(true); // system-flip from before is reverted
    expect(tracks[1].tag).toBe("kick");
    expect(tracks[1].showVideo).toBe(false); // user override survives
  });

  it("skips tracks the user has manually tagged, even when the batch returns a high-confidence verdict", async () => {
    seedTracks([0, 1]);
    const actions = useAppStore.getState().actions;
    // Track 0: user picked "snare" from the chip picker — claim the track.
    actions.setTrackTag(0, "snare", "user");
    const deps: RetagDeps = {
      batch: vi.fn(async () => [
        { trackId: 0, tag: "kick" as Tag, confidence: 0.95 },
        { trackId: 1, tag: "kick" as Tag, confidence: 0.95 },
      ]),
      single: vi.fn(async () => null),
    };
    const result = await retagAllClipsWith(deps);
    // Only track 1 actually gets a new tag.
    expect(result).toEqual({ ok: true, tagged: 1 });
    const tracks = useAppStore.getState().project.tracks;
    expect(tracks[0].tag).toBe("snare"); // user choice survives
    expect(tracks[1].tag).toBe("kick");
  });

  it("batch reasoning strings land in project.tagReasoning for the suggester to read later", async () => {
    seedTracks([0, 1]);
    const deps: RetagDeps = {
      batch: vi.fn(async () => [
        { trackId: 0, tag: "kick" as Tag, confidence: 0.9, reasoning: "short low thump" },
        { trackId: 1, tag: "hat" as Tag, confidence: 0.9, reasoning: "bright tick" },
      ]),
      single: vi.fn(async () => null),
    };
    await retagAllClipsWith(deps);
    const reasoning = useAppStore.getState().project.tagReasoning;
    expect(reasoning[0]).toBe("short low thump");
    expect(reasoning[1]).toBe("bright tick");
  });

  it("aborts cleanly mid-flight: returns cancelled and does not write tags", async () => {
    seedTracks([0, 1]);
    const controller = new AbortController();
    // Simulate autoTagBatch's "aborted → returns null" contract — the
    // orchestration must see signal.aborted afterwards and bail.
    const deps: RetagDeps = {
      batch: vi.fn(async () => {
        controller.abort();
        return null;
      }),
      single: vi.fn(async () => null),
    };
    const result = await retagAllClipsWith(deps, controller.signal);
    expect(result.reason).toBe("cancelled");
    for (const t of useAppStore.getState().project.tracks) expect(t.tag).toBeNull();
  });
});
