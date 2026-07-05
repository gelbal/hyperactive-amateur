// ABOUTME: Tests for verified Web Audio startup and unavailable-audio failures.
// ABOUTME: Uses deterministic AudioContext stubs so unlock timing is bounded and observable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioContextStub, type AudioContextStub } from "../test-utils/audioContextStub";

let audioContextStub: AudioContextStub;

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./audio", () => ({
  getAudioContext: () => audioContextStub,
}));

import * as Tone from "tone";
import { AudioUnavailableError, ensureAudioRunning } from "./audioLifecycle";

describe("ensureAudioRunning", () => {
  beforeEach(() => {
    audioContextStub = createAudioContextStub();
    vi.mocked(Tone.start).mockResolvedValue(undefined);
    vi.mocked(Tone.start).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when Tone.start resolves and the context is running", async () => {
    audioContextStub.setState("running");

    await expect(ensureAudioRunning()).resolves.toBeUndefined();

    expect(Tone.start).toHaveBeenCalledTimes(1);
  });

  it("rejects with AudioUnavailableError when the context stays suspended", async () => {
    vi.useFakeTimers();

    const promise = ensureAudioRunning();
    const rejection = expect(promise).rejects.toBeInstanceOf(AudioUnavailableError);

    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    await expect(promise).rejects.toMatchObject({ name: "AudioUnavailableError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves early when a statechange reports running", async () => {
    vi.useFakeTimers();

    const promise = ensureAudioRunning();
    await vi.advanceTimersByTimeAsync(0);

    audioContextStub.setState("running");

    await expect(promise).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exports an instanceof-detectable AudioUnavailableError", () => {
    const err = new AudioUnavailableError();

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AudioUnavailableError);
    expect(err.name).toBe("AudioUnavailableError");
  });
});
