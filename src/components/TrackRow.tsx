// ABOUTME: TrackRow — one row of the sequencer: clip preview/record + 16 step toggles.
// ABOUTME: Track 0 has a working record button; other tracks show a placeholder until step 13.
import { useState } from "react";
import { Mic } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { recordClip } from "../lib/recorder";
import { getAudioContext } from "../lib/audio";
import type { Clip } from "../types";

const STEP_COUNT = 16;
const RECORD_DURATION_MS = 2000;

interface StepCellProps {
  trackId: number;
  stepIndex: number;
}

function StepCell({ trackId, stepIndex }: StepCellProps) {
  const active = useAppStore((s) => s.project.tracks[trackId].steps[stepIndex]);
  const isCurrent = useAppStore(
    (s) => s.playback.isPlaying && s.playback.currentStep === stepIndex,
  );
  const isDownbeat = stepIndex % 4 === 0;

  let className = "w-10 h-10 rounded transition-colors ";
  if (active) className += "bg-orange-500 hover:bg-orange-400";
  else if (isDownbeat) className += "bg-zinc-700 hover:bg-zinc-600";
  else className += "bg-zinc-800 hover:bg-zinc-600";
  if (isCurrent) className += " ring-2 ring-orange-300";

  return (
    <button
      type="button"
      aria-label={`track ${trackId + 1} step ${stepIndex + 1}`}
      aria-pressed={active}
      data-active={active}
      data-current={isCurrent}
      onClick={() => useAppStore.getState().actions.toggleStep(trackId, stepIndex)}
      className={className}
    />
  );
}

interface TrackRowProps {
  trackId: number;
}

export function TrackRow({ trackId }: TrackRowProps) {
  const clip = useAppStore((s) => s.project.tracks[trackId].clip);
  const stream = useAppStore((s) => s.media.stream);
  const recordingState = useAppStore((s) => s.recording.state);
  const activeTrackId = useAppStore((s) => s.recording.activeTrackId);
  const [error, setError] = useState<string | null>(null);

  const isRecordingThis = recordingState === "recording" && activeTrackId === trackId;

  const startRecording = async () => {
    if (!stream) {
      setError("Enable camera first");
      return;
    }
    setError(null);
    const actions = useAppStore.getState().actions;
    actions.setRecordingState("recording", trackId);
    try {
      const result = await recordClip(stream, RECORD_DURATION_MS, getAudioContext());
      const url = URL.createObjectURL(result.blob);
      const newClip: Clip = {
        blob: result.blob,
        url,
        audioBuffer: result.audioBuffer,
        trimStartMs: 0,
        trimEndMs: result.durationMs,
        durationMs: result.durationMs,
      };
      actions.setTrackClip(trackId, newClip);
      actions.setRecordingState("idle", null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      actions.setRecordingState("idle", null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-sm text-zinc-400 font-mono">T{trackId + 1}</span>
      <div className="w-16 h-12 flex items-center justify-center">
        {clip ? (
          <ClipThumbnail clip={clip} onClear={() => useAppStore.getState().actions.clearTrackClip(trackId)} />
        ) : (
          <button
            type="button"
            disabled={isRecordingThis}
            aria-label={`record clip for track ${trackId + 1}`}
            onClick={() => void startRecording()}
            className="w-12 h-12 rounded bg-zinc-800 border border-zinc-700 hover:bg-red-900 hover:border-red-700 disabled:opacity-50 flex items-center justify-center"
          >
            {isRecordingThis ? (
              <span className="text-xs text-red-400 animate-pulse">REC</span>
            ) : (
              <Mic size={18} className="text-zinc-400" />
            )}
          </button>
        )}
      </div>
      <div className="grid grid-cols-16 gap-1 flex-1">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <StepCell key={i} trackId={trackId} stepIndex={i} />
        ))}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

interface ClipThumbnailProps {
  clip: Clip;
  onClear: () => void;
}

function ClipThumbnail({ clip, onClear }: ClipThumbnailProps) {
  return (
    <div className="relative group w-12 h-12">
      <video
        src={clip.url}
        muted
        playsInline
        preload="metadata"
        className="w-12 h-12 rounded object-cover bg-zinc-900"
      />
      <button
        type="button"
        aria-label="re-record"
        onClick={onClear}
        className="absolute inset-0 rounded bg-black/60 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity"
      >
        Re-record
      </button>
    </div>
  );
}
