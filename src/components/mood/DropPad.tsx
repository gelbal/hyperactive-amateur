// ABOUTME: DropPad — pad-styled Mood control for the Drop performance gesture.
// ABOUTME: Shows queued beat state while routing taps through the performance gate.
import type { MoodVibeId } from "../../types";
import { canStartMoodPerformanceTap } from "../../lib/audibleActionGate";
import { armDrop } from "../../lib/moodPerformance";
import { useAppStore } from "../../store/useAppStore";

const VIBE_LABELS: Record<MoodVibeId, string> = {
  clean: "Clean",
  print: "Print",
  mixtape: "Mixtape",
  blocks: "Blocks",
  camcorder: "Camcorder",
  kaleido: "Kaleido",
  weave: "Weave",
  crossroll: "Crossroll",
  ghost: "Ghost",
  solar: "Solar",
};

function disabledTitle(
  label: string,
  vibe: MoodVibeId,
  isPerforming: boolean,
  canTap: boolean,
): string {
  if (vibe === "clean") return "Clean has no Drop";
  if (!isPerforming) return "Start performance to use the Drop";
  if (!canTap) return "The Drop is locked during capture";
  return `${label} Drop`;
}

function dropSubtitle(
  vibe: MoodVibeId,
  isPerforming: boolean,
  recordingIdle: boolean,
  armed: boolean,
): string {
  if (!isPerforming && recordingIdle) return "press Play";
  if (vibe === "clean") return isPerforming ? "pick a vibe to punch" : "pick a vibe";
  if (!isPerforming) return "play first";
  if (armed) return "on the beat";
  return `${vibe} · D`;
}

export function DropPad({ vibe }: { vibe: MoodVibeId }) {
  const canTap = useAppStore(canStartMoodPerformanceTap);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const recordingIdle = useAppStore((s) => s.recording.state === "idle");
  const dropActive = useAppStore((s) => s.mood.performance.dropActive);
  const armedDropActive = useAppStore((s) => s.mood.performance.armedDropActive);
  const label = VIBE_LABELS[vibe];
  const disabled = vibe === "clean" || !isPerforming || !canTap;
  const armed = armedDropActive !== null;
  const active = dropActive && isPerforming;
  const pressed = dropActive || armed;
  const title = armed
    ? `${label} Drop armed for next beat`
    : disabledTitle(label, vibe, isPerforming, canTap);
  const subtitle = dropSubtitle(vibe, isPerforming, recordingIdle, armed);

  return (
    <button
      type="button"
      aria-label={`Drop ${label}`}
      aria-pressed={pressed}
      data-armed={armed ? "true" : undefined}
      data-active={dropActive ? "true" : undefined}
      disabled={disabled}
      title={title}
      onClick={armDrop}
      className={
        "relative flex h-14 min-w-28 flex-col items-center justify-center overflow-hidden rounded border-2 px-4 transition-colors pointer-coarse:min-h-12 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50 " +
        (active
          ? "border-orange-500 bg-orange-500 text-zinc-950"
          : disabled
            ? "border-zinc-700 bg-zinc-900 text-zinc-600"
            : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500") +
        (armed ? " animate-pulse ring-2 ring-orange-500/50" : "")
      }
    >
      <span className="text-base font-black leading-none tracking-tight">DROP</span>
      <span className="mt-1 whitespace-nowrap font-mono text-[10px] font-normal leading-none tracking-normal">
        {subtitle}
      </span>
    </button>
  );
}
