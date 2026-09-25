// ABOUTME: TrackInfo — left-side per-track panel: sound button or tag label, mic/clip thumbnail, eye toggle, tag picker or clip actions, auto-tag status.
// ABOUTME: Sticky in the StepGrid left column so the cells can scroll horizontally while track info stays visible.
import { forwardRef, useEffect, useRef, useState } from "react";
import { Mic, Eye, EyeOff, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { nextVoiceId, voiceFor } from "../lib/drumKit";
import { triggerTrackNow } from "../lib/audio";
import { runAudibleAction } from "../lib/audibleActionRunner";
import { recordIntoTrack, type AutoTagEvent } from "../lib/recordingFlow";
import { canStartAudibleAction } from "../lib/audibleActionGate";
import { AI_OFFLINE_COPY } from "../lib/aiOffline";
import type { Clip, Tag } from "../types";

const AUTO_TAG_TOAST_MS = 3000;
// Re-record / Delete close on their own after this long.
const CLIP_ACTIONS_MS = 5000;
type AutoTagState =
  | { kind: "idle" }
  | { kind: "tagging" }
  | { kind: "applied"; tag: Tag; hatAudioOnly: boolean }
  | { kind: "offline" }
  | { kind: "miss" };

const TAGS: Tag[] = ["kick", "snare", "hat", "vocal", "fx"];

interface TrackInfoProps {
  trackId: number;
}

export function TrackInfo({ trackId }: TrackInfoProps) {
  const clip = useAppStore((s) => s.project.tracks[trackId].clip);
  const tag = useAppStore((s) => s.project.tracks[trackId].tag);
  const voiceId = useAppStore((s) => s.project.tracks[trackId].voice);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const isPlaying = useAppStore((s) => s.playback.isPlaying);
  const [clipActionsOpen, setClipActionsOpen] = useState(false);
  // Keyboard focus on Re-record / Delete holds them open, so a keyboard
  // user deciding between them does not lose their place.
  const [clipActionsFocused, setClipActionsFocused] = useState(false);
  const thumbRef = useRef<HTMLButtonElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const soundButtonRef = useRef<HTMLButtonElement | null>(null);
  // Set by Re-record / Delete: the sound button that replaces the thumbnail
  // takes focus once the clip is gone.
  const focusSoundOnEmptyRef = useRef(false);
  const recordingState = useAppStore((s) => s.recording.state);
  const activeTrackId = useAppStore((s) => s.recording.activeTrackId);
  const recordingError = useAppStore((s) => s.recording.error);
  const recordingStationShowing = useAppStore(
    (s) =>
      s.media.status === "granted" &&
      s.project.tracks.some((track) => !track.clip) &&
      !s.session.recordingStationDismissed &&
      // Mirrors Viewport's suppression: while playback runs the station is
      // unmounted, so errors must fall back to the track row.
      !s.playback.isPlaying,
  );
  const canStartRecording = useAppStore(canStartAudibleAction);
  const [error, setError] = useState<string | null>(null);
  const [autoTagState, setAutoTagState] = useState<AutoTagState>({ kind: "idle" });
  const toastTimerRef = useRef<number | null>(null);
  const wasLastRecordingTrackRef = useRef(false);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!clipActionsOpen || clipActionsFocused) return;
    const id = window.setTimeout(() => setClipActionsOpen(false), CLIP_ACTIONS_MS);
    return () => window.clearTimeout(id);
  }, [clipActionsOpen, clipActionsFocused]);

  // A new or deleted clip, playback starting or an export closes Re-record /
  // Delete. Focus inside them goes back to the thumbnail instead of the page.
  useEffect(() => {
    if (actionsRef.current?.contains(document.activeElement)) thumbRef.current?.focus();
    setClipActionsOpen(false);
    setClipActionsFocused(false);
  }, [clip, isPlaying, isExporting]);

  useEffect(() => {
    if (clip || !focusSoundOnEmptyRef.current) return;
    focusSoundOnEmptyRef.current = false;
    soundButtonRef.current?.focus();
  }, [clip]);

  useEffect(() => {
    if (recordingState === "preparing" && activeTrackId !== trackId) {
      wasLastRecordingTrackRef.current = false;
    }
    if (activeTrackId === trackId && recordingState !== "idle") {
      wasLastRecordingTrackRef.current = true;
    }
    if (recordingState === "idle" && !recordingError) {
      wasLastRecordingTrackRef.current = false;
    }
  }, [activeTrackId, recordingError, recordingState, trackId]);

  const isRecordingThis = recordingState === "recording" && activeTrackId === trackId;
  const visibleRecordingError =
    !recordingStationShowing &&
    recordingError &&
    (activeTrackId === trackId || wasLastRecordingTrackRef.current)
      ? recordingError
      : null;
  const visibleError = visibleRecordingError ?? error;

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

  // clearTrackClip keeps the tag, so the clip decides: an empty track shows
  // the kit voice it plays as a button that changes it; a recorded track
  // shows its tag upper-case in orange (or Tn).
  const clipTag = clip ? tag : null;
  const voice = voiceFor({ id: trackId, voice: voiceId });

  // Read the store fresh, so quick taps each move one sound on. The audition
  // goes through the audible gate: nothing sounds while playing, recording
  // or exporting (the next step plays the new sound).
  const changeSound = () => {
    const track = useAppStore.getState().project.tracks[trackId];
    useAppStore.getState().actions.setTrackVoice(trackId, nextVoiceId(voiceFor(track).id));
    runAudibleAction(triggerTrackNow(trackId));
  };

  return (
    <div className="h-12 flex items-center gap-2 pr-2">
      {clip ? (
        <span
          className={"w-14 text-sm font-mono " + (clipTag ? "text-orange-400" : "text-zinc-400")}
          title={clipTag ? `Track ${trackId + 1}` : undefined}
        >
          {clipTag ? clipTag.toUpperCase() : `T${trackId + 1}`}
        </span>
      ) : (
        <button
          ref={soundButtonRef}
          type="button"
          aria-label={`Change sound for track ${trackId + 1}, now ${voice.name}`}
          title="Tap to change the sound"
          disabled={isExporting}
          onClick={changeSound}
          className="w-14 h-12 shrink-0 px-0.5 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-mono tracking-tight leading-tight text-zinc-300 flex items-center justify-center text-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {voice.name}
        </button>
      )}
      {/* Announces a new sound even when nothing plays (during playback). */}
      <span className="sr-only" aria-live="polite">
        {clip ? "" : `track ${trackId + 1} sound: ${voice.name}`}
      </span>
      <div className="w-12 h-12 flex items-center justify-center">
        {clip ? (
          <ClipThumbnail
            ref={thumbRef}
            clip={clip}
            trackId={trackId}
            actionsOpen={clipActionsOpen}
            disabled={isExporting}
            onToggleActions={() => setClipActionsOpen((open) => !open)}
          />
        ) : (
          <button
            type="button"
            disabled={!canStartRecording}
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
      {clip ? (
        clipActionsOpen ? (
          <ClipActions
            ref={actionsRef}
            trackId={trackId}
            disabled={isExporting}
            onFocusChange={setClipActionsFocused}
            onReRecord={() => {
              focusSoundOnEmptyRef.current = true;
              setClipActionsOpen(false);
              useAppStore.getState().actions.clearTrackClip(trackId);
            }}
            onDelete={() => {
              focusSoundOnEmptyRef.current = true;
              setClipActionsOpen(false);
              useAppStore.getState().actions.deleteTrackClip(trackId);
            }}
          />
        ) : (
          <TagPicker trackId={trackId} selected={tag} />
        )
      ) : (
        <div className="w-24 shrink-0" />
      )}
      {clip?.audioStatus === "unavailable" ? (
        <span className="w-40 shrink-0 text-[10px] text-amber-300">
          audio unavailable — re-record
        </span>
      ) : (
        <AutoTagStatus state={autoTagState} />
      )}
      {visibleError && <span className="text-xs text-red-400">{visibleError}</span>}
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
  } else if (state.kind === "offline") {
    text = AI_OFFLINE_COPY;
    cls = "text-red-400";
  } else {
    text = "couldn't auto-tag, pick one";
    cls = "text-zinc-500";
  }
  const widthClass = state.kind === "offline" ? "w-40" : "w-32 truncate";
  return (
    <span role="status" className={`text-[10px] uppercase tracking-wide ${cls} ${widthClass}`}>
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
        "w-7 h-7 pointer-coarse:w-11 pointer-coarse:h-11 rounded flex items-center justify-center transition-colors " +
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
  // The chips stay compact on every pointer type: three 2-column rows must
  // fit inside the fixed h-12 track row, or adjacent tracks' chips overlap
  // (the coarse-pointer padding bump shipped exactly that overlap). A proper
  // 44px touch tag picker needs a popover/sheet — tracked in NEXT-STEPS.
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
  trackId: number;
  actionsOpen: boolean;
  disabled: boolean;
  onToggleActions: () => void;
}

// A tap opens Re-record / Delete beside it, so no single tap destroys a take.
const ClipThumbnail = forwardRef<HTMLButtonElement, ClipThumbnailProps>(function ClipThumbnail(
  { clip, trackId, actionsOpen, disabled, onToggleActions },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`clip actions for track ${trackId + 1}`}
      aria-expanded={actionsOpen}
      disabled={disabled}
      onClick={onToggleActions}
      className={
        "relative group w-12 h-12 rounded disabled:opacity-50 disabled:cursor-not-allowed " +
        (actionsOpen ? "ring-2 ring-orange-500" : "")
      }
    >
      {clip.posterUrl ? (
        <img
          src={clip.posterUrl}
          alt=""
          aria-hidden
          className="w-12 h-12 rounded object-cover bg-zinc-900"
        />
      ) : (
        <div
          aria-hidden
          className="w-12 h-12 rounded bg-zinc-900 flex items-center justify-center"
        >
          <Mic size={18} className="text-zinc-600" />
        </div>
      )}
      <span
        aria-hidden
        data-clip-actions-hint
        className={
          "absolute inset-0 rounded bg-black/60 text-white flex items-center justify-center transition-opacity " +
          (actionsOpen
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 any-pointer-coarse:opacity-40 any-pointer-coarse:group-hover:opacity-100")
        }
      >
        <MoreHorizontal size={18} />
      </span>
    </button>
  );
});

interface ClipActionsProps {
  trackId: number;
  disabled: boolean;
  onFocusChange: (focused: boolean) => void;
  onReRecord: () => void;
  onDelete: () => void;
}

// Sits where the tag chips are while open: two 44 px targets inside the
// 48 px row, no popover to clip or position.
const ClipActions = forwardRef<HTMLDivElement, ClipActionsProps>(function ClipActions(
  { trackId, disabled, onFocusChange, onReRecord, onDelete },
  ref,
) {
  return (
    <div
      ref={ref}
      className="w-24 shrink-0 flex gap-1"
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange(false);
      }}
    >
      <button
        type="button"
        aria-label={`re-record track ${trackId + 1}`}
        disabled={disabled}
        onClick={onReRecord}
        className="disabled:opacity-50 flex-1 h-11 rounded border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] flex flex-col items-center justify-center gap-0.5"
      >
        <RotateCcw size={14} aria-hidden />
        redo
      </button>
      <button
        type="button"
        aria-label={`delete clip on track ${trackId + 1}`}
        disabled={disabled}
        onClick={onDelete}
        className="disabled:opacity-50 flex-1 h-11 rounded border border-red-700 bg-red-950 hover:bg-red-900 text-red-200 text-[10px] flex flex-col items-center justify-center gap-0.5"
      >
        <Trash2 size={14} aria-hidden />
        delete
      </button>
    </div>
  );
});
