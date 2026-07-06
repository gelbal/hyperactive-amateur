// ABOUTME: streamLifecycle tests — track.ended, visibilitychange, and recorder.onerror funnel through one module.
// ABOUTME: Uses minimal EventTarget-based stand-ins for MediaStream / MediaStreamTrack since jsdom lacks them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";

const audioLifecycleMocks = vi.hoisted(() => ({
  noteMicHeld: vi.fn(),
  noteMicReleased: vi.fn(),
}));
const toneMocks = vi.hoisted(() => ({
  rawContext: { state: "suspended" as AudioContextState },
}));

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({ stop: vi.fn() })),
  getContext: vi.fn(() => ({ rawContext: toneMocks.rawContext })),
}));

vi.mock("./audioLifecycle", () => ({
  noteMicHeld: audioLifecycleMocks.noteMicHeld,
  noteMicReleased: audioLifecycleMocks.noteMicReleased,
}));

import * as Tone from "tone";
import {
  attachStreamEndedListeners,
  installVisibilityListener,
  onMediaRecorderError,
  registerRecordingInterruptHandler,
  registerStreamLifecycle,
  releaseMediaStream,
  suspendMediaStream,
} from "./streamLifecycle";
import { acquireRecordingStream, __resetMediaForTesting } from "./media";
import { __resetExportSessionForTesting, registerExportSession } from "./exportSession";
import { clearLogs, getLogs, LOG_EVENTS, logger } from "./logger";
import { useAppStore } from "../store/useAppStore";
import { startAutoSave, stopAutoSave } from "./autoSave";
import { clearProject, loadProject } from "./persistence";

class FakeTrack extends EventTarget {
  kind: "video" | "audio";
  readyState: "live" | "ended" = "live";
  muted = false;
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  constructor(kind: "video" | "audio") {
    super();
    this.kind = kind;
  }
  fireEnded() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
  fireMute() {
    this.muted = true;
    this.dispatchEvent(new Event("mute"));
  }
  fireUnmute() {
    this.muted = false;
    this.dispatchEvent(new Event("unmute"));
  }
}

function makeStream(
  tracks: FakeTrack[] = [new FakeTrack("video"), new FakeTrack("audio")],
): { stream: MediaStream; tracks: FakeTrack[] } {
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
  return { stream, tracks };
}

function setGrantedWithStream(stream: MediaStream) {
  useAppStore.getState().actions.setMedia({
    stream,
    status: "granted",
    error: null,
  });
}

