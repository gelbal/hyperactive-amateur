// ABOUTME: RecordingStation — in-viewport sequential walkthrough for filling track clips one by one.
// ABOUTME: Auto-targets the lowest empty track; offers Record / Skip / Done. Reuses the shared recording flow.
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, SkipForward, Check } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { recordIntoTrack } from "../lib/recordingFlow";

const TRACK_COUNT = 8;

interface Props {
  size: number;
}

export function RecordingStation({ size }: Props) {
  const stream = useAppStore((s) => s.media.stream);
  const recordingState = useAppStore((s) => s.recording.state);
  const tracks = useAppStore((s) => s.project.tracks);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // Lowest-index empty track that the user hasn't skipped this session.
  const target = useMemo(() => {
    for (let i = 0; i < TRACK_COUNT; i++) {
      if (!tracks[i].clip && !skipped.has(i)) return i;
    }
    return null;
  }, [tracks, skipped]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  // If the user records into the current target externally (via a TrackRow),
  // the target advances automatically because tracks[i].clip becomes truthy.

  if (target === null) return null;

  const isBusy = recordingState !== "idle";

  const onRecord = () => {
    setError(null);
    void recordIntoTrack(target, {
      onError: setError,
    });
  };

  const onSkip = () => {
    setSkipped((s) => new Set(s).add(target));
  };

  const onDone = () => {
    useAppStore.getState().actions.dismissRecordingStation();
  };

  return (
    <div
      className="absolute inset-0 rounded overflow-hidden"
      style={{ width: size, height: size }}
      aria-label="recording station"
      role="region"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover bg-zinc-900"
        aria-hidden
      />
      {/* Vignette for legibility */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0) 35%, rgba(9,9,11,0) 60%, rgba(9,9,11,0.75) 100%)",
        }}
      />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-zinc-950/70 border border-zinc-800 text-xs uppercase tracking-wide text-zinc-300">
        Recording for Track {target + 1}
      </div>
      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-3 px-4">
        {error && (
          <span role="alert" className="text-xs text-red-400 max-w-[80%] text-center">
            {error}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onRecord}
            aria-label={`Record clip for track ${target + 1}`}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500 text-zinc-950 font-medium hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Circle size={14} fill="currentColor" />
            Record
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onSkip}
            aria-label="Skip this track"
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/80 text-zinc-200 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
          >
            <SkipForward size={14} />
            Skip
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onDone}
            aria-label="Done recording"
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/80 text-zinc-200 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Check size={14} />
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
