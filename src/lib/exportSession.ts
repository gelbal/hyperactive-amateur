// ABOUTME: Tracks the single active export render so lifecycle events can abort it.
// ABOUTME: Kept separate from export.ts to avoid circular imports with audio/stream lifecycle.

export interface ActiveExportSession {
  abort: (reason: string) => void;
}

let activeSession: ActiveExportSession | null = null;

export function registerExportSession(session: ActiveExportSession): (() => void) | null {
  if (activeSession) return null;
  activeSession = session;
  return () => {
    if (activeSession === session) activeSession = null;
  };
}

export function abortActiveExport(reason: string): boolean {
  if (!activeSession) return false;
  activeSession.abort(reason);
  return true;
}

export function getActiveExportSession(): ActiveExportSession | null {
  return activeSession;
}

export function __resetExportSessionForTesting(): void {
  activeSession = null;
}
