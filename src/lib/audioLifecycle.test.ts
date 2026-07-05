// ABOUTME: Tests for verified Web Audio startup and unavailable-audio failures.
// ABOUTME: Uses deterministic AudioContext stubs so unlock timing is bounded and observable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAudioContextStub,
  installNavigatorAudioSession,
  type AudioContextStub,
} from "../test-utils/audioContextStub";

let audioContextStub: AudioContextStub;

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./audio", () => ({
  getAudioContext: () => audioContextStub,
}));

import * as Tone from "tone";
import {
  __resetAudioLifecycleForTesting,
  AudioUnavailableError,
  ensureAudioRunning,
  noteMicHeld,
  noteMicReleased,
} from "./audioLifecycle";
import { LOG_EVENTS, logger } from "./logger";

describe("ensureAudioRunning", () => {
  let audioSession: ReturnType<typeof installNavigatorAudioSession> | null;

  beforeEach(() => {
    audioContextStub = createAudioContextStub();
    audioSession = null;
    __resetAudioLifecycleForTesting();
    vi.mocked(Tone.start).mockResolvedValue(undefined);
    vi.mocked(Tone.start).mockClear();
  });

  afterEach(() => {
    audioSession?.uninstall();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("sets the audio session to playback before starting Tone when the mic is not held", async () => {
    audioSession = installNavigatorAudioSession();
    audioContextStub.setState("running");
    vi.mocked(Tone.start).mockImplementation(async () => {
      expect(audioSession?.types).toEqual(["playback"]);
    });

    await ensureAudioRunning();

    expect(Tone.start).toHaveBeenCalledTimes(1);
    expect(audioSession.types).toEqual(["playback"]);
  });

  it("switches to play-and-record while the mic is held and returns to playback after audible start", async () => {
    audioSession = installNavigatorAudioSession();

    noteMicHeld();
    expect(audioSession.types).toEqual(["play-and-record"]);

    audioContextStub.setState("running");
    await ensureAudioRunning();

    noteMicReleased();

    expect(audioSession.types).toEqual(["play-and-record", "playback"]);
  });

  it("does not declare playback when the mic is released before any audible action", () => {
    audioSession = installNavigatorAudioSession();

    noteMicHeld();
    noteMicReleased();

    expect(audioSession.types).toEqual(["play-and-record"]);
  });

  it("logs and continues when the audio session setter throws", async () => {
    audioContextStub.setState("running");
    const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const hadOwnAudioSession = Object.prototype.hasOwnProperty.call(navigator, "audioSession");
    const previousDescriptor = Object.getOwnPropertyDescriptor(navigator, "audioSession");
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      enumerable: true,
      value: {
        get type() {
          return "auto";
        },
        set type(_nextType: AudioSessionLike["type"]) {
          throw new Error("session denied");
        },
      },
    });

    await expect(ensureAudioRunning()).resolves.toBeUndefined();

    expect(Tone.start).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith(LOG_EVENTS.AUDIO_SESSION_ERROR, {
      message: "session denied",
      type: "playback",
    });

    if (hadOwnAudioSession && previousDescriptor) {
      Object.defineProperty(navigator, "audioSession", previousDescriptor);
    } else {
      delete (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
    }
  });
});
