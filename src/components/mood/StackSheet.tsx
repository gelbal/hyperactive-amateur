// ABOUTME: StackSheet — Mood mic take chooser as anchored popover or coarse bottom sheet.
// ABOUTME: Routes take/off selection through moodPerformance so touch and keys share arming.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Plus, Power, Trash2, X } from "lucide-react";
import { usePopoverDismiss } from "../../lib/usePopoverDismiss";
import * as moodPerformance from "../../lib/moodPerformance";
import { recordMoodTake } from "../../lib/moodRecordingFlow";
import { MAX_TAKES_PER_MIC } from "../../lib/moodStages";
import { useAppStore } from "../../store/useAppStore";
import type { MoodMic, MoodPart, MoodSelectionEntry, MoodTake, RecordingState } from "../../types";
import { EmptyMicThumb } from "./EmptyMicThumb";

interface StackSheetProps {
  mic: MoodMic;
  micNumber: number;
  open: boolean;
  onClose: () => void;
}

const PART_OPTIONS: Array<{ value: MoodPart | null; label: string }> = [
  { value: "lead", label: "lead" },
  { value: "harmony", label: "harm" },
  { value: "bass", label: "bass" },
  { value: "beatbox", label: "beat" },
  { value: "adlib", label: "adlib" },
  { value: null, label: "none" },
];

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function partShortLabel(take: MoodTake): string {
  if (!take.part) return "part?";
  return PART_OPTIONS.find((option) => option.value === take.part)?.label ?? "part?";
}

function recordDisabledReason({
  isExporting,
  recordingState,
  takeCount,
}: {
  isExporting: boolean;
  recordingState: RecordingState;
  takeCount: number;
}): "exporting" | "another recording active" | "stack full" | null {
  if (isExporting) return "exporting";
  if (recordingState !== "idle") return "another recording active";
  if (takeCount >= MAX_TAKES_PER_MIC) return "stack full";
  return null;
}

type DeleteDisabledReason = "recording" | "live take" | "exporting" | null;

function deleteDisabledTitle(reason: DeleteDisabledReason): string | undefined {
  if (reason === "recording") return "locked during capture";
  if (reason === "live take") return "stop the performance first";
  if (reason === "exporting") return "frozen during export";
  return undefined;
}

