// ABOUTME: TrackRow — one row of the sequencer: clip preview/record + tag picker + step toggles.
// ABOUTME: Owns the per-track record flow; thumbnails enable re-record on hover.
import { useState } from "react";
import { Mic, Eye, EyeOff } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { recordClip } from "../lib/recorder";
import { getAudioContext } from "../lib/audio";
import { autoTrim } from "../lib/autoTrim";
import { autoTag } from "../lib/aiAutoTag";
import { requestMedia } from "../lib/media";
import type { Clip, Tag } from "../types";

const AUTO_TAG_CONFIDENCE_THRESHOLD = 0.6;
const AUTO_TAG_TOAST_MS = 3000;
type AutoTagState =
  | { kind: "idle" }
  | { kind: "tagging" }
  | { kind: "applied"; tag: Tag; hatAudioOnly: boolean }
  | { kind: "miss" };

const TAGS: Tag[] = ["kick", "snare", "hat", "vocal", "fx"];

const STEP_COUNT = 16;
const RECORD_DURATION_MS = 2000;
const COUNTDOWN_MS = 3000;

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
  const tag = useAppStore((s) => s.project.tracks[trackId].tag);
  const stream = useAppStore((s) => s.media.stream);
  const recordingState = useAppStore((s) => s.recording.state);
  const activeTrackId = useAppStore((s) => s.recording.activeTrackId);
  const [error, setError] = useState<string | null>(null);
  const [autoTagState, setAutoTagState] = useState<AutoTagState>({ kind: "idle" });

  const isRecordingThis = recordingState === "recording" && activeTrackId === trackId;

  const startRecording = async () => {
    if (!stream) {
      // Trigger the permission flow instead of nagging the user; the viewport
      // gate will surface the prompt prominently.
      void requestMedia();
      return;
    }
    setError(null);
    const actions = useAppStore.getState().actions;
    actions.setRecordingState("countdown", trackId);
    await new Promise((r) => setTimeout(r, COUNTDOWN_MS));
    actions.setRecordingState("recording", trackId);
    try {
      const result = await recordClip(stream, RECORD_DURATION_MS, getAudioContext());
      const url = URL.createObjectURL(result.blob);
      const trim = autoTrim(result.audioBuffer);
      const newClip: Clip = {
        blob: result.blob,
        url,
        audioBuffer: result.audioBuffer,
        trimStartMs: trim.trimStartMs,
        trimEndMs: trim.trimEndMs,
        durationMs: result.durationMs,
      };
      actions.setTrackClip(trackId, newClip);
      actions.setRecordingState("idle", null);
      void runAutoTag(result.audioBuffer);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      actions.setRecordingState("idle", null);
    }
  };

  const runAutoTag = async (audioBuffer: AudioBuffer) => {
    setAutoTagState({ kind: "tagging" });
    const result = await autoTag(audioBuffer);
    if (!result || result.confidence < AUTO_TAG_CONFIDENCE_THRESHOLD) {
      setAutoTagState({ kind: "miss" });
      window.setTimeout(() => setAutoTagState({ kind: "idle" }), AUTO_TAG_TOAST_MS);
      return;
    }
    const actions = useAppStore.getState().actions;
    actions.setTrackTag(trackId, result.tag);
    let hatAudioOnly = false;
    if (result.tag === "hat") {
      const manuallyToggled = useAppStore
        .getState()
        .session.manuallyToggledShowVideo.includes(trackId);
      if (!manuallyToggled) {
        actions.setTrackShowVideo(trackId, false, "system");
        hatAudioOnly = true;
      }
    }
    setAutoTagState({ kind: "applied", tag: result.tag, hatAudioOnly });
    window.setTimeout(() => setAutoTagState({ kind: "idle" }), AUTO_TAG_TOAST_MS);
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
      <ShowVideoToggle trackId={trackId} />
      {clip ? <TagPicker trackId={trackId} selected={tag} /> : <div className="w-32" />}
      <AutoTagStatus state={autoTagState} />
      <div className="grid grid-cols-16 gap-1 flex-1">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <StepCell key={i} trackId={trackId} stepIndex={i} />
        ))}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

function AutoTagStatus({ state }: { state: AutoTagState }) {
  if (state.kind === "idle") return null;
  let text = "";
  let cls = "text-zinc-400";
  if (state.kind === "tagging") {
    text = "tagging…";
    cls = "text-zinc-400 animate-pulse";
  } else if (state.kind === "applied") {
    text = state.hatAudioOnly ? `tagged ${state.tag} → audio-only` : `tagged ${state.tag}`;
    cls = "text-orange-400";
  } else {
    text = "couldn't auto-tag — pick one";
    cls = "text-zinc-500";
  }
  return (
    <span role="status" className={`text-[10px] uppercase tracking-wide ${cls} w-32 truncate`}>
      {text}
    </span>
  );
}

interface ShowVideoToggleProps {
  trackId: number;
}

function ShowVideoToggle({ trackId }: ShowVideoToggleProps) {
  const showVideo = useAppStore((s) => s.project.tracks[trackId].showVideo);
  const label = showVideo ? "Show video on cut" : "Audio only — no video cut";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-show-video={showVideo}
      onClick={() => useAppStore.getState().actions.setTrackShowVideo(trackId, !showVideo)}
      className={
        "w-7 h-7 rounded flex items-center justify-center transition-colors " +
        (showVideo ? "text-orange-500 hover:text-orange-400" : "text-zinc-500 hover:text-zinc-300")
      }
    >
      {showVideo ? <Eye size={16} /> : <EyeOff size={16} />}
    </button>
  );
}

interface TagPickerProps {
  trackId: number;
  selected: Tag | null;
}

function TagPicker({ trackId, selected }: TagPickerProps) {
  const onClick = (tag: Tag) => {
    const next = selected === tag ? null : tag;
    useAppStore.getState().actions.setTrackTag(trackId, next);
  };
  return (
    <div className="flex gap-1 flex-wrap w-32" role="group" aria-label={`tags for track ${trackId + 1}`}>
      {TAGS.map((tag) => {
        const isSelected = selected === tag;
        return (
          <button
            key={tag}
            type="button"
            aria-label={`tag ${tag} for track ${trackId + 1}`}
            aria-pressed={isSelected}
            data-selected={isSelected}
            onClick={() => onClick(tag)}
            className={
              "px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide " +
              (isSelected
                ? "bg-orange-500 text-zinc-950"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600")
            }
          >
            {tag}
          </button>
        );
      })}
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
