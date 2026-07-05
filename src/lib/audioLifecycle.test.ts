// ABOUTME: Tests for verified Web Audio startup and unavailable-audio failures.
// ABOUTME: Uses deterministic AudioContext stubs so unlock timing is bounded and observable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAudioContextStub,
  installNavigatorAudioSession,
  type AudioContextStub,
} from "../test-utils/audioContextStub";

let audioContextStub: AudioContextStub;

const audioMocks = vi.hoisted(() => ({
  stopPlayback: vi.fn(),
}));
const exportSessionMocks = vi.hoisted(() => ({
  abortActiveExport: vi.fn(),
}));

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./audio", () => ({
  getAudioContext: () => audioContextStub,
  stopPlayback: audioMocks.stopPlayback,
}));

vi.mock("./exportSession", () => ({
  abortActiveExport: exportSessionMocks.abortActiveExport,
}));

import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import {
  __resetAudioLifecycleForTesting,
  AudioUnavailableError,
  ensureAudioRunning,
  initAudioLifecycle,
  markSilentSwitchHintDismissed,
  noteMicHeld,
  noteMicReleased,
  shouldShowSilentSwitchHint,
} from "./audioLifecycle";
import { LOG_EVENTS, logger } from "./logger";

describe("ensureAudioRunning", () => {
  let audioSession: ReturnType<typeof installNavigatorAudioSession> | null;
  let detachAudioLifecycle: (() => void) | null;
  let previousMaxTouchPoints: PropertyDescriptor | undefined;

  beforeEach(() => {
    audioContextStub = createAudioContextStub();
    audioSession = null;
    detachAudioLifecycle = null;
    previousMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
    __resetAudioLifecycleForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
    audioMocks.stopPlayback.mockReset();
    audioMocks.stopPlayback.mockImplementation(() => {
      useAppStore.getState().actions.setIsPlaying(false);
    });
    exportSessionMocks.abortActiveExport.mockReset();
    exportSessionMocks.abortActiveExport.mockReturnValue(true);
    vi.mocked(Tone.start).mockResolvedValue(undefined);
    vi.mocked(Tone.start).mockClear();
  });

  afterEach(() => {
    detachAudioLifecycle?.();
    audioSession?.uninstall();
    if (previousMaxTouchPoints) {
      Object.defineProperty(navigator, "maxTouchPoints", previousMaxTouchPoints);
    } else {
      Reflect.deleteProperty(navigator, "maxTouchPoints");
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves when Tone.start resolves and the context is running", async () => {
    audioContextStub.setState("running");

    await expect(ensureAudioRunning()).resolves.toBeUndefined();

    expect(Tone.start).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().playback.audioState).toBe("running");
  });

  it("rejects with AudioUnavailableError when the context stays suspended", async () => {
    vi.useFakeTimers();

    const promise = ensureAudioRunning();
    const rejection = expect(promise).rejects.toBeInstanceOf(AudioUnavailableError);

    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    await expect(promise).rejects.toMatchObject({ name: "AudioUnavailableError" });
    expect(useAppStore.getState().playback.audioState).toBe("resume-required");
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

  it("shows the silent-switch hint after the first successful audible start on touch devices without audioSession", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1,
    });
    audioContextStub.setState("running");

    expect(shouldShowSilentSwitchHint()).toBe(false);

    await ensureAudioRunning();

    expect(shouldShowSilentSwitchHint()).toBe(true);

    markSilentSwitchHintDismissed();

    expect(shouldShowSilentSwitchHint()).toBe(false);

    await ensureAudioRunning();

    expect(shouldShowSilentSwitchHint()).toBe(false);
  });

  it("does not show the silent-switch hint when audioSession exists", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1,
    });
    audioSession = installNavigatorAudioSession();
    audioContextStub.setState("running");

    await ensureAudioRunning();

    expect(shouldShowSilentSwitchHint()).toBe(false);
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

  it("stops playback synchronously and marks resume required on interruption", () => {
    const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    useAppStore.getState().actions.setIsPlaying(true);
    detachAudioLifecycle = initAudioLifecycle();

    audioContextStub.setState("interrupted");

    expect(audioMocks.stopPlayback).toHaveBeenCalledTimes(1);
    expect(exportSessionMocks.abortActiveExport).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(useAppStore.getState().playback.audioState).toBe("resume-required");
    expect(loggerSpy).toHaveBeenCalledWith(LOG_EVENTS.AUDIO_INTERRUPTED, {
      state: "interrupted",
      wasExporting: false,
      wasPlaying: true,
    });
  });

  it("aborts export directly and does not route through stopPlayback on interruption", () => {
    const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    useAppStore.getState().actions.setIsPlaying(true);
    useAppStore.getState().actions.setIsExporting(true);
    detachAudioLifecycle = initAudioLifecycle();

    audioContextStub.setState("interrupted");

    expect(exportSessionMocks.abortActiveExport).toHaveBeenCalledWith(
      "Audio was interrupted — rendering stopped. Tap Render to try again.",
    );
    expect(audioMocks.stopPlayback).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.audioState).toBe("resume-required");
    expect(loggerSpy).toHaveBeenCalledWith(LOG_EVENTS.AUDIO_INTERRUPTED, {
      state: "interrupted",
      wasExporting: true,
      wasPlaying: true,
    });
  });

  it("does not clear resume-required from a running statechange alone", () => {
    useAppStore.getState().actions.setAudioState("resume-required");
    detachAudioLifecycle = initAudioLifecycle();

    audioContextStub.setState("running");

    expect(audioMocks.stopPlayback).not.toHaveBeenCalled();
    expect(exportSessionMocks.abortActiveExport).not.toHaveBeenCalled();
    expect(useAppStore.getState().playback.audioState).toBe("resume-required");
  });
});
