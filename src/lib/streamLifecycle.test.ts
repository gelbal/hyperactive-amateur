// ABOUTME: streamLifecycle tests — track.ended, visibilitychange, and recorder.onerror funnel through one module.
// ABOUTME: Uses minimal EventTarget-based stand-ins for MediaStream / MediaStreamTrack since jsdom lacks them.
import { describe, it, expect, beforeEach, vi } from "vitest";

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
  registerStreamLifecycle,
  releaseMediaStream,
  suspendMediaStream,
} from "./streamLifecycle";
import { __resetExportSessionForTesting, registerExportSession } from "./exportSession";
import { LOG_EVENTS, logger } from "./logger";
import { useAppStore } from "../store/useAppStore";

class FakeTrack extends EventTarget {
  kind: "video" | "audio";
  readyState: "live" | "ended" = "live";
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
}

function makeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
  const tracks = [new FakeTrack("video"), new FakeTrack("audio")];
  const stream = {
    getTracks: () => tracks,
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
  beforeEach(() => {
    __resetExportSessionForTesting();
    audioLifecycleMocks.noteMicHeld.mockClear();
    audioLifecycleMocks.noteMicReleased.mockClear();
    toneMocks.rawContext.state = "suspended";
    vi.mocked(Tone.start).mockClear();
    useAppStore.getState().actions.reset();
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

    it("detach() removes listeners — subsequent ended events are inert", () => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const handle = attachStreamEndedListeners(stream);
      handle.detach();

      tracks[0].fireEnded();

      expect(useAppStore.getState().media.status).toBe("granted");
    });
  });

  describe("installVisibilityListener", () => {
    it("on hidden: stops playback and suspends a held stream", () => {
      const transportStop = vi.fn();
      vi.mocked(Tone.getTransport).mockReturnValue({
        stop: transportStop,
        // The minimal mock only needs .stop — the lifecycle code doesn't touch anything else.
      } as unknown as ReturnType<typeof Tone.getTransport>);

      const { stream } = makeStream();
      setGrantedWithStream(stream);
      useAppStore.getState().actions.setIsPlaying(true);
      const detach = installVisibilityListener();

      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(transportStop).toHaveBeenCalled();
      expect(useAppStore.getState().playback.isPlaying).toBe(false);
      const media = useAppStore.getState().media;
      expect(media.status).toBe("suspended");
      expect(media.stream).toBeNull();
      detach();
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

    it("on hidden: aborts an active export and still suspends held media", () => {
      const { stream, tracks } = makeStream();
      setGrantedWithStream(stream);
      const abort = vi.fn();
      const unregister = registerExportSession({ abort });
      if (!unregister) throw new Error("unexpected active export session");
      const detach = installVisibilityListener();

      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(abort).toHaveBeenCalledWith("Export was interrupted because the page was hidden.");
      expect(useAppStore.getState().media.stream).toBeNull();
      expect(useAppStore.getState().media.status).toBe("suspended");
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(tracks[1].stop).toHaveBeenCalled();
      detach();
      unregister();
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

    it("does NOT touch the store when the store holds a different stream", () => {
      const { stream: s1, tracks } = makeStream();
      for (const t of tracks) t.readyState = "ended";
      const { stream: s2 } = makeStream();
      setGrantedWithStream(s2);

      onMediaRecorderError(s1, new Error("stream gone"));

      expect(useAppStore.getState().media.status).toBe("granted");
      expect(useAppStore.getState().media.stream).toBe(s2);
    });
  });
});
