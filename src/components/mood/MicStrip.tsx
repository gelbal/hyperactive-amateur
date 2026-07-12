// ABOUTME: MicStrip — compact Mood mic chips under the stage.
// ABOUTME: Shows live/armed/off/hot state and opens each mic's take stack sheet.
import { useEffect, useState } from "react";
import { Mic2, Square } from "lucide-react";
import { getAudioContext } from "../../lib/audio";
import { countInBeatSeconds, stopMoodTakeEarly } from "../../lib/moodRecordingFlow";
import { cancelActiveRecordingByUser } from "../../lib/useRecordingEscapeCancel";
import { useAppStore } from "../../store/useAppStore";
import type { MoodMic, MoodPiece, MoodSelectionEntry, MoodTake } from "../../types";
import { StackSheet } from "./StackSheet";

const COUNTDOWN_TICK_MS = 100;

interface MicStripProps {
  piece: MoodPiece;
}

type MicChipState = "armed" | "live" | "off" | "hot";

function takeForEntry(mic: MoodMic, entry: MoodSelectionEntry): MoodTake | null {
  if (entry === "off") return null;
  return mic.takes.find((take) => take.id === entry) ?? null;
}

function stateLabel(state: MicChipState): string {
  if (state === "hot") return "recording";
  return state;
}

function visualLabel(state: MicChipState): string {
  if (state === "hot") return "REC";
  return state.toUpperCase();
}

function hotCountdownDigit(countdownEndsAt: number | null, beatSeconds: number): number {
  if (countdownEndsAt === null) return 3;
  const beatsRemaining = Math.ceil((countdownEndsAt - getAudioContext().currentTime) / beatSeconds);
  return Math.max(1, Math.min(3, beatsRemaining));
}

function ringClass(state: MicChipState): string {
  if (state === "hot") return "border-red-500 ring-2 ring-red-500/50 text-red-300";
  if (state === "armed") {
    return "animate-pulse border-orange-400 ring-2 ring-orange-500/40 text-orange-300";
  }
  if (state === "live") return "border-orange-500 text-orange-400";
  return "border-zinc-700 text-zinc-500 opacity-60";
}

function chipClass(state: MicChipState, open: boolean): string {
  const base =
    "group flex min-h-11 w-[5.75rem] shrink-0 items-center gap-2 rounded border bg-zinc-950 p-1.5 text-left transition-colors pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500";
  if (open) return `${base} border-orange-500 text-orange-100`;
  if (state === "live") return `${base} border-orange-500/60 text-zinc-100 hover:bg-zinc-900`;
  if (state === "armed") return `${base} border-orange-400/50 text-zinc-100 hover:bg-zinc-900`;
  if (state === "hot") return `${base} border-red-500/70 text-red-100 hover:bg-zinc-900`;
  return `${base} border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900`;
}

function MicThumb({
  micId,
  take,
}: {
  micId: string;
  take: MoodTake | null;
}) {
  if (take?.posterUrl) {
    return (
      <img
        data-testid={`mic-${micId}-poster`}
        src={take.posterUrl}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded object-cover bg-zinc-900"
      />
    );
  }

  return (
    <span
      data-testid={`mic-${micId}-empty`}
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-zinc-700 bg-zinc-950 text-zinc-600"
    >
      <Mic2 size={16} />
    </span>
  );
}

export function MicStrip({ piece }: MicStripProps) {
  const performance = useAppStore((s) => s.mood.performance);
  const recordingState = useAppStore((s) => s.recording.state);
  const countdownEndsAt = useAppStore((s) => s.recording.countdownEndsAt);
  const [openMicId, setOpenMicId] = useState<string | null>(null);
  const beatSeconds = countInBeatSeconds(piece);
  const [hotCount, setHotCount] = useState(() => hotCountdownDigit(countdownEndsAt, beatSeconds));

  useEffect(() => {
    if (recordingState !== "countdown") {
      setHotCount(3);
      return;
    }
    const update = () => setHotCount(hotCountdownDigit(countdownEndsAt, beatSeconds));
    update();
    const id = window.setInterval(update, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [beatSeconds, countdownEndsAt, recordingState]);

  return (
    <div
      role="group"
      aria-label="Mood mics"
      className="flex w-full items-start gap-2 overflow-x-auto px-1 pb-1"
    >
      {piece.mics.map((mic, index) => {
        const micNumber = index + 1;
        const liveEntry = performance.selections[mic.id] ?? "off";
        const armedEntry = performance.armed[mic.id] ?? null;
        const liveTake = takeForEntry(mic, liveEntry);
        const isHot = performance.hotMicId === mic.id;
        const state: MicChipState = isHot
          ? "hot"
          : armedEntry !== null
            ? "armed"
            : liveEntry !== "off"
              ? "live"
              : "off";
        const open = openMicId === mic.id;
        const hotActionLabel = recordingState === "recording" ? "Stop take" : "Cancel take";

        const onChipClick = () => {
          if (isHot) {
            if (recordingState === "recording") {
              stopMoodTakeEarly();
            } else {
              cancelActiveRecordingByUser();
            }
            return;
          }
          setOpenMicId((current) => (current === mic.id ? null : mic.id));
        };

        return (
          <div key={mic.id} className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-pressed={open}
              aria-label={
                isHot
                  ? `Mic ${micNumber}, ${stateLabel(state)}. ${hotActionLabel}`
                  : `Mic ${micNumber}, ${stateLabel(state)}. Open stack`
              }
              onClick={onChipClick}
              className={chipClass(state, open)}
            >
              <span
                data-testid={`mic-${mic.id}-ring`}
                className={`rounded border-2 p-0.5 ${ringClass(state)}`}
              >
                <MicThumb micId={mic.id} take={liveTake} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-xs tabular-nums text-zinc-300">
                  M{micNumber}
                </span>
                {isHot ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase text-red-300">
                    <span
                      data-testid={`mic-${mic.id}-rec-dot`}
                      className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"
                      aria-hidden="true"
                    />
                    <span data-testid={`mic-${mic.id}-countdown`} className="tabular-nums">
                      {recordingState === "countdown" ? hotCount : "REC"}
                    </span>
                    <Square size={9} fill="currentColor" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase text-zinc-500">
                    {visualLabel(state)}
                  </span>
                )}
              </span>
            </button>
            <StackSheet
              mic={mic}
              micNumber={micNumber}
              open={open}
              onClose={() => setOpenMicId(null)}
            />
          </div>
        );
      })}
    </div>
  );
}
