// ABOUTME: TrackInfo — left-side per-track panel: label, mic/clip thumbnail, eye toggle, tag picker, auto-tag status.
// ABOUTME: Sticky in the StepGrid left column so the cells can scroll horizontally while track info stays visible.
import { useEffect, useRef, useState } from "react";
import { Mic, Eye, EyeOff } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { recordIntoTrack, type AutoTagEvent } from "../lib/recordingFlow";
import type { Clip, Tag } from "../types";

const AUTO_TAG_TOAST_MS = 3000;
type AutoTagState =
  | { kind: "idle" }
  | { kind: "tagging" }
  | { kind: "applied"; tag: Tag; hatAudioOnly: boolean }
  | { kind: "miss" };

const TAGS: Tag[] = ["kick", "snare", "hat", "vocal", "fx"];

interface TrackInfoProps {
  trackId: number;
}

export function TrackInfo({ trackId }: TrackInfoProps) {
  const clip = useAppStore((s) => s.project.tracks[trackId].clip);
  const tag = useAppStore((s) => s.project.tracks[trackId].tag);
  const recordingState = useAppStore((s) => s.recording.state);
  const activeTrackId = useAppStore((s) => s.recording.activeTrackId);
  const [error, setError] = useState<string | null>(null);
  const [autoTagState, setAutoTagState] = useState<AutoTagState>({ kind: "idle" });
  const toastTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const isRecordingThis = recordingState === "recording" && activeTrackId === trackId;

  const scheduleToastReset = () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setAutoTagState({ kind: "idle" });
    }, AUTO_TAG_TOAST_MS);
  };

  const startRecording = async () => {
    setError(null);
    await recordIntoTrack(trackId, {
      onAutoTag: (event: AutoTagEvent) => {
        if (event.kind === "applied") {
          setAutoTagState({ kind: "applied", tag: event.tag, hatAudioOnly: event.hatAudioOnly });
          scheduleToastReset();
        } else if (event.kind === "miss") {
          setAutoTagState({ kind: "miss" });
          scheduleToastReset();
        } else {
          setAutoTagState(event);
        }
      },
      onError: setError,
    });
  };

  const label = tag ? tag.toUpperCase() : `T${trackId + 1}`;

  return (
    <div className="h-12 flex items-center gap-2 pr-2">
      <span
        className={
          "w-14 text-sm font-mono " + (tag ? "text-orange-400" : "text-zinc-500")
        }
        title={tag ? `Track ${trackId + 1}` : undefined}
      >
        {label}
      </span>
      <div className="w-12 h-12 flex items-center justify-center">
        {clip ? (
          <ClipThumbnail
            clip={clip}
            onClear={() => useAppStore.getState().actions.clearTrackClip(trackId)}
          />
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
      {clip ? <TagPicker trackId={trackId} selected={tag} /> : <div className="w-24 shrink-0" />}
      <AutoTagStatus state={autoTagState} />
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
    text = "couldn't auto-tag, pick one";
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
  const label = showVideo ? "Show video on cut" : "Audio only, no video cut";
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
    <div
      className="grid grid-cols-2 gap-0.5 w-24 shrink-0"
      role="group"
      aria-label={`tags for track ${trackId + 1}`}
    >
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
              "px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wide leading-none " +
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
