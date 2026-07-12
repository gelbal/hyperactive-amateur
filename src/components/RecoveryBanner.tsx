// ABOUTME: RecoveryBanner — visible notice when persisted project data needed repair.
// ABOUTME: Dismissal only clears UI warnings; the recovery backup remains in IndexedDB.
import { AlertTriangle, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import type { RecoveryWarningScope } from "../types";

const RECOVERY_SCOPES: RecoveryWarningScope[] = ["chop", "mood"];

function labelForScope(scope: RecoveryWarningScope): string {
  return scope === "mood" ? "Recovered saved mood" : "Recovered saved project";
}

export function RecoveryBanner() {
  const warnings = useAppStore((s) => s.ui.recoveryWarnings);
  const warningScopes = useAppStore((s) => s.ui.recoveryWarningScopes);
  if (warnings.length === 0) return null;

  const notices = RECOVERY_SCOPES.map((scope) => ({
    scope,
    warnings: warnings.filter((_, index) => (warningScopes[index] ?? "chop") === scope),
  })).filter((notice) => notice.warnings.length > 0);

  return (
    <section
      aria-label="Project recovery notice"
      className="w-full max-w-3xl space-y-2 text-amber-100"
    >
      {notices.map((notice) => {
        const visibleWarnings = notice.warnings.slice(0, 3);
        const hiddenCount = notice.warnings.length - visibleWarnings.length;
        const audioRepairCount = notice.warnings.filter(
          (warning) => warning.startsWith("Track ") && warning.includes("audio unavailable"),
        ).length;
        const audioRepairSummary =
          audioRepairCount === 1
            ? "1 track has audio unavailable and needs re-recording."
            : `${audioRepairCount} tracks have audio unavailable and need re-recording.`;

        return (
          <div
            key={notice.scope}
            className="flex items-start gap-3 border border-amber-500/40 bg-amber-950/30 px-3 py-3 sm:px-4"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-amber-100">
                {labelForScope(notice.scope)}
              </h2>
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
              aria-label={`Dismiss ${notice.scope} recovery notice`}
              onClick={() => useAppStore.getState().actions.clearRecoveryWarnings(notice.scope)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-400/30 text-amber-100 hover:bg-amber-900/50"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
