// ABOUTME: Viewport — square canvas that the hard-cut video renderer draws into.
// ABOUTME: Owns the empty state: camera-permission gate, recording station, then "record more" affordance.
import { useEffect, useRef } from "react";
import * as Tone from "tone";
import { Camera, Mic, Video } from "lucide-react";
import { drawCurrentFrame, initVideoEngine, setActiveCanvas } from "../lib/videoEngine";
import { useAppStore } from "../store/useAppStore";
import { requestMedia } from "../lib/media";
import { RecordingStation } from "./RecordingStation";

const SIZE = 480;
const TRACK_COUNT = 8;

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasClips = useAppStore((s) => s.project.tracks.some((t) => t.clip));
  const emptyTrackCount = useAppStore(
    (s) => s.project.tracks.filter((t) => !t.clip).length,
  );
  const stationDismissed = useAppStore((s) => s.session.recordingStationDismissed);
  const mediaStatus = useAppStore((s) => s.media.status);
  const mediaError = useAppStore((s) => s.media.error);
  const showStation =
    mediaStatus === "granted" && emptyTrackCount > 0 && !stationDismissed;
  const showRecordMore =
    mediaStatus === "granted" &&
    emptyTrackCount > 0 &&
    emptyTrackCount < TRACK_COUNT &&
    stationDismissed;

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

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          aria-label="hard-cut video viewport"
          className="block bg-zinc-950 rounded shadow-lg"
          style={{ width: SIZE, height: SIZE }}
        />
        {mediaStatus !== "granted" && <PermissionGate status={mediaStatus} error={mediaError} />}
        {showStation && <RecordingStation size={SIZE} />}
        {mediaStatus === "granted" && !hasClips && stationDismissed && <RecordPrompt />}
      </div>
      {showRecordMore && <RecordMoreButton />}
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
  status: "idle" | "requesting" | "denied";
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
