// ABOUTME: Mood header options popover for headphones, credit styling, and scratch controls.
// ABOUTME: Keeps the compact kebab menu and its disabled-state explanations together.
import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  clampCreditStyleIndex,
  CREDIT_NAME_MAX_LENGTH,
  CREDIT_STYLES,
} from "../../lib/moodCredits";
import { usePopoverDismiss } from "../../lib/usePopoverDismiss";
import { useAppStore } from "../../store/useAppStore";
import type { MoodCreditMode, MoodCreditPalette, MoodPiece } from "../../types";
import { MOOD_CREDIT_MODE_IDS, MOOD_CREDIT_PALETTE_IDS } from "../../types";

function moodPieceHasAnyTakes(piece: MoodPiece): boolean {
  return piece.mics.some((mic) => mic.takes.length > 0);
}

function ScratchMoodControl({
  disabled,
  disabledTitle,
}: {
  disabled: boolean;
  disabledTitle: string | undefined;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        onClick={() => setArmed(true)}
        className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors pointer-coarse:min-h-11 hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:bg-transparent"
      >
        Scratch this mood
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-center text-xs text-zinc-400">Start over and clear this mood?</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          onClick={() => {
            useAppStore.getState().actions.scratchMoodPiece();
            setArmed(false);
          }}
          className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors pointer-coarse:min-h-11 hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-600"
        >
          Yes, scratch it
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 transition-colors pointer-coarse:min-h-11 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CreditCycleRow({
  label,
  value,
  ariaLabel,
  disabled,
  disabledTitle,
  onNext,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  disabled: boolean;
  disabledTitle: string | undefined;
  onNext: () => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 px-2">
      <span className="flex items-baseline gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          {label}
        </span>
        <span className="font-mono text-xs text-orange-300">{value}</span>
      </span>
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
        onClick={onNext}
        className="min-h-8 rounded border border-zinc-700 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-orange-500 hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11"
      >
        next
      </button>
    </div>
  );
}

function MoodCreditsControl({ piece }: { piece: MoodPiece }) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const setMoodCredits = useAppStore((s) => s.actions.setMoodCredits);
  const applyMoodArtDirection = useAppStore(
    (s) => s.actions.applyMoodArtDirectionIfCurrent,
  );
  const credits = piece.credits;
  const enabled = credits?.enabled ?? false;
  const styleIndex = clampCreditStyleIndex(credits?.styleIndex);
  const creditMode = credits?.mode ?? "sequence";
  const modeIndex = MOOD_CREDIT_MODE_IDS.indexOf(creditMode);
  const nextMode = MOOD_CREDIT_MODE_IDS[
    (modeIndex + 1) % MOOD_CREDIT_MODE_IDS.length
  ] as MoodCreditMode;
  const creditPalette = piece.artDirection?.creditPalette ?? "signal";
  const paletteIndex = MOOD_CREDIT_PALETTE_IDS.indexOf(creditPalette);
  const nextPalette = MOOD_CREDIT_PALETTE_IDS[
    (paletteIndex + 1) % MOOD_CREDIT_PALETTE_IDS.length
  ] as MoodCreditPalette;
  const exportTitle = isExporting ? "frozen during export" : undefined;
  const paletteDisabled = isExporting || piece.oneTakeId === null;
  const paletteDisabledTitle = isExporting
    ? "frozen during export"
    : piece.oneTakeId === null
      ? "record the One first"
      : undefined;

  return (
    <section aria-labelledby="mood-credits-label" className="border-t border-zinc-800 pt-3">
      <div className="flex items-center gap-2">
        <h3 id="mood-credits-label" className="text-xs font-semibold text-zinc-200">
          Credits
        </h3>
        <span className="rounded-sm bg-orange-500 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-950">
          LAB
        </span>
      </div>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          aria-label="Credits (lab)"
          checked={enabled}
          disabled={isExporting}
          title={exportTitle}
          onChange={(event) => setMoodCredits({ enabled: event.currentTarget.checked })}
          className="h-4 w-4 shrink-0 accent-orange-500 disabled:cursor-not-allowed"
        />
        <span>show names during performance</span>
      </label>

      {enabled ? (
        <div className="mt-2 flex flex-col gap-2">
          {piece.mics.map((mic, index) => (
            <input
              key={mic.id}
              type="text"
              aria-label={`credit name for mic ${index + 1}`}
              placeholder={`name mic ${index + 1}`}
              maxLength={CREDIT_NAME_MAX_LENGTH}
              value={credits?.names[mic.id] ?? ""}
              disabled={isExporting}
              title={exportTitle}
              onChange={(event) =>
                setMoodCredits({ names: { [mic.id]: event.currentTarget.value } })
              }
              className="min-h-9 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:text-base"
            />
          ))}
          <CreditCycleRow
            label="style"
            value={CREDIT_STYLES[styleIndex].name}
            ariaLabel="cycle credit style"
            disabled={isExporting}
            disabledTitle={exportTitle}
            onNext={() =>
              setMoodCredits({ styleIndex: (styleIndex + 1) % CREDIT_STYLES.length })
            }
          />
          <CreditCycleRow
            label="palette"
            value={creditPalette}
            ariaLabel="cycle credit palette"
            disabled={paletteDisabled}
            disabledTitle={paletteDisabledTitle}
            onNext={() => {
              if (!piece.oneTakeId) return;
              applyMoodArtDirection(
                piece.oneTakeId,
                {
                  fxPreset: piece.artDirection?.fxPreset ?? "neutral",
                  creditPalette: nextPalette,
                  source: "user",
                },
                useAppStore.getState().session.moodSessionId,
              );
            }}
          />
          <CreditCycleRow
            label="mode"
            value={creditMode}
            ariaLabel="cycle credit mode"
            disabled={isExporting}
            disabledTitle={exportTitle}
            onNext={() => setMoodCredits({ mode: nextMode })}
          />
        </div>
      ) : null}
    </section>
  );
}

