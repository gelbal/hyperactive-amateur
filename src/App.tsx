// ABOUTME: Root React component for Hyperactive Amateur — header (title + controls), viewport, pads, grid.
// ABOUTME: Owns global app effects: Tone.Transport bootstrap, rehydration, auto-save, keyboard hooks.
import { useEffect, useState } from "react";
import { StepGrid } from "./components/StepGrid";
import { PlayButton } from "./components/PlayButton";
import { BpmDial } from "./components/BpmDial";
import { ExportButton } from "./components/ExportButton";
import { SuggestButton } from "./components/SuggestButton";
import { FlowSelector } from "./components/FlowSelector";
import { CompatibilityBanner } from "./components/CompatibilityBanner";
import { RecoveryBanner } from "./components/RecoveryBanner";
import { StorageDurabilityChip } from "./components/StorageDurabilityChip";
import { FeelDisclosure } from "./components/FeelDisclosure";
import { Viewport } from "./components/Viewport";
import { PadGrid } from "./components/PadGrid";
import { selectClipCount, useAppStore } from "./store/useAppStore";
import { AI_UNLOCK_CLIPS } from "./lib/aiSuggest";
import { initTransport } from "./lib/audio";
import { initAudioLifecycle } from "./lib/audioLifecycle";
import { useSpacebarPlayToggle } from "./lib/useSpacebarPlayToggle";
import { useKeyboardTriggers } from "./lib/useKeyboardTriggers";
import { rehydrateFromStorage } from "./lib/rehydrate";
import { startAutoSave, stopAutoSave } from "./lib/autoSave";
import { installVisibilityListener } from "./lib/streamLifecycle";
import { captureInstallPrompt, getStorageDurability } from "./lib/install";

export function App() {
  const [hydrating, setHydrating] = useState(true);
  const clipCount = useAppStore(selectClipCount);
  const hasAnyClips = clipCount > 0;
  const hasAiUnlock = clipCount >= AI_UNLOCK_CLIPS;

  useEffect(() => {
    initTransport();
    const detachInstallPrompt = captureInstallPrompt();
    const detachAudioLifecycle = initAudioLifecycle();
    const detachVisibility = installVisibilityListener();
    let cancelled = false;
    let allowAutoSave = true;
    let resumeAutoSaveUnsubscribe: (() => void) | null = null;
    void getStorageDurability().then((storageDurability) => {
      if (!cancelled) {
        useAppStore.getState().actions.setStorageDurability(storageDurability);
      }
    });
    rehydrateFromStorage()
      .then((result) => {
        allowAutoSave = !result.degraded;
        if (cancelled || !result.degraded || !result.ok) return;
        // A degraded-but-hydrated load keeps autosave paused so the repaired
        // state cannot overwrite the protected original. Dismissing the
        // recovery notice is the user's acknowledgment — the explicit
        // recovery action that re-enables saving.
        resumeAutoSaveUnsubscribe = useAppStore.subscribe((state, prev) => {
          if (
            prev.ui.recoveryWarnings.length > 0 &&
            state.ui.recoveryWarnings.length === 0
          ) {
            resumeAutoSaveUnsubscribe?.();
            resumeAutoSaveUnsubscribe = null;
            startAutoSave();
          }
        });
      })
      .catch(() => {
        allowAutoSave = false;
        useAppStore
          .getState()
          .actions.setRecoveryWarnings([
            "Saved project could not be loaded. Autosave was paused to avoid overwriting it.",
          ]);
      })
      .finally(() => {
        if (!cancelled) {
          setHydrating(false);
          if (allowAutoSave) startAutoSave();
        }
      });
    return () => {
      cancelled = true;
      detachInstallPrompt();
      detachAudioLifecycle();
      detachVisibility();
      resumeAutoSaveUnsubscribe?.();
      stopAutoSave();
    };
  }, []);
  useSpacebarPlayToggle();
  useKeyboardTriggers();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
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
            <RecoveryBanner />
            <StorageDurabilityChip />
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
