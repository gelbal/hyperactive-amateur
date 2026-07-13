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
vi.mock("./components/Viewport", () => ({
  Viewport: () => <div data-testid="chop-viewport">Chop viewport</div>,
}));
vi.mock("./components/PadGrid", () => ({
  PadGrid: () => <div data-testid="pad-grid">Pad grid</div>,
}));
vi.mock("./components/StepGrid", () => ({
  StepGrid: () => <div data-testid="step-grid">Step grid</div>,
}));
vi.mock("./components/PlayButton", () => ({
  PlayButton: () => <button type="button">Play</button>,
}));
vi.mock("./components/BpmDial", () => ({
  BpmDial: () => <div>BPM</div>,
}));
vi.mock("./components/ExportButton", () => ({
  ExportButton: () => <button type="button">Export</button>,
}));
vi.mock("./components/SuggestButton", () => ({
  SuggestButton: () => <button type="button">Suggest</button>,
}));
vi.mock("./components/FlowSelector", () => ({
  FlowSelector: () => <button type="button">Flow</button>,
}));
vi.mock("./components/CompatibilityBanner", () => ({ CompatibilityBanner: () => null }));
vi.mock("./components/FeelDisclosure", () => ({
  FeelDisclosure: () => <button type="button">Feel</button>,
}));
vi.mock("./components/StorageDurabilityChip", () => ({ StorageDurabilityChip: () => null }));
vi.mock("./components/mood/MoodMode", () => new Promise(() => undefined));

import { App } from "./App";
import { useAppStore } from "./store/useAppStore";

const REPAIR_WARNING = "Track 1 audio unavailable — re-record to restore sound.";

function addClip(): void {
  useAppStore.getState().actions.setTrackClip(0, {
    blob: new Blob(["clip"], { type: "video/webm" }),
    url: "blob:clip",
    audioBuffer: null,
    audioStatus: "unavailable",
    trimStartMs: 0,
    trimEndMs: 1000,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  });
}

async function renderApp(): Promise<HTMLElement> {
  let container: HTMLElement = document.createElement("div");
  await act(async () => {
    const rendered = render(<App />);
    container = rendered.container;
  });
  const shell = container.firstElementChild;
  if (!(shell instanceof HTMLElement)) throw new Error("App shell did not render");
  return shell;
}

describe("App autosave gating", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useAppStore.getState().actions.reset();
    rehydrateMocks.rehydrateFromStorage.mockResolvedValue({
      ok: true,
      degraded: false,
      warnings: [],
    });
  });

  it("keeps safe-area padding and dynamic viewport height on the shell", async () => {
    const shell = await renderApp();

    expect(shell).toHaveClass(
      "min-h-screen",
      "min-h-[100dvh]",
      "box-border",
      "pt-[env(safe-area-inset-top)]",
      "pb-[env(safe-area-inset-bottom)]",
      "pl-[env(safe-area-inset-left)]",
      "pr-[env(safe-area-inset-right)]",
    );
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

  it("shows the lazy Mood fallback and unmounts the Chop surface in Mood", async () => {
    addClip();
    useAppStore.getState().actions.setAppMode("mood");

    await renderApp();

    expect(screen.getByText("Loading mood...")).toBeInTheDocument();
    expect(screen.queryByTestId("chop-viewport")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pad-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-grid")).not.toBeInTheDocument();
  });

  it("hides Chop header controls in Mood and restores them in Chop", async () => {
    addClip();
    await renderApp();

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByText("BPM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mood" }));

    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(screen.queryByText("BPM")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-grid")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chop" }));

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByText("BPM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByTestId("step-grid")).toBeInTheDocument();
  });
});