function MoodHeadphonesControl() {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const monitorWithHeadphones = useAppStore((s) => s.mood.monitorWithHeadphones);
  const setMonitorWithHeadphones = useAppStore((s) => s.actions.setMonitorWithHeadphones);

  return (
    <label className="flex min-h-11 w-full shrink-0 items-center gap-2 text-left">
      <input
        type="checkbox"
        aria-label="I've got headphones on"
        checked={monitorWithHeadphones}
        disabled={isExporting}
        title={isExporting ? "frozen during export" : undefined}
        onChange={(event) => setMonitorWithHeadphones(event.currentTarget.checked)}
        className="h-4 w-4 shrink-0 accent-orange-500 disabled:cursor-not-allowed"
      />
      <span className="flex flex-col leading-tight">
        <span className="text-xs font-semibold text-zinc-300">headphones</span>
        <span className="text-[10px] text-zinc-500">
          no headphones: loops mute while recording
        </span>
      </span>
    </label>
  );
}

export function MoodOptionsControl({ piece }: { piece: MoodPiece }) {
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(rootRef, open, close);
  const scratchDisabled = isExporting || isPerforming;
  const scratchDisabledTitle = isExporting
    ? "frozen during export"
    : isPerforming
      ? "stop the performance first"
      : undefined;

  return (
    // Static below lg so the absolute panel resolves against the sticky
    // header (as the Feel and Export panels do): it opens right under the
    // header on a phone in either orientation, capped to the visible height.
    <div ref={rootRef} className="static lg:relative shrink-0">
      <button
        type="button"
        aria-label="Mood options"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={
          "flex h-10 w-10 items-center justify-center rounded border text-zinc-400 transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 " +
          (open
            ? "border-zinc-600 bg-zinc-800 text-zinc-100"
            : "border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200")
        }
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Mood options"
          className="absolute inset-x-3 top-full z-30 mt-2 mx-auto flex max-h-[calc(100dvh_-_100%_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-auto max-w-[18rem] flex-col gap-3 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-3 shadow-xl lg:inset-x-auto lg:right-0 lg:mx-0 lg:w-72 lg:max-w-none lg:max-h-none lg:overflow-visible"
        >
          {moodPieceHasAnyTakes(piece) ? <MoodHeadphonesControl /> : null}
          <MoodCreditsControl piece={piece} />
          <ScratchMoodControl
            disabled={scratchDisabled}
            disabledTitle={scratchDisabledTitle}
          />
        </div>
      ) : null}
    </div>
  );
}
