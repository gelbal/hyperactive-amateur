// ABOUTME: audioRepair tests — repair-state clips heal once decode works, wired to audio unlock.
// ABOUTME: The Web Audio decode surface is mocked through the ./audio context accessor.
import { describe, it, expect, beforeEach, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  decodeAudioData: vi.fn(),
}));

vi.mock("./audio", () => ({
  getAudioContext: () => ({
    decodeAudioData: audioMocks.decodeAudioData,
  }),
}));

import { attemptAudioRepair, initAudioRepair, __resetAudioRepairForTesting } from "./audioRepair";
import { useAppStore } from "../store/useAppStore";
import { logger, LOG_EVENTS } from "./logger";
import type { Clip } from "../types";

const healedBuffer = { duration: 0.6, sampleRate: 48000 } as AudioBuffer;
const richBuffer = {
  duration: 1,
  sampleRate: 48000,
  numberOfChannels: 1,
  length: 48,
  getChannelData: () => new Float32Array(48),
} as unknown as AudioBuffer;

function makeRepairClip(overrides: Partial<Clip> = {}): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/clip",
    audioBuffer: null,
    audioStatus: "unavailable",
    audioBlob: new Blob([new Uint8Array([2])], { type: "audio/wav" }),
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
    ...overrides,
  };
}

function seedRepairTrack(trackId: number, clip: Clip): void {
  useAppStore.getState().actions.setTrackClip(trackId, clip);
  useAppStore.setState((state) => ({
    project: {
      ...state.project,
      tracks: state.project.tracks.map((t) =>
        t.id === trackId ? { ...t, muted: true, mutedByRepair: true } : t,
      ),
    },
  }));
}

describe("attemptAudioRepair", () => {
  beforeEach(() => {
    __resetAudioRepairForTesting();
    useAppStore.getState().actions.reset();
    audioMocks.decodeAudioData.mockReset();
    audioMocks.decodeAudioData.mockResolvedValue(healedBuffer);
  });

  it("heals every repair-state clip and releases repair-owned mutes", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    seedRepairTrack(0, makeRepairClip());
    seedRepairTrack(2, makeRepairClip({ url: "blob:test/clip2" }));

    await attemptAudioRepair();

    for (const id of [0, 2]) {
      const track = useAppStore.getState().project.tracks[id];
      expect(track.clip?.audioStatus).toBe("ok");
      expect(track.clip?.audioBuffer).toBe(healedBuffer);
      expect(track.muted).toBe(false);
      expect(track.mutedByRepair).toBe(false);
    }
    expect(infoSpy).toHaveBeenCalledWith(LOG_EVENTS.AUDIO_REPAIRED, { trackId: 0 });
    expect(infoSpy).toHaveBeenCalledWith(LOG_EVENTS.AUDIO_REPAIRED, { trackId: 2 });
    infoSpy.mockRestore();
  });

  it("regenerates a missing sidecar from the healed decode", async () => {
    audioMocks.decodeAudioData.mockResolvedValue(richBuffer);
    seedRepairTrack(0, makeRepairClip({ audioBlob: null }));

    await attemptAudioRepair();

    const clip = useAppStore.getState().project.tracks[0].clip;
    expect(clip?.audioStatus).toBe("ok");
    expect(clip?.audioBlob?.type).toBe("audio/wav");
  });

  it("leaves clips in repair state when decode still fails", async () => {
    audioMocks.decodeAudioData.mockRejectedValue(new Error("still broken"));
    seedRepairTrack(0, makeRepairClip());

    await attemptAudioRepair();

    const track = useAppStore.getState().project.tracks[0];
    expect(track.clip?.audioStatus).toBe("unavailable");
    expect(track.muted).toBe(true);
    expect(track.mutedByRepair).toBe(true);
  });

  it("does nothing while an export owns playback", async () => {
    seedRepairTrack(0, makeRepairClip());
    useAppStore.getState().actions.setIsExporting(true);

    await attemptAudioRepair();

    expect(audioMocks.decodeAudioData).not.toHaveBeenCalled();
    expect(useAppStore.getState().project.tracks[0].clip?.audioStatus).toBe("unavailable");
    useAppStore.getState().actions.setIsExporting(false);
  });

  it("is single-flight: overlapping calls do not double-decode", async () => {
    let releaseDecode: (buffer: AudioBuffer) => void = () => undefined;
    audioMocks.decodeAudioData.mockImplementation(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          releaseDecode = resolve;
        }),
    );
    seedRepairTrack(0, makeRepairClip());

    const first = attemptAudioRepair();
    const second = attemptAudioRepair();
    await vi.waitFor(() => expect(audioMocks.decodeAudioData).toHaveBeenCalled());
    releaseDecode(healedBuffer);
    await Promise.all([first, second]);

    expect(audioMocks.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().project.tracks[0].clip?.audioStatus).toBe("ok");
  });

  it("does not graft decoded audio onto a clip that was replaced mid-repair", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const replacement = makeRepairClip({ url: "blob:test/replacement" });
    audioMocks.decodeAudioData.mockImplementation(async () => {
      // Simulate the user replacing the clip while the decode is in flight.
      useAppStore.getState().actions.setTrackClip(0, replacement);
      return healedBuffer;
    });
    seedRepairTrack(0, makeRepairClip());

    await attemptAudioRepair();

    const track = useAppStore.getState().project.tracks[0];
    expect(track.clip).toBe(replacement);
    expect(track.clip?.audioStatus).toBe("unavailable");
    expect(track.clip?.audioBuffer).toBeNull();
    // A repair that did not land must not be logged as one.
    expect(infoSpy).not.toHaveBeenCalledWith(LOG_EVENTS.AUDIO_REPAIRED, expect.anything());
    infoSpy.mockRestore();
  });
});

describe("initAudioRepair", () => {
  beforeEach(() => {
    __resetAudioRepairForTesting();
    useAppStore.getState().actions.reset();
    audioMocks.decodeAudioData.mockReset();
    audioMocks.decodeAudioData.mockResolvedValue(healedBuffer);
  });

  it("runs a repair pass when audioState transitions into running", async () => {
    seedRepairTrack(0, makeRepairClip());
    const detach = initAudioRepair();

    useAppStore.getState().actions.setAudioState("running");
    await vi.waitFor(() => {
      expect(useAppStore.getState().project.tracks[0].clip?.audioStatus).toBe("ok");
    });

    // A repeated "running" set (no transition) does not re-decode.
    audioMocks.decodeAudioData.mockClear();
    useAppStore.getState().actions.setAudioState("running");
    await Promise.resolve();
    expect(audioMocks.decodeAudioData).not.toHaveBeenCalled();
    detach();
  });

  it("stops reacting after detach", async () => {
    seedRepairTrack(0, makeRepairClip());
    const detach = initAudioRepair();
    detach();

    useAppStore.getState().actions.setAudioState("running");
    await Promise.resolve();

    expect(audioMocks.decodeAudioData).not.toHaveBeenCalled();
    expect(useAppStore.getState().project.tracks[0].clip?.audioStatus).toBe("unavailable");
  });
});
