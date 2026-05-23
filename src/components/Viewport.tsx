// ABOUTME: Viewport — square canvas that the hard-cut video renderer draws into.
// ABOUTME: Owns the empty state plus the fullscreen toggle for presentation mode.
import { useEffect, useRef } from "react";
import * as Tone from "tone";
import { Camera, Maximize2, Mic, Minimize2, Video } from "lucide-react";
import { drawCurrentFrame, initVideoEngine, setActiveCanvas } from "../lib/videoEngine";
import { useAppStore } from "../store/useAppStore";
import type { MediaStatus } from "../types";
import { requestMedia } from "../lib/media";
import { useFullscreen } from "../lib/useFullscreen";
import { RecordingStation } from "./RecordingStation";
import { RecordCountdown } from "./RecordCountdown";

const TRACK_COUNT = 8;

export function Viewport() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasClips = useAppStore((s) => s.project.tracks.some((t) => t.clip));
  const emptyTrackCount = useAppStore(
    (s) => s.project.tracks.filter((t) => !t.clip).length,
  );
  const stationDismissed = useAppStore((s) => s.session.recordingStationDismissed);
  const mediaStatus = useAppStore((s) => s.media.status);
  const mediaError = useAppStore((s) => s.media.error);
  const { isFullscreen, isSupported: fullscreenSupported, enter, exit } = useFullscreen();

  // The overlays (gate, station, record-prompt, countdown) stay visible in
  // fullscreen so the user can still record from presentation mode. Only the
  // "Record more" pill below the frame and the fullscreen toggle button
  // itself adapt to fullscreen.
  //
  // The permission gate is gated behind explicit recording intent — on reload
  // with persisted clips we don't want it flashing up. It mirrors the station
  // precondition: empty tracks exist AND the user hasn't dismissed the
  // walkthrough. Clicking "Record more" or "Re-record" both reopen the
  // station, which in turn reveals the gate when media isn't granted yet.
  const showStation =
    mediaStatus === "granted" && emptyTrackCount > 0 && !stationDismissed;
  // "suspended" is "was granted, currently disconnected" — the gate must NOT
  // appear (the user already approved permission); the reconnect pill takes
  // its place.
  const showGate =
    (mediaStatus === "idle" ||
      mediaStatus === "requesting" ||
      mediaStatus === "denied") &&
    emptyTrackCount > 0 &&
    !stationDismissed;
  const showReconnectPill = mediaStatus === "suspended";
  const showRecordMore =
    !isFullscreen &&
    emptyTrackCount > 0 &&
    emptyTrackCount < TRACK_COUNT &&
    stationDismissed;
  const showFullscreenToggle = fullscreenSupported && (mediaStatus === "granted" || hasClips);

  useEffect(() => {
    initVideoEngine();
  }, []);

  useEffect(() => {
    setActiveCanvas(canvasRef.current);
    return () => setActiveCanvas(null);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const draw = () => {
      // Audio time is the source of truth for "what should be on screen".
      // rAF only decides when we paint.
      const audioTime = Tone.now();
      drawCurrentFrame(ctx, audioTime);
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const onToggleFullscreen = () => {
    if (isFullscreen) {
      void exit();
    } else if (frameRef.current) {
      void enter(frameRef.current);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={frameRef}
        className="ha-viewport-frame relative aspect-square w-full max-w-[480px]"
      >
        <canvas
          ref={canvasRef}
          width={480}
          height={480}
          aria-label="hard-cut video viewport"
          className="ha-canvas block w-full h-full bg-zinc-950 rounded shadow-lg"
        />
        {showGate && (
          <PermissionGate status={mediaStatus} error={mediaError} />
        )}
        {showStation && <RecordingStation />}
        {showReconnectPill && <ReconnectPill />}
        {mediaStatus === "granted" && !hasClips && stationDismissed && (
          <RecordPrompt />
        )}
        <RecordCountdown />
        {showFullscreenToggle && (
          <button
            type="button"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={onToggleFullscreen}
            className="absolute top-2 right-2 z-10 flex items-center justify-center w-8 h-8 pointer-coarse:w-10 pointer-coarse:h-10 rounded bg-zinc-950/60 text-zinc-200 hover:bg-zinc-950/90 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
      </div>
      {showRecordMore && <RecordMoreButton />}
    </div>
  );
}

function ReconnectPill() {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
      <button
        type="button"
        onClick={() => void useAppStore.getState().actions.resumeMedia()}
        className="px-3 py-1 rounded-full bg-zinc-950/80 border border-orange-500/60 text-xs uppercase tracking-wide text-orange-300 hover:bg-zinc-900/90"
      >
        Camera disconnected — tap to reconnect
      </button>
    </div>
  );
}

function RecordMoreButton() {
  return (
    <button
      type="button"
      onClick={() => useAppStore.getState().actions.reopenRecordingStation()}
      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 rounded-full bg-zinc-900 border border-zinc-700 hover:bg-zinc-800"
    >
      <Mic size={12} />
      Record more
    </button>
  );
}

interface PermissionGateProps {
  // Accepts the full MediaStatus union; "granted" is unreachable here because
  // the parent only renders this gate when status !== "granted".
  status: MediaStatus;
  error: string | null;
}

function PermissionGate({ status, error }: PermissionGateProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-10">
      {status === "denied" ? (
        <>
          <Video size={32} className="text-red-400" aria-hidden />
          <div className="text-sm text-red-300 max-w-[20rem]">
            Camera blocked: {error ?? "permission denied"}.
          </div>
          <p className="text-xs text-zinc-500 max-w-[20rem]">
            Allow camera and microphone access in your browser, then reload.
          </p>
        </>
      ) : (
        <>
          <Camera size={32} className="text-zinc-400" aria-hidden />
          <p className="text-sm text-zinc-300 max-w-[18rem]">
            Enable your camera and microphone to start recording sounds.
          </p>
          <button
            type="button"
            disabled={status === "requesting"}
            onClick={() => {
              void requestMedia();
            }}
            className="px-4 py-2 rounded bg-orange-500 text-zinc-950 font-medium hover:bg-orange-400 disabled:opacity-60"
          >
            {status === "requesting" ? "Requesting…" : "Enable camera & mic"}
          </button>
        </>
      )}
    </div>
  );
}

function RecordPrompt() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center text-zinc-500 px-8">
      <p className="text-sm">
        Record a sound on any track below, then toggle steps to make a beat.
      </p>
    </div>
  );
}
