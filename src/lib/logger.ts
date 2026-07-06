// ABOUTME: logger — tiny in-memory ring buffer with console mirroring for AI surfaces.
// ABOUTME: Inspect via window.__haLogs() / .dump() / .clear() in the browser console.

export const LOG_BUFFER_MAX = 200;

export type LogLevel = "info" | "warn" | "error";

// Centralized event names. Producers and assertions both reference these so a
// typo at either end becomes a type error instead of a silently-passing test.
export const LOG_EVENTS = {
  AUTOTAG_START: "autotag.start",
  AUTOTAG_RESULT: "autotag.result",
  AUTOTAG_MISS: "autotag.miss",
  AUTOTAG_ERROR: "autotag.error",
  AUTOTAG_BELOW_THRESHOLD: "autotag.below-threshold",
  BATCHTAG_START: "batchtag.start",
  BATCHTAG_RESULT: "batchtag.result",
  BATCHTAG_MISS: "batchtag.miss",
  BATCHTAG_ERROR: "batchtag.error",
  RETAG_START: "retag.start",
  RETAG_COMPLETE: "retag.complete",
  RETAG_FALLBACK: "retag.fallback",
  RETAG_BELOW_THRESHOLD: "retag.below-threshold",
  RETAG_MISS: "retag.miss",
  RETAG_CANCELLED: "retag.cancelled",
  SUGGEST_ERROR: "suggest.error",
  SUGGEST_MISS: "suggest.miss",
  SUGGEST_RETRY: "suggest.retry",
  AUTOSAVE_ERROR: "autosave.error",
  AUDIO_SESSION_ERROR: "audio.session-error",
  AUDIO_INTERRUPTED: "audio.interrupted",
  AUDIO_RESUME_REQUIRED: "audio.resume-required",
  AUDIO_ACTION_ERROR: "audio.action-error",
  RECORDING_INTERRUPTED: "recording.interrupted",
  VIDEO_DRAW_ERROR: "video.draw-error",
  AUTOSAVE_FLUSH: "autosave.flush",
} as const;
export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];

export interface LogEntry {
  ts: number;
  level: LogLevel;
  event: string;
  payload?: unknown;
}

const buffer: LogEntry[] = [];

const consoleFor: Record<LogLevel, (...args: unknown[]) => void> = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  // eslint-disable-next-line no-console
  error: (...args) => console.error(...args),
};

function record(level: LogLevel, event: LogEvent, payload?: unknown): void {
  const entry: LogEntry = { ts: Date.now(), level, event, payload };
  buffer.push(entry);
  if (buffer.length > LOG_BUFFER_MAX) {
    buffer.splice(0, buffer.length - LOG_BUFFER_MAX);
  }
  const tag = `[HA] ${event}`;
  if (payload === undefined) consoleFor[level](tag);
  else consoleFor[level](tag, payload);
}

export const logger = {
  info(event: LogEvent, payload?: unknown): void {
    record("info", event, payload);
  },
  warn(event: LogEvent, payload?: unknown): void {
    record("warn", event, payload);
  },
  error(event: LogEvent, payload?: unknown): void {
    record("error", event, payload);
  },
};

export function getLogs(): LogEntry[] {
  return buffer.slice();
}

export function clearLogs(): void {
  buffer.length = 0;
}

function dumpLogs(): void {
  const rows = buffer.map((e) => ({
    time: new Date(e.ts).toISOString().slice(11, 23),
    level: e.level,
    event: e.event,
    payload: e.payload,
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
}

// Browser-side helper exposed on window. Idempotent — safe to call from main.tsx.
export function installWindowHook(): void {
  if (typeof window === "undefined") return;
  type Hook = (() => LogEntry[]) & { clear: () => void; dump: () => void };
  const hook: Hook = (() => getLogs()) as Hook;
  hook.clear = () => clearLogs();
  hook.dump = () => dumpLogs();
  (window as unknown as { __haLogs?: Hook }).__haLogs = hook;
}
