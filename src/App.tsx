// ABOUTME: Root React component for Hyperactive Amateur — header (title + controls), viewport, pads, grid.
// ABOUTME: Owns global app effects: Tone.Transport bootstrap, rehydration, auto-save, keyboard hooks.
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { StepGrid } from "./components/StepGrid";
import { PlayButton } from "./components/PlayButton";
import { BpmDial } from "./components/BpmDial";
import { ExportButton } from "./components/ExportButton";
import { SuggestButton } from "./components/SuggestButton";
import { FlowSelector } from "./components/FlowSelector";
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
import { LOG_EVENTS, logger } from "./lib/logger";

const LOAD_FAILED_COPY = "Couldn't open your saved project — recordings won't be saved.";

export function App() {
  const [hydrating, setHydrating] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const clipCount = useAppStore(selectClipCount);
  const hasAnyClips = clipCount > 0;
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
        <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-end sm:justify-between sm:gap-10 sm:px-6 sm:py-4">
          <div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.05] text-zinc-200">
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
          <div className="flex flex-col items-start sm:items-end gap-3 w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-4">
              <PlayButton />
              <span className="text-[10px] text-zinc-500 -ml-2">space</span>
              <BpmDial />
              {hasAnyClips && (
                <>
                  <span className="h-6 w-px bg-zinc-800" aria-hidden />
                  <ExportButton />
                </>
              )}
            </div>
            {hasAnyClips && (
              <div className="flex flex-wrap items-center gap-2">
                <FeelDisclosure />
                {hasAiUnlock && (
                  <>
                    <span className="h-6 w-px bg-zinc-800" aria-hidden />
                    <SuggestButton />
                    <FlowSelector />
                  </>
                )}
              </div>
            )}
          </div>
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
    </div>
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