describe("streamLifecycle", () => {
  beforeEach(async () => {
    __resetExportSessionForTesting();
    stopAutoSave();
    clearLogs();
    await clearProject();
    audioLifecycleMocks.noteMicHeld.mockClear();
    audioLifecycleMocks.noteMicReleased.mockClear();
    toneMocks.rawContext.state = "suspended";
    vi.mocked(Tone.start).mockClear();
    registerRecordingInterruptHandler(null);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    stopAutoSave();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("audio session mic ownership", () => {
    it("marks the mic held when a stream lifecycle is registered", () => {
      const { stream } = makeStream();

      registerStreamLifecycle(stream);

      expect(audioLifecycleMocks.noteMicHeld).toHaveBeenCalledTimes(1);
      expect(audioLifecycleMocks.noteMicReleased).not.toHaveBeenCalled();
    });

    it("marks the mic released on intentional stream release", () => {
      const { stream } = makeStream();
      setGrantedWithStream(stream);

      releaseMediaStream(stream);

      expect(audioLifecycleMocks.noteMicReleased).toHaveBeenCalledTimes(1);
    });

    it("marks the mic released when a stream is suspended", () => {
      const { stream } = makeStream();
      setGrantedWithStream(stream);

      suspendMediaStream(stream);

      expect(audioLifecycleMocks.noteMicReleased).toHaveBeenCalledTimes(1);
    });
  });

  describe("attachStreamEndedListeners (track.onended)", () => {
    it("transitions granted → suspended and clears media.stream when any track ends", () => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      attachStreamEndedListeners(stream);

      tracks[0].fireEnded();

      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
    });

    it("does NOT touch the store when the store holds a different stream", () => {
      const { stream: s1, tracks } = makeStream();
      const { stream: s2 } = makeStream();
      // Listen on s1 but the store ends up holding s2 (e.g. user re-flipped).
      attachStreamEndedListeners(s1);
      setGrantedWithStream(s2);

      tracks[0].fireEnded();

      const media = useAppStore.getState().media;
      expect(media.status).toBe("granted");
      expect(media.stream).toBe(s2);
    });

    it("stale stream ended does not interrupt a recording on the current stream", () => {
      const { stream: s1, tracks } = makeStream();
      const { stream: s2 } = makeStream();
      const interrupt = vi.fn();
      registerRecordingInterruptHandler({
        isActive: () => true,
        interrupt,
      });
      // Listen on s1 but the store ends up holding s2 (e.g. user re-flipped).
      attachStreamEndedListeners(s1);
      setGrantedWithStream(s2);

      tracks[0].fireEnded();

      expect(interrupt).not.toHaveBeenCalled();
      const media = useAppStore.getState().media;
      expect(media.status).toBe("granted");
      expect(media.stream).toBe(s2);
    });

    it("stale stream mute does not interrupt a recording on the current stream", () => {
      vi.useFakeTimers();
      try {
        const { stream: s1, tracks } = makeStream();
        const { stream: s2 } = makeStream();
        const interrupt = vi.fn();
        registerRecordingInterruptHandler({
          isActive: () => true,
          interrupt,
        });
        attachStreamEndedListeners(s1);
        setGrantedWithStream(s2);

        tracks[1].fireMute();
        vi.advanceTimersByTime(250);

        expect(interrupt).not.toHaveBeenCalled();
        const media = useAppStore.getState().media;
        expect(media.status).toBe("granted");
        expect(media.stream).toBe(s2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("detach() removes listeners — subsequent ended events are inert", () => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const handle = attachStreamEndedListeners(stream);
      handle.detach();

      tracks[0].fireEnded();

      expect(useAppStore.getState().media.status).toBe("granted");
    });

    it("cancels an in-flight recording before stopping tracks when a required track mutes", () => {
      const { stream, tracks } = makeStream();
      const order: string[] = [];
      const interrupt = vi.fn(() => order.push("cancel"));
      registerRecordingInterruptHandler({
        isActive: () => true,
        interrupt,
      });
      for (const track of tracks) {
        track.stop.mockImplementation(() => {
          order.push(`stop:${track.kind}`);
          track.readyState = "ended";
        });
      }
      setGrantedWithStream(stream);
      attachStreamEndedListeners(stream);

      tracks[1].fireMute();

      expect(interrupt).toHaveBeenCalledWith("interrupted");
      expect(order[0]).toBe("cancel");
      expect(order.slice(1)).toEqual(["stop:video", "stop:audio"]);
      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
    });

    it("cancels an in-flight recording before stopping tracks when a required track ends", () => {
      const { stream, tracks } = makeStream();
      const order: string[] = [];
      const interrupt = vi.fn(() => order.push("cancel"));
      registerRecordingInterruptHandler({
        isActive: () => true,
        interrupt,
      });
      for (const track of tracks) {
        track.stop.mockImplementation(() => {
          order.push(`stop:${track.kind}`);
          track.readyState = "ended";
        });
      }
      setGrantedWithStream(stream);
      attachStreamEndedListeners(stream);

      tracks[0].fireEnded();

      expect(interrupt).toHaveBeenCalledWith("interrupted");
      expect(order[0]).toBe("cancel");
      expect(order.slice(1)).toEqual(["stop:video", "stop:audio"]);
      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
    });

    it("does not invoke the recording interrupt handler when a track ends while idle", () => {
      const { stream, tracks } = makeStream();
      const interrupt = vi.fn();
      registerRecordingInterruptHandler({
        isActive: () => false,
        interrupt,
      });
      setGrantedWithStream(stream);
      attachStreamEndedListeners(stream);

      tracks[0].fireEnded();

      expect(interrupt).not.toHaveBeenCalled();
      expect(useAppStore.getState().media.status).toBe("suspended");
    });

    it("does not crash when a track mutes without a registered recording interrupt handler", () => {
      vi.useFakeTimers();
      try {
        const { stream, tracks } = makeStream();
        setGrantedWithStream(stream);
        attachStreamEndedListeners(stream);

        expect(() => tracks[1].fireMute()).not.toThrow();
        vi.advanceTimersByTime(250);

        expect(useAppStore.getState().media.status).toBe("suspended");
      } finally {
        vi.useRealTimers();
      }
    });

    it("debounces idle preview mute before transitioning to suspended", () => {
      vi.useFakeTimers();
      try {
        const { stream, tracks } = makeStream();
        setGrantedWithStream(stream);
        attachStreamEndedListeners(stream);

        tracks[0].fireMute();
        vi.advanceTimersByTime(249);
        expect(useAppStore.getState().media.status).toBe("granted");

        vi.advanceTimersByTime(1);
        const media = useAppStore.getState().media;
        expect(media.status).toBe("suspended");
        expect(media.stream).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels and restarts pending idle mute suspension on unmute or repeated mute", () => {
      vi.useFakeTimers();
      try {
        const { stream, tracks } = makeStream();
        setGrantedWithStream(stream);
        attachStreamEndedListeners(stream);

        tracks[0].fireMute();
        vi.advanceTimersByTime(200);
        tracks[0].fireUnmute();
        vi.advanceTimersByTime(50);
        expect(useAppStore.getState().media.status).toBe("granted");

        tracks[0].fireMute();
        vi.advanceTimersByTime(200);
        tracks[0].fireMute();
        vi.advanceTimersByTime(249);
        expect(useAppStore.getState().media.status).toBe("granted");

        vi.advanceTimersByTime(1);
        expect(useAppStore.getState().media.status).toBe("suspended");
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps pending idle mute suspension when another track unmutes but audio stays muted", () => {
      vi.useFakeTimers();
      try {
        const { stream, tracks } = makeStream();
        setGrantedWithStream(stream);
        attachStreamEndedListeners(stream);

        tracks[1].fireMute();
        vi.advanceTimersByTime(200);
        tracks[0].fireUnmute();
        vi.advanceTimersByTime(50);

        expect(useAppStore.getState().media.status).toBe("suspended");
        expect(useAppStore.getState().media.stream).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears pending mute suspension when the stream is released", () => {
      vi.useFakeTimers();
      try {
        const { stream, tracks } = makeStream();
        setGrantedWithStream(stream);
        attachStreamEndedListeners(stream);

        tracks[0].fireMute();
        releaseMediaStream(stream);
        vi.advanceTimersByTime(250);

        const media = useAppStore.getState().media;
        expect(media.status).toBe("granted");
        expect(media.stream).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not clear an established suspended state on unmute", () => {
      vi.useFakeTimers();
      try {
        const { stream, tracks } = makeStream();
        setGrantedWithStream(stream);
        attachStreamEndedListeners(stream);

        tracks[0].fireMute();
        vi.advanceTimersByTime(250);
        tracks[0].fireUnmute();

        const media = useAppStore.getState().media;
        expect(media.status).toBe("suspended");
        expect(media.stream).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("installVisibilityListener", () => {
    it.each([
      {
        name: "visibilitychange hidden",
        dispatch: () => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      },
      {
        name: "pagehide",
        dispatch: () => {
          window.dispatchEvent(new Event("pagehide"));
        },
      },
    ])("on $name: stops playback and suspends a held stream", ({ dispatch }) => {
      const transportStop = vi.fn();
      vi.mocked(Tone.getTransport).mockReturnValue({
        stop: transportStop,
        // The minimal mock only needs .stop — the lifecycle code doesn't touch anything else.
      } as unknown as ReturnType<typeof Tone.getTransport>);

      const { stream } = makeStream();
      setGrantedWithStream(stream);
      useAppStore.getState().actions.setIsPlaying(true);
      const detach = installVisibilityListener();

      dispatch();

      expect(transportStop).toHaveBeenCalled();
      expect(useAppStore.getState().playback.isPlaying).toBe(false);
      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
      detach();
    });

    it.each([
      {
        name: "visibilitychange hidden",
        dispatch: () => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      },
      {
        name: "pagehide",
        dispatch: () => {
          window.dispatchEvent(new Event("pagehide"));
        },
      },
    ])("on $name: cancels an in-flight recording before stopping held media", ({ dispatch }) => {
      const { stream, tracks } = makeStream();
      const order: string[] = [];
      const interrupt = vi.fn(() => order.push("cancel"));
      registerRecordingInterruptHandler({
        isActive: () => true,
        interrupt,
      });
      for (const track of tracks) {
        track.stop.mockImplementation(() => {
          order.push(`stop:${track.kind}`);
          track.readyState = "ended";
        });
      }
      setGrantedWithStream(stream);
      const detach = installVisibilityListener();

      try {
        dispatch();

        expect(interrupt).toHaveBeenCalledWith("interrupted");
        expect(order[0]).toBe("cancel");
        expect(order.slice(1)).toEqual(["stop:video", "stop:audio"]);
        expect(useAppStore.getState().media.status).toBe("suspended");
      } finally {
        detach();
      }
    });

    it.each([
      {
        name: "visibilitychange hidden",
        dispatch: () => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      },
      {
        name: "pagehide",
        dispatch: () => {
          window.dispatchEvent(new Event("pagehide"));
        },
      },
    ])("on $name: does not invoke the recording interrupt handler when idle", ({ dispatch }) => {
      const { stream } = makeStream();
      const interrupt = vi.fn();
      registerRecordingInterruptHandler({
        isActive: () => false,
        interrupt,
      });
      setGrantedWithStream(stream);
      const detach = installVisibilityListener();

      try {
        dispatch();

        expect(interrupt).not.toHaveBeenCalled();
        expect(useAppStore.getState().media.status).toBe("suspended");
      } finally {
        detach();
      }
    });

    it.each([
      {
        name: "visibilitychange hidden",
        dispatch: () => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      },
      {
        name: "pagehide",
        dispatch: () => {
          window.dispatchEvent(new Event("pagehide"));
        },
      },
    ])("on $name with no held stream: interrupts an active recording", ({ dispatch }) => {
      const interrupt = vi.fn();
      registerRecordingInterruptHandler({
        isActive: () => true,
        interrupt,
      });
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "idle",
        error: null,
      });
      const detach = installVisibilityListener();

      try {
        dispatch();

        expect(interrupt).toHaveBeenCalledWith("interrupted");
        expect(interrupt).toHaveBeenCalledTimes(1);
      } finally {
        detach();
      }
    });

    it("on visible: marks audio resume required without starting Tone", () => {
      const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
      const detach = installVisibilityListener();

      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(Tone.start).not.toHaveBeenCalled();
      expect(useAppStore.getState().playback.audioState).toBe("resume-required");
      expect(loggerSpy).toHaveBeenCalledWith(LOG_EVENTS.AUDIO_RESUME_REQUIRED, {
        state: "suspended",
      });
      // Status stays suspended — auto-resume would re-light the camera.
      expect(useAppStore.getState().media.status).toBe("suspended");
      detach();
    });

    it.each([
      {
        name: "visibilitychange hidden",
        dispatch: () => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      },
      {
        name: "pagehide",
        dispatch: () => {
          window.dispatchEvent(new Event("pagehide"));
        },
      },
    ])("on $name: aborts an active export and still suspends held media", ({ dispatch }) => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const abort = vi.fn();
      const unregister = registerExportSession({ abort });
      if (!unregister) throw new Error("unexpected active export session");
      const detach = installVisibilityListener();

      dispatch();

      expect(abort).toHaveBeenCalledWith(
        "Rendering was interrupted because the screen locked or the app was hidden. Tap Render to try again.",
      );
      expect(useAppStore.getState().media.stream).toBeNull();
      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(tracks[1].stop).toHaveBeenCalled();
      detach();
      unregister();
    });

    it("fires the export abort callback once when hidden and pagehide both arrive", () => {
      const abort = vi.fn();
      const unregister = registerExportSession({ abort });
      if (!unregister) throw new Error("unexpected active export session");
      const detach = installVisibilityListener();

      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));

      expect(abort).toHaveBeenCalledTimes(1);
      detach();
      unregister();
    });

    it("on hidden: flushes a pending autosave best-effort", async () => {
      startAutoSave();
      useAppStore.getState().actions.setBpm(134);
      const detach = installVisibilityListener();

      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.waitFor(async () => {
        expect((await loadProject())?.bpm).toBe(134);
      });
      expect(getLogs().some((entry) => entry.event === LOG_EVENTS.AUTOSAVE_FLUSH)).toBe(true);
      detach();
    });

    it("on pagehide: flushes a pending autosave and suspends held media like hidden", async () => {
      startAutoSave();
      const { stream } = makeStream();
      setGrantedWithStream(stream);
      useAppStore.getState().actions.setBpm(137);
      const detach = installVisibilityListener();

      window.dispatchEvent(new Event("pagehide"));

      await vi.waitFor(async () => {
        expect((await loadProject())?.bpm).toBe(137);
      });
      expect(getLogs().some((entry) => entry.event === LOG_EVENTS.AUTOSAVE_FLUSH)).toBe(true);
      // Suspend-path parity: R5.2 names pagehide alongside visibilitychange.
      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(useAppStore.getState().media.stream).toBeNull();
      detach();
    });

    it.each([
      {
        name: "pageshow",
        prepare: (tracks: FakeTrack[]) => {
          tracks[0].readyState = "ended";
        },
        dispatch: () => {
          window.dispatchEvent(new Event("pageshow"));
        },
      },
      {
        name: "persisted pageshow",
        prepare: (tracks: FakeTrack[]) => {
          tracks[0].readyState = "ended";
        },
        dispatch: () => {
          const event = new Event("pageshow") as PageTransitionEvent;
          Object.defineProperty(event, "persisted", {
            value: true,
            configurable: true,
          });
          window.dispatchEvent(event);
        },
      },
      {
        name: "pageshow with muted audio",
        prepare: (tracks: FakeTrack[]) => {
          tracks[1].muted = true;
        },
        dispatch: () => {
          window.dispatchEvent(new Event("pageshow"));
        },
      },
      {
        name: "document resume",
        prepare: (tracks: FakeTrack[]) => {
          tracks[0].readyState = "ended";
        },
        dispatch: () => {
          document.dispatchEvent(new Event("resume"));
        },
      },
    ])("on $name: suspends a held stream that is no longer usable", ({ prepare, dispatch }) => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const detach = installVisibilityListener();
      prepare(tracks);

      dispatch();

      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(tracks[1].stop).toHaveBeenCalled();
      detach();
    });

    it("on pageshow: leaves a fully live held stream unchanged", () => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const detach = installVisibilityListener();

      window.dispatchEvent(new Event("pageshow"));

      const media = useAppStore.getState().media;
      expect(media.status).toBe("granted");
      expect(media.stream).toBe(stream);
      expect(tracks[0].stop).not.toHaveBeenCalled();
      expect(tracks[1].stop).not.toHaveBeenCalled();
      detach();
    });

    it("does not crash when the document listener API is absent", () => {
      const originalAdd = document.addEventListener;
      const originalRemove = document.removeEventListener;
      Object.defineProperty(document, "addEventListener", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(document, "removeEventListener", {
        configurable: true,
        value: undefined,
      });

      try {
        const detach = installVisibilityListener();
        expect(() => detach()).not.toThrow();
      } finally {
        Object.defineProperty(document, "addEventListener", {
          configurable: true,
          value: originalAdd,
        });
        Object.defineProperty(document, "removeEventListener", {
          configurable: true,
          value: originalRemove,
        });
      }
    });

    it("detach removes visibility, pagehide, pageshow, and resume listeners", () => {
      const transportStop = vi.fn();
      vi.mocked(Tone.getTransport).mockReturnValue({
        stop: transportStop,
      } as unknown as ReturnType<typeof Tone.getTransport>);
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const detach = installVisibilityListener();
      detach();

      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      tracks[0].readyState = "ended";
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("resume"));

      const media = useAppStore.getState().media;
      expect(media.status).toBe("granted");
      expect(media.stream).toBe(stream);
      expect(transportStop).not.toHaveBeenCalled();
      expect(tracks[0].stop).not.toHaveBeenCalled();
      expect(tracks[1].stop).not.toHaveBeenCalled();
    });

    it("on hidden: does not log or save when autosave is clean", async () => {
      const saveSpy = vi.spyOn(await import("./persistence"), "saveProject");
      const detach = installVisibilityListener();

      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();

      expect(saveSpy).not.toHaveBeenCalled();
      expect(getLogs().some((entry) => entry.event === LOG_EVENTS.AUTOSAVE_FLUSH)).toBe(false);
      detach();
    });
  });

  describe("pending acquire invalidation", () => {
    let originalMediaDevices: MediaDevices | undefined;

    beforeEach(() => {
      __resetMediaForTesting();
      originalMediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices })
        .mediaDevices;
    });

    afterEach(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
    });

    function stubPendingGetUserMedia() {
      let resolve!: (stream: MediaStream) => void;
      const promise = new Promise<MediaStream>((res) => {
        resolve = res;
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn(() => promise) },
      });
      return { resolve };
    }

    it.each([
      {
        name: "visibilitychange hidden",
        dispatch: () => {
          Object.defineProperty(document, "hidden", {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      },
      {
        name: "pagehide",
        dispatch: () => {
          window.dispatchEvent(new Event("pagehide"));
        },
      },
    ])(
      "on $name with no held stream: a pending acquire resolving later is stale",
      async ({ dispatch }) => {
        useAppStore.getState().actions.setMedia({
          stream: null,
          status: "suspended",
          error: null,
        });
        const pending = stubPendingGetUserMedia();
        const { stream: lateStream, tracks: lateTracks } = makeStream();
        const detach = installVisibilityListener();

        try {
          const acquire = acquireRecordingStream();

          dispatch();

          pending.resolve(lateStream);
          await acquire.catch(() => undefined);

          const media = useAppStore.getState().media;
          expect(media.status).toBe("suspended");
          expect(media.stream).toBeNull();
          expect(lateTracks[0].stop).toHaveBeenCalled();
          expect(lateTracks[1].stop).toHaveBeenCalled();
        } finally {
          detach();
        }
      },
    );

    it("suspending the held stream (track ended) invalidates a pending acquire", async () => {
      const { stream: held, tracks: heldTracks } = makeStream();
      setGrantedWithStream(held);
      attachStreamEndedListeners(held);
      const pending = stubPendingGetUserMedia();
      const { stream: lateStream, tracks: lateTracks } = makeStream();

      const acquire = acquireRecordingStream();

      heldTracks[0].fireEnded();
      expect(useAppStore.getState().media.status).toBe("suspended");

      pending.resolve(lateStream);
      await acquire.catch(() => undefined);

      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
      expect(lateTracks[0].stop).toHaveBeenCalled();
      expect(lateTracks[1].stop).toHaveBeenCalled();
    });

    it("a fresh acquire after hidden invalidation still installs", async () => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
      const staleGrant = stubPendingGetUserMedia();
      const { stream: staleStream } = makeStream();
      const detach = installVisibilityListener();

      try {
        const staleAcquire = acquireRecordingStream();
        Object.defineProperty(document, "hidden", {
          value: true,
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        staleGrant.resolve(staleStream);
        await staleAcquire.catch(() => undefined);

        const { stream: freshStream, tracks: freshTracks } = makeStream();
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: { getUserMedia: vi.fn(async () => freshStream) },
        });

        await expect(acquireRecordingStream()).resolves.toBe(freshStream);

        const media = useAppStore.getState().media;
        expect(media.status).toBe("granted");
        expect(media.stream).toBe(freshStream);
        expect(freshTracks[0].stop).not.toHaveBeenCalled();
      } finally {
        detach();
      }
    });
  });

  describe("onMediaRecorderError", () => {
    it("does NOT touch the store when tracks are still live (genuine recorder error)", () => {
      const { stream } = makeStream();
      setGrantedWithStream(stream);

      onMediaRecorderError(stream, new Error("encode failure"));

      expect(useAppStore.getState().media.status).toBe("granted");
    });

    it("transitions granted → suspended when every track has ended (stream loss)", () => {
      const { stream, tracks } = makeStream();
      for (const t of tracks) t.readyState = "ended";
      setGrantedWithStream(stream);

      onMediaRecorderError(stream, new Error("stream gone"));

      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(useAppStore.getState().media.stream).toBeNull();
    });

    it("transitions granted → suspended when only one required track has ended", () => {
      const { stream, tracks } = makeStream();
      tracks[0].readyState = "ended";
      setGrantedWithStream(stream);

      onMediaRecorderError(stream, new Error("partial stream loss"));

      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(useAppStore.getState().media.stream).toBeNull();
    });

    it("transitions granted → suspended when a required track is live but muted", () => {
      const { stream, tracks } = makeStream();
      tracks[1].muted = true;
      setGrantedWithStream(stream);

      onMediaRecorderError(stream, new Error("muted stream"));

      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(useAppStore.getState().media.stream).toBeNull();
    });

    it("transitions granted → suspended when the stream is missing a video track", () => {
      const { stream } = makeStream([new FakeTrack("audio")]);
      setGrantedWithStream(stream);

      onMediaRecorderError(stream, new Error("missing video"));

      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(useAppStore.getState().media.stream).toBeNull();
    });

    it("transitions granted → suspended when the stream is missing an audio track", () => {
      const { stream } = makeStream([new FakeTrack("video")]);
      setGrantedWithStream(stream);

      onMediaRecorderError(stream, new Error("missing audio"));

      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(useAppStore.getState().media.stream).toBeNull();
    });

    it("does NOT touch the store when the store holds a different stream", () => {
      const { stream: s1, tracks } = makeStream();
      for (const t of tracks) t.readyState = "ended";
      const { stream: s2 } = makeStream();
      setGrantedWithStream(s2);

      onMediaRecorderError(s1, new Error("stream gone"));

      expect(useAppStore.getState().media.status).toBe("granted");
      expect(useAppStore.getState().media.stream).toBe(s2);
    });

    it("does not interrupt a recording on the current stream for a stale stream's error", () => {
      const { stream: s1, tracks } = makeStream();
      for (const t of tracks) t.readyState = "ended";
      const { stream: s2 } = makeStream();
      const interrupt = vi.fn();
      registerRecordingInterruptHandler({
        isActive: () => true,
        interrupt,
      });
      setGrantedWithStream(s2);

      onMediaRecorderError(s1, new Error("stream gone"));

      expect(interrupt).not.toHaveBeenCalled();
      expect(useAppStore.getState().media.status).toBe("granted");
      expect(useAppStore.getState().media.stream).toBe(s2);
    });
  });
});
