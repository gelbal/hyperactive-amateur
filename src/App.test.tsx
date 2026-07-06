// ABOUTME: App tests — autosave gating around rehydration outcomes.
// ABOUTME: Degraded loads keep autosave paused until the recovery notice is acknowledged.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rehydrateMocks = vi.hoisted(() => ({
  rehydrateFromStorage: vi.fn(),
}));

const autoSaveMocks = vi.hoisted(() => ({
  startAutoSave: vi.fn(),
  shutdownAutoSave: vi.fn(),
}));

vi.mock("./lib/audio", () => ({ initTransport: vi.fn() }));
vi.mock("./lib/audioLifecycle", () => ({ initAudioLifecycle: vi.fn(() => vi.fn()) }));
vi.mock("./lib/streamLifecycle", () => ({ installVisibilityListener: vi.fn(() => vi.fn()) }));
vi.mock("./lib/install", () => ({
  captureInstallPrompt: vi.fn(() => vi.fn()),
  getStorageDurability: vi.fn(async () => "unknown"),
}));
vi.mock("./lib/rehydrate", () => ({
  rehydrateFromStorage: rehydrateMocks.rehydrateFromStorage,
}));
vi.mock("./lib/autoSave", () => ({
  startAutoSave: autoSaveMocks.startAutoSave,
  shutdownAutoSave: autoSaveMocks.shutdownAutoSave,
}));
vi.mock("./lib/useSpacebarPlayToggle", () => ({ useSpacebarPlayToggle: vi.fn() }));
vi.mock("./lib/useKeyboardTriggers", () => ({ useKeyboardTriggers: vi.fn() }));
vi.mock("./lib/aiSuggest", () => ({ AI_UNLOCK_CLIPS: 3 }));
vi.mock("./components/Viewport", () => ({ Viewport: () => null }));
vi.mock("./components/PadGrid", () => ({ PadGrid: () => null }));
vi.mock("./components/StepGrid", () => ({ StepGrid: () => null }));
vi.mock("./components/PlayButton", () => ({ PlayButton: () => null }));
vi.mock("./components/BpmDial", () => ({ BpmDial: () => null }));
vi.mock("./components/ExportButton", () => ({ ExportButton: () => null }));
vi.mock("./components/SuggestButton", () => ({ SuggestButton: () => null }));
vi.mock("./components/FlowSelector", () => ({ FlowSelector: () => null }));
vi.mock("./components/CompatibilityBanner", () => ({ CompatibilityBanner: () => null }));
vi.mock("./components/FeelDisclosure", () => ({ FeelDisclosure: () => null }));
vi.mock("./components/StorageDurabilityChip", () => ({ StorageDurabilityChip: () => null }));

import { App } from "./App";
import { useAppStore } from "./store/useAppStore";

const REPAIR_WARNING = "Track 1 audio unavailable — re-record to restore sound.";

async function renderApp(): Promise<void> {
  await act(async () => {
    render(<App />);
  });
}

describe("App autosave gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().actions.reset();
    rehydrateMocks.rehydrateFromStorage.mockResolvedValue({
      ok: true,
      degraded: false,
      warnings: [],
    });
  });

  it("starts autosave after a clean load", async () => {
    await renderApp();

    expect(autoSaveMocks.startAutoSave).toHaveBeenCalledTimes(1);
  });

  it("does not start autosave for a degraded-but-hydrated load", async () => {
    rehydrateMocks.rehydrateFromStorage.mockImplementation(async () => {
      useAppStore.getState().actions.setRecoveryWarnings([REPAIR_WARNING]);
      return { ok: true, degraded: true, warnings: [REPAIR_WARNING] };
    });

    await renderApp();

    expect(autoSaveMocks.startAutoSave).not.toHaveBeenCalled();
  });

  it("re-enables autosave when the recovery notice is dismissed after a hydrated degraded load", async () => {
    rehydrateMocks.rehydrateFromStorage.mockImplementation(async () => {
      useAppStore.getState().actions.setRecoveryWarnings([REPAIR_WARNING]);
      return { ok: true, degraded: true, warnings: [REPAIR_WARNING] };
    });
    await renderApp();
    expect(autoSaveMocks.startAutoSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Dismiss recovery notice"));

    expect(autoSaveMocks.startAutoSave).toHaveBeenCalledTimes(1);
  });

  it("keeps autosave paused even after dismissal when the load did not hydrate", async () => {
    rehydrateMocks.rehydrateFromStorage.mockImplementation(async () => {
      useAppStore.getState().actions.setRecoveryWarnings([
        "Saved project could not be migrated. Autosave was paused to avoid overwriting it.",
      ]);
      return {
        ok: false,
        degraded: true,
        warnings: [
          "Saved project could not be migrated. Autosave was paused to avoid overwriting it.",
        ],
      };
    });
    await renderApp();

    fireEvent.click(screen.getByLabelText("Dismiss recovery notice"));

    expect(autoSaveMocks.startAutoSave).not.toHaveBeenCalled();
  });

  it("keeps autosave paused when rehydration rejects", async () => {
    rehydrateMocks.rehydrateFromStorage.mockRejectedValue(new Error("load blew up"));

    await renderApp();

    expect(autoSaveMocks.startAutoSave).not.toHaveBeenCalled();
    expect(useAppStore.getState().ui.recoveryWarnings).toEqual([
      "Saved project could not be loaded. Autosave was paused to avoid overwriting it.",
    ]);
  });
});
