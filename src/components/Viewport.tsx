// ABOUTME: Viewport — fixed export render canvas plus DPR-scaled display canvas.
// ABOUTME: Owns the empty state plus the fullscreen toggle for presentation mode.
import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { Camera, Maximize2, Mic, Minimize2, Video } from "lucide-react";
import { drawCurrentFrame, initVideoEngine, setActiveCanvas, hasLiveFrame } from "../lib/videoEngine";
import { useAppStore } from "../store/useAppStore";
import type { MediaStatus } from "../types";
import { isAcquireInFlight, requestMedia } from "../lib/media";
import { ensureAudioRunning, noteMicAcquireStarted } from "../lib/audioLifecycle";
import { canStartAudibleAction, hasCurrentAudibleClaim } from "../lib/audibleActionGate";
import { useFullscreen } from "../lib/useFullscreen";
import { RecordingStation } from "./RecordingStation";
import { RecordCountdown } from "./RecordCountdown";

const RENDER_CANVAS_SIZE = 480;
const DISPLAY_DPR_CAP = 2;

function getDisplayBackingSize(cssSize: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, DISPLAY_DPR_CAP);
  return Math.max(1, Math.round(cssSize * dpr));
}

export function Viewport() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [displayCanvasSize, setDisplayCanvasSize] = useState(RENDER_CANVAS_SIZE);
  const hasClips = useAppStore((s) => s.project.tracks.some((t) => t.clip));
  const emptyTrackCount = useAppStore(
    (s) => s.project.tracks.filter((t) => !t.clip).length,
  );
  const stationDismissed = useAppStore((s) => s.session.recordingStationDismissed);
  const mediaStatus = useAppStore((s) => s.media.status);
  const mediaError = useAppStore((s) => s.media.error);
  const audioState = useAppStore((s) => s.playback.audioState);
  // The merged pill stays mounted while its tap is in flight, even after the
  // audio half has already flipped to running, so the label and disabled
  // state do not change under the user's finger.
  const [resumeBothPending, setResumeBothPending] = useState(false);
  const isPlaying = useAppStore((s) => s.playback.isPlaying);
  // The first clip with a poster stands in for the hero while nothing plays
  // (triggerSeq is a per-track counter, so there is no "most recent" clip).
  const posterUrl = useAppStore(
    (s) => s.project.tracks.find((t) => t.clip?.posterUrl)?.clip?.posterUrl ?? null,
  );
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
  // During playback the viewport belongs to the hard-cut video: the station
  // and gate overlays stand down until stop (recording can't run while
  // playing anyway). Unmounting the station also releases its preview stream,
  // so playback never runs with the mic held and the audio session can sit
  // in "playback" (audible with the ringer switch on) while the beat plays.
  const showStation =
    mediaStatus === "granted" && emptyTrackCount > 0 && !stationDismissed && !isPlaying;
  // "suspended" is "was granted, currently disconnected" — the gate must NOT
  // appear (the user already approved permission); the reconnect pill takes
  // its place.
  const showGate =
    (mediaStatus === "idle" ||
      mediaStatus === "requesting" ||
      mediaStatus === "denied") &&
    emptyTrackCount > 0 &&
    !stationDismissed &&
    !isPlaying;
  const showReconnectPill = mediaStatus === "suspended";
  // The viewport is the hero: while idle with clips it shows a poster, not
  // a black square. Playback (export drives playback too) unmounts it.
  const showPoster = hasClips && !isPlaying && !showGate && !showStation;
  const showAudioResumePill = audioState === "resume-required";
  const showRecordMore = !isFullscreen && emptyTrackCount > 0 && stationDismissed;
  const showFullscreenToggle = fullscreenSupported && (mediaStatus === "granted" || hasClips);

  useEffect(() => {
    initVideoEngine();
  }, []);

  useEffect(() => {
    setActiveCanvas(renderCanvasRef.current);
    return () => setActiveCanvas(null);
  }, []);

  useEffect(() => {
    const displayCanvas = displayCanvasRef.current;
    if (!displayCanvas || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const cssSize =
        entries[0]?.contentRect.width ||
        entries[0]?.contentRect.height ||
        RENDER_CANVAS_SIZE;
      const backingSize = getDisplayBackingSize(cssSize);
      setDisplayCanvasSize((current) =>
        current === backingSize ? current : backingSize,
      );
    });

    observer.observe(displayCanvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const renderCanvas = renderCanvasRef.current;
    if (!renderCanvas) return;
    const renderCtx = renderCanvas.getContext("2d");
    if (!renderCtx) return;
    const displayCanvas = displayCanvasRef.current;
    const displayCtx = displayCanvas?.getContext("2d") ?? null;

    let rafId = 0;
    const draw = () => {
      // Audio time is the source of truth for "what should be on screen".
      // rAF only decides when we paint.
      const audioTime = Tone.immediate();
      drawCurrentFrame(renderCtx, audioTime);
      if (displayCanvas && displayCtx) {
        // An empty render canvas is cleared through, not blitted as black,
        // so the idle poster beneath the display canvas shows.
        if (hasLiveFrame()) {
          displayCtx.drawImage(
            renderCanvas,
            0,
            0,
            displayCanvas.width,
            displayCanvas.height,
          );
        } else {
          displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        }
      }
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
          ref={renderCanvasRef}
          width={RENDER_CANVAS_SIZE}
          height={RENDER_CANVAS_SIZE}
          aria-hidden="true"
          className="ha-render-canvas w-full h-full rounded bg-zinc-950"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        {showPoster && posterUrl && (
          // Dimmed first-clip poster behind the display canvas: a live frame
          // paints over it, a cleared canvas reveals it. Both elements are
          // positioned, so DOM order decides which is on top.
          <img
            src={posterUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="ha-idle-poster absolute inset-0 w-full h-full object-cover rounded opacity-40 pointer-events-none"
          />
        )}
        <canvas
          ref={displayCanvasRef}
          width={displayCanvasSize}
          height={displayCanvasSize}
          aria-label="hard-cut video viewport"
          className="ha-canvas ha-display-canvas relative block w-full h-full rounded shadow-lg"
        />
        {showGate && <PermissionGate status={mediaStatus} error={mediaError} />}
        {showStation && <RecordingStation />}
        {(showAudioResumePill || showReconnectPill || resumeBothPending) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            {(showAudioResumePill && showReconnectPill) || resumeBothPending ? (
              <ResumePill onPendingChange={setResumeBothPending} />
            ) : (
              <>
                {showAudioResumePill && <AudioResumePill />}
                {showReconnectPill && <ReconnectPill />}
              </>
            )}
          </div>
        )}
        {mediaStatus === "granted" && !hasClips && stationDismissed && !isPlaying && (
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
      {showRecordMore && <RecordMoreButton hasClips={hasClips} />}
    </div>
  );
}

function ReconnectPill() {
  const recordingState = useAppStore((s) => s.recording.state);
  // isAcquireInFlight() reads module state that never triggers a re-render,
  // so the click-time transition needs local pending state to actually render
  // the button disabled while the acquire is unresolved (R6.1). On settlement
  // the store outcome decides what shows: granted unmounts the pill, a still
  // suspended/denied store leaves it tappable again.
  const [pending, setPending] = useState(false);
  const disabled = pending || recordingState !== "idle" || isAcquireInFlight();

  const reconnect = async () => {
    setPending(true);
    try {
      await useAppStore.getState().actions.resumeMedia();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void reconnect()}
      className="px-3 py-1 rounded-full bg-zinc-950/80 border border-orange-500/60 text-xs uppercase tracking-wide text-orange-300 hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950/80"
    >
      Camera disconnected — tap to reconnect
    </button>
  );
}

function AudioResumePill() {
  const [stillBlocked, setStillBlocked] = useState(false);

  const handleResume = async () => {
    setStillBlocked(false);
    try {
      await ensureAudioRunning();
    } catch {
      setStillBlocked(true);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => void handleResume()}
        className="px-3 py-1 rounded-full bg-zinc-950/80 border border-orange-500/60 text-xs uppercase tracking-wide text-orange-300 hover:bg-zinc-900/90"
      >
        Audio interrupted — tap to resume.
      </button>
      {stillBlocked && (
        <div className="px-3 py-1 rounded-full bg-zinc-950/80 border border-orange-500/60 text-xs text-orange-200">
          Still blocked — try the volume keys or reopen the app.
        </div>
      )}
    </div>
  );
}

// After a background/return both the AudioContext and the camera need the
// user back: one tap unlocks audio (which needs user activation) and then
// re-acquires the camera. A failed unlock keeps the existing still-blocked
// line and skips the reconnect — recording needs both, and the next tap
// retries both.
function ResumePill({ onPendingChange }: { onPendingChange: (pending: boolean) => void }) {
  const recordingState = useAppStore((s) => s.recording.state);
  const [pending, setPending] = useState(false);
  const [stillBlocked, setStillBlocked] = useState(false);
  const disabled = pending || recordingState !== "idle" || isAcquireInFlight();

  const resume = async () => {
    setPending(true);
    onPendingChange(true);
    setStillBlocked(false);
    // Declared before the unlock, exactly like a record flow, so the audio
    // session goes straight to "play-and-record" instead of being resumed
    // under "playback" and flipped a moment later by the camera acquire.
    const releaseClaim = noteMicAcquireStarted();
    try {
      try {
        await ensureAudioRunning();
      } catch {
        setStillBlocked(true);
        return;
      }
      // The unlock awaited a user-visible moment; re-check the world before
      // re-lighting the camera. A hide in between already suspended
      // everything (a late acquire would outlive that suspension), playback
      // or export must not run with the mic held, and a changed media state
      // means someone else already dealt with it.
      const state = useAppStore.getState();
      if (
        (typeof document !== "undefined" && document.hidden) ||
        !canStartAudibleAction(state) ||
        hasCurrentAudibleClaim() ||
        state.media.status !== "suspended"
      ) {
        return;
      }
      await state.actions.resumeMedia();
    } finally {
      releaseClaim();
      setPending(false);
      onPendingChange(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => void resume()}
        className="px-3 py-1 rounded-full bg-zinc-950/80 border border-orange-500/60 text-xs uppercase tracking-wide text-orange-300 hover:bg-zinc-900/90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-zinc-950/80"
      >
        Interrupted — tap to resume
      </button>
      {stillBlocked && (
        <div className="px-3 py-1 rounded-full bg-zinc-950/80 border border-orange-500/60 text-xs text-orange-200">
          Still blocked — try the volume keys or reopen the app.
        </div>
      )}
    </div>
  );
}

function RecordMoreButton({ hasClips }: { hasClips: boolean }) {
  return (
    <button
      type="button"
      onClick={() => useAppStore.getState().actions.reopenRecordingStation()}
      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 rounded-full bg-zinc-900 border border-zinc-700 hover:bg-zinc-800"
    >
      <Mic size={12} />
      {hasClips ? "Record more" : "Record first sound"}
    </button>
  );
}

interface PermissionGateProps {
  // Accepts the full MediaStatus union; "granted" is unreachable here because
  // the parent only renders this gate when status !== "granted".
  status: MediaStatus;
  // Only ever the fixed acquire line (set by media.ts for a non-denial probe
  // failure); the engine's own message never reaches this prop for "idle".
  error: string | null;
}

// "denied" is reserved for an explicit permission denial (media.ts), so the
// settings line is always the right advice there; engine error text stays in
// the log, never on screen.
function PermissionGate({ status, error }: PermissionGateProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-10">
      {status === "denied" ? (
        <>
          <Video size={32} className="text-red-400" aria-hidden />
          <div className="text-sm text-red-300 max-w-[20rem]">Camera blocked.</div>
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
          {status === "idle" && error && (
            <p role="alert" className="text-xs text-red-400 max-w-[18rem]">
              {error}
            </p>
          )}
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
