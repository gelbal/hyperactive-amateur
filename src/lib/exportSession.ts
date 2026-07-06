// ABOUTME: Tracks the single active export render so lifecycle events can abort it.
// ABOUTME: Kept separate from export.ts to avoid circular imports with audio/stream lifecycle.

export interface ActiveExportSession {
  abort: (reason: string) => void;
}

let activeSession: ActiveExportSession | null = null;
// One abort per session: visibilitychange → hidden and pagehide can both
// arrive before the export's cleanup unregisters, and the abort callback
// must not fire twice for the same session.
let activeSessionAborted = false;

export function registerExportSession(session: ActiveExportSession): (() => void) | null {
  if (activeSession) return null;
  activeSession = session;
  activeSessionAborted = false;
  return () => {
    if (activeSession === session) {
      activeSession = null;
      activeSessionAborted = false;
    }
  };
}

export function abortActiveExport(reason: string): boolean {
  if (!activeSession || activeSessionAborted) return false;
  activeSessionAborted = true;
  activeSession.abort(reason);
  return true;
}

export function getActiveExportSession(): ActiveExportSession | null {
  return activeSession;
}

export function __resetExportSessionForTesting(): void {
  activeSession = null;
  activeSessionAborted = false;
}
