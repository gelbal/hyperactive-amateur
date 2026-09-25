// ABOUTME: LoadFailedNotice — the one line shown when a saved record still cannot be opened after its retries.
// ABOUTME: Says what will not be saved and offers a reload; every other recovery stays silent.
import { AlertTriangle } from "lucide-react";

interface LoadFailedNoticeProps {
  label: string;
  message: string;
}

// The one message the app keeps: without it the user would record a whole
// session into nothing. It names the consequence and the next action.
export function LoadFailedNotice({ label, message }: LoadFailedNoticeProps) {
  return (
    <section
      aria-label={label}
      className="w-full max-w-3xl border border-amber-500/40 bg-amber-950/30 px-3 py-3 text-amber-100 sm:px-4"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">{message}</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="h-8 shrink-0 whitespace-nowrap rounded border border-amber-400/30 px-3 text-sm text-amber-100 hover:bg-amber-900/50"
        >
          Reload
        </button>
      </div>
    </section>
  );
}
