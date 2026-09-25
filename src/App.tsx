// ABOUTME: Root React component for Hyperactive Amateur — header (title + controls), viewport, pads, grid.
// ABOUTME: Owns global app effects: Tone.Transport bootstrap, rehydration, auto-save, keyboard hooks.
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { StepGrid } from "./components/StepGrid";
import { PlayButton } from "./components/PlayButton";
import { ExportButton } from "./components/ExportButton";
import { SuggestButton } from "./components/SuggestButton";
import { CompatibilityBanner } from "./components/CompatibilityBanner";
import { FeelDisclosure } from "./components/FeelDisclosure";
import { Viewport } from "./components/Viewport";
import { PadGrid } from "./components/PadGrid";
import { selectClipCount, useAppStore } from "./store/useAppStore";
import { AI_UNLOCK_CLIPS } from "./lib/aiSuggest";
import { initTransport } from "./lib/audio";
import { initAudioLifecycle } from "./lib/audioLifecycle";
import { initAudioRepair } from "./lib/audioRepair";
import { useSpacebarPlayToggle } from "./lib/useSpacebarPlayToggle";
import { useKeyboardTriggers } from "./lib/useKeyboardTriggers";
import { rehydrateFromStorage } from "./lib/rehydrate";
import { shutdownAutoSave, startAutoSave } from "./lib/autoSave";
import { installVisibilityListener } from "./lib/streamLifecycle";
import { captureInstallPrompt, getStorageDurability } from "./lib/install";
import { getLogs, LOG_EVENTS, logger, type LogEntry } from "./lib/logger";

const LOAD_FAILED_COPY = "Couldn't open your saved project — recordings won't be saved.";
const LOG_PANEL_FLAG = "halogs";

function logPanelRequested(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URLSearchParams(location.search).has(LOG_PANEL_FLAG);
  } catch {
    return false;
  }
}