function TakeEntry({
  confirmingDelete,
  checking,
  deleteDisabledReason,
  disabled,
  micId,
  open,
  onClose,
  onConfirmDelete,
  onCancelDelete,
  onRequestDelete,
  onOpen,
  onSelect,
  selected,
  take,
  takeNumber,
}: {
  confirmingDelete: boolean;
  checking: boolean;
  deleteDisabledReason: DeleteDisabledReason;
  disabled: boolean;
  micId: string;
  open: boolean;
  onClose: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onRequestDelete: () => void;
  onOpen: () => void;
  onSelect: () => void;
  selected: boolean;
  take: MoodTake;
  takeNumber: number;
}) {
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const optionGroupId = useId();

  useEffect(() => {
    if (open) {
      firstOptionRef.current?.focus();
    } else if (wasOpenRef.current) {
      chipRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  const choosePart = (part: MoodPart | null) => {
    if (disabled) return;
    const expectedRevision = useAppStore.getState().session.moodRevision;
    useAppStore
      .getState()
      .actions.applyMoodPartIfCurrent(micId, take.id, part, "user", expectedRevision);
    onClose();
  };

  const rowState = selected
    ? "border-orange-500 bg-orange-500/10 text-orange-100"
    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900";
  const aiSuggested = take.partSource === "ai";
  const checkingPart = checking && take.part === null;
  const partAriaLabel = checkingPart
    ? `part for take ${takeNumber}: none, checking`
    : aiSuggested
      ? `part for take ${takeNumber}: ${take.part ?? "none"}, AI suggestion`
      : `part for take ${takeNumber}: ${take.part ?? "none"} — change`;

  return (
    <div data-take-entry className="flex w-full min-w-0 flex-col gap-1">
      <div
        data-take-row
        className={`flex min-h-11 w-full min-w-0 items-center gap-1 rounded border p-1 text-sm transition-colors pointer-coarse:min-h-12 ${rowState}`}
      >
        <button
          type="button"
          aria-label={`Take ${takeNumber} ${formatDuration(take.durationSeconds)}`}
          onClick={onSelect}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded px-2 text-left pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          <TakeThumb take={take} />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-zinc-100">Take {takeNumber}</span>
            <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-zinc-500">
              <span>{formatDuration(take.durationSeconds)}</span>
              {take.cycleMultiple !== 1 ? (
                <span className="font-mono text-zinc-500">×{take.cycleMultiple}</span>
              ) : null}
            </span>
          </span>
        </button>
        <button
          ref={chipRef}
          type="button"
          aria-label={partAriaLabel}
          aria-expanded={open}
          aria-controls={optionGroupId}
          disabled={disabled}
          title={disabled ? "frozen during export" : undefined}
          onClick={open ? onClose : onOpen}
          className="flex min-h-8 min-w-14 shrink-0 items-center justify-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-2 text-[10px] uppercase leading-none text-zinc-300 transition-colors pointer-coarse:min-h-11 pointer-coarse:px-2 hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checkingPart ? "part? · checking" : partShortLabel(take)}
          {!checkingPart && aiSuggested ? (
            <span className="rounded-sm bg-orange-500 px-1 py-0.5 text-[7px] font-black text-zinc-950">
              AI
            </span>
          ) : null}
        </button>
        <div className="ml-auto flex min-h-11 shrink-0 items-center gap-1 pointer-coarse:min-h-12">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                aria-label={`Confirm remove take ${takeNumber}`}
                onClick={onConfirmDelete}
                className="flex h-10 w-10 items-center justify-center rounded border border-red-500/50 bg-red-950/60 text-red-200 pointer-coarse:h-11 pointer-coarse:w-11 hover:bg-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <Check size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Cancel remove take ${takeNumber}`}
                onClick={onCancelDelete}
                className="flex h-10 w-10 items-center justify-center rounded border border-zinc-700 bg-zinc-950 text-zinc-300 pointer-coarse:h-11 pointer-coarse:w-11 hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label={
                  deleteDisabledReason
                    ? `Remove take ${takeNumber} disabled, ${deleteDisabledReason}`
                    : `Remove take ${takeNumber}`
                }
                disabled={deleteDisabledReason !== null}
                title={deleteDisabledTitle(deleteDisabledReason)}
                onClick={onRequestDelete}
                className="flex h-10 w-10 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-500 pointer-coarse:h-11 pointer-coarse:w-11 hover:border-red-700 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
              {deleteDisabledReason ? (
                <span className="max-w-12 text-[10px] leading-tight text-zinc-500">
                  {deleteDisabledReason}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      {open && (
        <div
          id={optionGroupId}
          data-part-picker-open="true"
          className="flex w-full flex-wrap gap-1 rounded border border-zinc-800 bg-zinc-950/70 p-1"
          role="group"
          aria-label={`parts for take ${takeNumber}`}
        >
          {PART_OPTIONS.map((option, index) => {
            const isSelected = take.part === option.value;
            const accessiblePart = option.value ?? "none";
            return (
              <button
                key={accessiblePart}
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                aria-label={`part ${accessiblePart} for take ${takeNumber}`}
                aria-pressed={isSelected}
                data-selected={isSelected}
                disabled={disabled}
                title={disabled ? "frozen during export" : undefined}
                onClick={() => choosePart(option.value)}
                className={
                  "min-h-8 flex-1 rounded px-2 py-1 text-[10px] uppercase leading-none transition-colors pointer-coarse:min-h-11 pointer-coarse:px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50 " +
                  (isSelected
                    ? "bg-orange-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200")
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TakeThumb({ take }: { take: MoodTake }) {
  if (take.posterUrl) {
    return (
      <img
        src={take.posterUrl}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded object-cover bg-zinc-950"
      />
    );
  }

  return <EmptyMicThumb />;
}

export function StackSheet({ mic, micNumber, open, onClose }: StackSheetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openPartTakeId, setOpenPartTakeId] = useState<string | null>(null);
  const activeEntry = useAppStore(
    (s) => s.mood.performance.armed[mic.id] ?? s.mood.performance.selections[mic.id] ?? "off",
  );
  const performance = useAppStore((s) => s.mood.performance);
  const piece = useAppStore((s) => s.mood.piece);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const recordingState = useAppStore((s) => s.recording.state);
  const partCheckingTakeIds = useAppStore((s) => s.mood.partCheckingTakeIds);
  const sheetMic = piece?.mics.find((candidate) => candidate.id === mic.id) ?? mic;
  const beforeTheOne = piece?.cycleSeconds === null;
  const disabledReason = recordDisabledReason({
    isExporting,
    recordingState,
    takeCount: sheetMic.takes.length,
  });
  const canRecordTake = Boolean(piece) && disabledReason === null;
  const recordLabel = beforeTheOne ? "record the One" : "new take";
  const recordSubtitle =
    disabledReason ??
    (beforeTheOne ? "your first loop sets the length" : "starts at the top of the loop");
  const recordDisabledTitle =
    disabledReason === "exporting"
      ? "frozen during export"
      : disabledReason === "another recording active"
        ? "locked during capture"
        : disabledReason ?? undefined;
  const close = useCallback(() => onClose(), [onClose]);
  usePopoverDismiss(rootRef, open, close);

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null);
      setOpenPartTakeId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || openPartTakeId === null) return;
    const closePickerAway = (event: MouseEvent) => {
      const openPicker = rootRef.current?.querySelector('[data-part-picker-open="true"]');
      if (openPicker?.contains(event.target as Node)) return;
      setOpenPartTakeId(null);
    };
    document.addEventListener("mousedown", closePickerAway);
    return () => document.removeEventListener("mousedown", closePickerAway);
  }, [open, openPartTakeId]);

  if (!open) return null;

  const choose = (entry: MoodSelectionEntry) => {
    moodPerformance.armSelection(mic.id, entry);
    onClose();
  };
  const recordNextTake = () => {
    if (!canRecordTake) return;
    void recordMoodTake(mic.id, {
      onError: (message) => useAppStore.getState().actions.setRecordingError(message),
    });
    onClose();
  };
  const deleteTake = (takeId: string) => {
    useAppStore.getState().actions.deleteMoodTake(mic.id, takeId);
    setConfirmDeleteId(null);
  };

  const rowBase =
    "flex min-h-11 w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm transition-colors pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500";
  const selectedRow = "border-orange-500 bg-orange-500/10 text-orange-100";
  const idleRow = "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Mic ${micNumber} stack`}
      // Fine pointers open UPWARD over the stage: the fixed-height mood
      // column leaves too little room below the strip, and opening up keeps
      // the sheet clear of the panel with no page scroll.
      className="absolute left-0 bottom-full z-40 mb-2 flex w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(60vh,28rem)] flex-col gap-2 overflow-x-hidden overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 shadow-xl pointer-coarse:fixed pointer-coarse:inset-x-3 pointer-coarse:bottom-3 pointer-coarse:top-auto pointer-coarse:mb-0 pointer-coarse:w-auto pointer-coarse:max-w-none pointer-coarse:max-h-[min(70dvh,32rem)] pointer-coarse:rounded-lg"
    >
      <div className="px-1">
        <span className="font-mono text-xs uppercase text-zinc-500">MIC {micNumber}</span>
      </div>

      <div className="flex flex-col gap-1">
        {sheetMic.takes.map((take, index) => {
          const selected = activeEntry === take.id;
          const liveDeleteDisabled =
            performance.isPerforming && (performance.selections[mic.id] ?? "off") === take.id;
          const deleteDisabledReason =
            recordingState !== "idle"
              ? "recording"
              : liveDeleteDisabled
                ? "live take"
                : isExporting
                  ? "exporting"
                  : null;
          const confirmingDelete = confirmDeleteId === take.id && deleteDisabledReason === null;
          return (
            <TakeEntry
              key={take.id}
              checking={partCheckingTakeIds.includes(take.id)}
              confirmingDelete={confirmingDelete}
              deleteDisabledReason={deleteDisabledReason}
              disabled={isExporting}
              micId={mic.id}
              open={openPartTakeId === take.id}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onClose={() => setOpenPartTakeId(null)}
              onConfirmDelete={() => deleteTake(take.id)}
              onOpen={() => setOpenPartTakeId(take.id)}
              onRequestDelete={() => setConfirmDeleteId(take.id)}
              onSelect={() => choose(take.id)}
              selected={selected}
              take={take}
              takeNumber={index + 1}
            />
          );
        })}

        <button
          type="button"
          onClick={() => choose("off")}
          className={`${rowBase} ${activeEntry === "off" ? selectedRow : idleRow}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 text-zinc-500">
            <Power size={16} aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="font-medium text-zinc-100">Off</span>
            <span className="ml-auto text-xs text-zinc-500">Mute this mic</span>
          </span>
        </button>

        <button
          type="button"
          disabled={!canRecordTake}
          title={!canRecordTake ? recordDisabledTitle : undefined}
          onClick={recordNextTake}
          className={`flex min-h-11 w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm transition-colors pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
            canRecordTake
              ? idleRow
              : "cursor-not-allowed border-zinc-800 bg-zinc-950/70 text-zinc-600 opacity-70"
          }`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-zinc-800">
            <Plus size={16} aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{recordLabel}</span>
            <span className="text-xs">{recordSubtitle}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
