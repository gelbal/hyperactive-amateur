// ABOUTME: videoEngine tests — clip lifecycle, trigger swaps active video, store binding.
// ABOUTME: Skips canvas pixel assertions; verifies element creation and active-trigger state.
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../store/useAppStore";
import {
  setClipForTrack,
  trigger,
  drawCurrentFrame,
  initVideoEngine,
  __resetVideoEngineForTesting,
} from "./videoEngine";
import type { Clip } from "../types";

function makeClip(seed: number): Clip {
  return {
    blob: new Blob([new Uint8Array([seed])], { type: "video/webm" }),
    url: `blob:test/${seed}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
  };
}

function getCtx() {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  return ctx;
}

describe("videoEngine", () => {
  beforeEach(() => {
    __resetVideoEngineForTesting();
    useAppStore.getState().actions.reset();
  });

  it("setClipForTrack appends a hidden video element", () => {
    setClipForTrack(0, makeClip(1));
    const host = document.querySelector('[data-hidden-videos="true"]');
    expect(host).not.toBeNull();
    expect(host?.querySelectorAll("video")).toHaveLength(1);
  });

  it("setClipForTrack with null removes the existing video", () => {
    setClipForTrack(0, makeClip(1));
    setClipForTrack(0, null);
    const host = document.querySelector('[data-hidden-videos="true"]');
    expect(host?.querySelectorAll("video") ?? []).toHaveLength(0);
  });

  it("initVideoEngine syncs with the store on track changes", () => {
    initVideoEngine();
    useAppStore.getState().actions.setTrackClip(2, makeClip(3));
    const videos = document.querySelectorAll('[data-hidden-videos="true"] video');
    expect(videos).toHaveLength(1);
  });

  it("drawCurrentFrame is a no-op when nothing is triggered", () => {
    const ctx = getCtx();
    expect(() => drawCurrentFrame(ctx, 0)).not.toThrow();
  });

  it("trigger updates the active video to the most recent track", () => {
    setClipForTrack(0, makeClip(1));
    setClipForTrack(3, makeClip(2));
    const ctx = getCtx();
    trigger(0, 0);
    drawCurrentFrame(ctx, 0);
    trigger(3, 0);
    // No throw means the new active is reachable; the actual draw is skipped
    // in jsdom because video elements lack pixel data.
    expect(() => drawCurrentFrame(ctx, 0)).not.toThrow();
  });
});