export function App() {
  const [hydrating, setHydrating] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const clipCount = useAppStore(selectClipCount);
  const isPlaying = useAppStore((s) => s.playback.isPlaying);
  const hasAnyClips = clipCount > 0;
  // Play (and Space) stay until playback stops: Re-record is live while
  // playing and clearTrackClip only freezes for export, so the last clip
  // can go with the transport running.
  const showControls = hasAnyClips || isPlaying;
  const hasAiUnlock = clipCount >= AI_UNLOCK_CLIPS;

  useEffect(() => {
    initTransport();
    const detachInstallPrompt = captureInstallPrompt();
    const detachAudioLifecycle = initAudioLifecycle();
    const detachAudioRepair = initAudioRepair();
    const detachVisibility = installVisibilityListener();
    let cancelled = false;
    void getStorageDurability().then((storageDurability) => {
      if (!cancelled) {
        useAppStore.getState().actions.setStorageDurability(storageDurability);
      }
    });
    // Autosave starts after every load that resolves — repaired, migrated,
    // quarantined, or clean. Persistence protects the original bytes with
    // its own backup and quarantine records, so nothing waits on the user.
    // Only a load that still fails after its bounded retries keeps autosave
    // off: a transient read failure followed by a successful write would
    // otherwise replace a good project with an empty one.
    rehydrateFromStorage()
      .then(() => {
        if (!cancelled) startAutoSave();
      })
      .catch((err: unknown) => {
        logger.error(LOG_EVENTS.RECOVERY_LOAD_FAILED, {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
      detachInstallPrompt();
      detachAudioLifecycle();
      detachAudioRepair();
      detachVisibility();
      shutdownAutoSave();
    };
  }, []);
  useSpacebarPlayToggle();
  useKeyboardTriggers();

  return (
    <div className="min-h-screen min-h-[100dvh] box-border bg-zinc-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-white">
      <CompatibilityBanner />
      <header className="sticky top-0 z-30 bg-zinc-950 border-b border-zinc-800">
        {/* One wrapping row. Below lg the wrapper is display: contents, so
            Play and the full-width controls row are the row's own items:
            title + Play on one line, the controls on the next. At lg the
            wrapper is a right-aligned column: Play above the controls,
            beside the title. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0 px-3 py-3 sm:px-6 sm:py-4 lg:gap-x-3">
          <div className="mr-auto">
            {/* 5xl only from lg: a phone in landscape is wider than sm and
                must keep the phone-sized header. */}
            <h1 className="text-2xl min-[360px]:text-3xl lg:text-5xl font-black tracking-tight leading-[1.05] text-zinc-200">
              Hyperactive
              <br />
              Amateur
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              <a
                href="https://fgelbal.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-300 transition-colors"
              >
                Fırat Gelbal
              </a>
              <span aria-hidden> · </span>
              <a
                href="https://github.com/gelbal/hyperactive-amateur"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View source on GitHub"
                className="hover:text-zinc-300 transition-colors"
              >
                source
              </a>
            </p>
          </div>
          {/* Before the first clip the header is the title alone: nothing
              here is usable until there is something to play. While a saved
              project hydrates the controls row is reserved empty at the
              buttons' height, so the page does not jump when the clips
              arrive; Play needs no reservation, the title block is taller
              than it at every width. */}
          {(showControls || hydrating) && (
            <div className="contents lg:flex lg:flex-col lg:items-end lg:gap-3 lg:ml-auto">
              {showControls && (
                <div className="shrink-0">
                  <PlayButton />
                </div>
              )}
              {/* The controls carry the 12 px between the lines themselves
                  (gap-y-0 on the row); at lg the column's gap does it. */}
              <div className="w-full lg:w-auto mt-3 lg:mt-0 min-h-[2.375rem] pointer-coarse:min-h-11 flex flex-wrap items-center gap-1.5 sm:gap-2 lg:flex-nowrap lg:gap-3">
                {showControls && (
                  <>
                    <ExportButton />
                    <FeelDisclosure />
                    {hasAiUnlock && <SuggestButton />}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </header>
      <main className="flex flex-col items-center gap-6 py-6 px-4 sm:px-0">
        {hydrating ? (
          <div className="text-zinc-500 text-sm">Loading project…</div>
        ) : (
          <>
            {loadFailed && <LoadFailedNotice />}
            <Viewport />
            {hasAnyClips ? (
              <PadGrid />
            ) : (
              <p className="text-xs text-zinc-500 max-w-[28rem] text-center px-6">
                Record your first sound to unlock the pads, the step grid, and
                the AI tools.
              </p>
            )}
          </>
        )}
      </main>
      {hasAnyClips && <StepGrid />}
      {logPanelRequested() && <LogPanel />}
    </div>
  );
}

// Opt-in diagnostics for a phone without an inspector (Firefox and Brave on
// iOS): open the app with ?halogs=1 and the log ring buffer renders here, so
// a screenshot carries media.acquire-failed / audio.decode-failed and the
// audio-session state read at failure time.
function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>(() => getLogs());
  useEffect(() => {
    const timer = window.setInterval(() => setEntries(getLogs()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section
      aria-label="Diagnostic log"
      className="mx-3 my-6 max-w-3xl rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-300 sm:mx-auto"
    >
      <pre className="whitespace-pre-wrap break-words font-mono">
        {entries.length === 0
          ? "(no log entries yet)"
          : entries
              .map(
                (entry) =>
                  `${new Date(entry.ts).toISOString().slice(11, 23)} ${entry.level} ${entry.event}` +
                  (entry.payload === undefined ? "" : ` ${JSON.stringify(entry.payload)}`),
              )
              .join("\n")}
      </pre>
    </section>
  );
}

// The one message the app keeps: without it the user would record a whole
// session into nothing. It names the consequence and the next action.
function LoadFailedNotice() {
  return (
    <section
      aria-label="Saved project could not be opened"
      className="w-full max-w-3xl border border-amber-500/40 bg-amber-950/30 px-3 py-3 text-amber-100 sm:px-4"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">{LOAD_FAILED_COPY}</p>
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
