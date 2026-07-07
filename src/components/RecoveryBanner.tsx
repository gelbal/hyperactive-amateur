// ABOUTME: RecoveryBanner — visible notice when persisted project data needed repair.
// ABOUTME: Dismissal only clears UI warnings; the recovery backup remains in IndexedDB.
import { AlertTriangle, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export function RecoveryBanner() {
  const warnings = useAppStore((s) => s.ui.recoveryWarnings);
  if (warnings.length === 0) return null;

  const visibleWarnings = warnings.slice(0, 3);
  const hiddenCount = warnings.length - visibleWarnings.length;
  const audioRepairCount = warnings.filter(
    (warning) => warning.startsWith("Track ") && warning.includes("audio unavailable"),
  ).length;
  const audioRepairSummary =
    audioRepairCount === 1
      ? "1 track has audio unavailable and needs re-recording."
      : `${audioRepairCount} tracks have audio unavailable and need re-recording.`;

  return (
    <section
      aria-label="Project recovery notice"
      className="w-full max-w-3xl border border-amber-500/40 bg-amber-950/30 px-3 py-3 text-amber-100 sm:px-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-amber-100">Recovered saved project</h2>
          <ul className="mt-1 space-y-1 text-xs text-amber-100/80">
            {audioRepairCount > 0 && <li>{audioRepairSummary}</li>}
            {visibleWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
            {hiddenCount > 0 && <li>{hiddenCount} more recovery fixes were applied.</li>}
          </ul>
        </div>
        <button
          type="button"
          aria-label="Dismiss recovery notice"
          onClick={() => useAppStore.getState().actions.clearRecoveryWarnings()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-400/30 text-amber-100 hover:bg-amber-900/50"
        >
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
