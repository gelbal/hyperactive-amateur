// ABOUTME: App tests — autosave starts after every load that resolves; a rejected load shows one line.
// ABOUTME: The shell keeps safe-area padding; no storage or recovery banners render.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("./components/PlayButton", () => ({ PlayButton: () => <div data-testid="play-button" /> }));
vi.mock("./components/BpmDial", () => ({ BpmDial: () => <div data-testid="bpm-dial" /> }));
vi.mock("./components/ExportButton", () => ({ ExportButton: () => null }));
vi.mock("./components/SuggestButton", () => ({ SuggestButton: () => null }));
vi.mock("./components/FlowSelector", () => ({ FlowSelector: () => null }));
vi.mock("./components/CompatibilityBanner", () => ({ CompatibilityBanner: () => null }));
vi.mock("./components/FeelDisclosure", () => ({ FeelDisclosure: () => null }));

import { App } from "./App";
import { useAppStore } from "./store/useAppStore";
import { clearLogs, getLogs, LOG_EVENTS } from "./lib/logger";

const LOAD_FAILED_COPY = "Couldn't open your saved project — recordings won't be saved.";

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
    vi.clearAllMocks();
    clearLogs();
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

  it("puts the transport beside the title and drops the space hint", async () => {
    await renderApp();

    const title = screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i });
    expect(title).toHaveClass("text-2xl", "min-[360px]:text-3xl", "sm:text-5xl");
    const titleRow = title.parentElement?.parentElement;
    expect(titleRow).toHaveClass("flex", "items-center", "justify-between");
    expect(titleRow).toContainElement(screen.getByTestId("play-button"));
    expect(titleRow).toContainElement(screen.getByTestId("bpm-dial"));
    expect(screen.queryByText("space")).not.toBeInTheDocument();
  });

  it("renders no storage durability notice even with clips in best-effort storage", async () => {
    useAppStore.getState().actions.setStorageDurability("best-effort");
    useAppStore.getState().actions.setTrackClip(0, {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/clip-0",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      audioStatus: "ok",
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob: null,
      posterUrl: null,
    });

    await renderApp();

    expect(screen.queryByLabelText("Storage durability notice")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Protect project" })).not.toBeInTheDocument();
  });

  it("renders the on-device log panel only behind the halogs URL flag", async () => {
    await renderApp();
    expect(screen.queryByLabelText("Diagnostic log")).not.toBeInTheDocument();
    cleanup();

    vi.stubGlobal("location", { ...window.location, search: "?halogs=1" });
    await renderApp();

    expect(screen.getByLabelText("Diagnostic log")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("starts autosave after a clean load", async () => {
    await renderApp();

    expect(autoSaveMocks.startAutoSave).toHaveBeenCalledTimes(1);
  });

  it("starts autosave for a degraded-but-hydrated load and shows no recovery notice", async () => {
    rehydrateMocks.rehydrateFromStorage.mockResolvedValue({
      ok: true,
      degraded: true,
      warnings: ["Track 1 trim window was clamped."],
    });

    await renderApp();

    expect(autoSaveMocks.startAutoSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Recovered saved project/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Project recovery notice")).not.toBeInTheDocument();
  });

  it("starts autosave after a load that resolved ok: false", async () => {
    rehydrateMocks.rehydrateFromStorage.mockResolvedValue({
      ok: false,
      degraded: true,
      warnings: [],
    });

    await renderApp();

    expect(autoSaveMocks.startAutoSave).toHaveBeenCalledTimes(1);
  });

  it("shows one line and keeps autosave off when rehydration rejects", async () => {
    rehydrateMocks.rehydrateFromStorage.mockRejectedValue(new Error("load blew up"));
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    await renderApp();

    expect(autoSaveMocks.startAutoSave).not.toHaveBeenCalled();
    expect(screen.getByText(LOAD_FAILED_COPY)).toBeInTheDocument();
    expect(getLogs().some((entry) => entry.event === LOG_EVENTS.RECOVERY_LOAD_FAILED)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
