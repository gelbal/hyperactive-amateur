// ABOUTME: DropPad — pad-styled Mood control for the Drop performance gesture.
// ABOUTME: Shows queued beat state while routing taps through the performance gate.
import type { MoodVibeId } from "../../types";
import { canStartMoodPerformanceTap } from "../../lib/audibleActionGate";
import { armDrop } from "../../lib/moodPerformance";
import { useAppStore } from "../../store/useAppStore";

const VIBE_LABELS: Record<MoodVibeId, string> = {
  clean: "Clean",
  blocks: "Blocks",
  mixtape: "Mixtape",
  camcorder: "Camcorder",
  print: "Print",
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

export function DropPad({ vibe }: { vibe: MoodVibeId }) {
  const canTap = useAppStore(canStartMoodPerformanceTap);
  const isPerforming = useAppStore((s) => s.mood.performance.isPerforming);
  const dropActive = useAppStore((s) => s.mood.performance.dropActive);
  const armedDropActive = useAppStore((s) => s.mood.performance.armedDropActive);
  const label = VIBE_LABELS[vibe];
  const disabled = vibe === "clean" || !isPerforming || !canTap;
  const armed = armedDropActive !== null;
  const pressed = dropActive || armed;
  const title = armed
    ? `${label} Drop armed for next beat`
    : disabledTitle(label, vibe, isPerforming, canTap);

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
        "relative flex h-16 min-w-36 items-center justify-center overflow-hidden rounded-lg border px-5 text-base font-black uppercase tracking-normal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50 " +
        (disabled
          ? "border-zinc-800 bg-zinc-950 text-zinc-600"
          : armed
            ? "animate-pulse border-orange-300 bg-orange-500 text-zinc-950 shadow-[0_0_24px_rgba(249,115,22,0.35)]"
            : dropActive
              ? "border-orange-400 bg-zinc-100 text-zinc-950"
              : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500")
      }
    >
      <span>{label}</span>
    </button>
  );
}
