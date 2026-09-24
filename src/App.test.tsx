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
vi.mock("./components/ExportButton", () => ({ ExportButton: () => <div data-testid="export-button" /> }));
vi.mock("./components/SuggestButton", () => ({ SuggestButton: () => <div data-testid="suggest-button" /> }));
vi.mock("./components/CompatibilityBanner", () => ({ CompatibilityBanner: () => null }));
vi.mock("./components/FeelDisclosure", () => ({ FeelDisclosure: () => <div data-testid="feel-button" /> }));

import { App } from "./App";
import { useAppStore } from "./store/useAppStore";
import { clearLogs, getLogs, LOG_EVENTS } from "./lib/logger";

const LOAD_FAILED_COPY = "Couldn't open your saved project — recordings won't be saved.";

function seedClips(count: number): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      useAppStore.getState().actions.setTrackClip(i, {
        blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
        url: `blob:test/clip-${i}`,
        audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
        audioStatus: "ok",
        trimStartMs: 0,
        trimEndMs: 800,
        durationMs: 1000,
        posterBlob: null,
        posterUrl: null,
      });
    }
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

  it("before the first clip the header is the title and Play only: no controls row, no dial", async () => {
    await renderApp();

    const title = screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i });
    const row = title.parentElement!.parentElement as HTMLElement;
    // Title block, Play wrapper, nothing else: no breaker, no controls row.
    expect(row.children).toHaveLength(2);
    expect(row.querySelector(".basis-full")).toBeNull();
    expect(screen.queryByTestId("bpm-dial")).not.toBeInTheDocument();
  });

  it("with clips: title and Play share the first row; Export, Feel, Suggest sit on one right-aligned row below", async () => {
    seedClips(3);
    await renderApp();

    const title = screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i });
    // 5xl only from lg: a phone in landscape is wider than sm and must keep
    // the phone header.
    expect(title).toHaveClass("text-2xl", "min-[360px]:text-3xl", "lg:text-5xl");
    expect(title.className.split(/\s+/)).not.toContain("sm:text-5xl");
    expect(screen.queryByText("space")).not.toBeInTheDocument();

    // One wrapping flex container; a full-width breaker after Play forces the
    // controls onto their own line below lg and disappears at lg.
    const titleBlock = title.parentElement as HTMLElement;
    const row = titleBlock.parentElement as HTMLElement;
    expect(row).toHaveClass("flex", "flex-wrap", "items-center", "gap-y-0");
    // The zero-height breaker would double a row gap; the controls carry
    // their own top margin instead. The outer row stays wrappable at lg so a
    // narrow desktop window drops the controls under the title rather than
    // scrolling sideways.
    expect(row.className.split(/\s+/)).not.toContain("lg:flex-nowrap");
    expect(titleBlock).toHaveClass("mr-auto", "lg:mr-0");
    const play = screen.getByTestId("play-button");
    expect(play.parentElement).toHaveClass("lg:ml-auto");
    const breaker = row.querySelector(".basis-full") as HTMLElement;
    expect(breaker).toHaveClass("lg:hidden");
    expect(breaker).toHaveAttribute("aria-hidden", "true");
    const controls = breaker.nextElementSibling as HTMLElement;
    expect(controls).toHaveClass("ml-auto", "lg:ml-0", "justify-end", "mt-3", "lg:mt-0");
    expect(controls).not.toContainElement(play);
    // The tempo lives under Feel; the header holds no dial at any width.
    expect(screen.queryByTestId("bpm-dial")).not.toBeInTheDocument();

    // DOM order: title, Play, breaker, controls.
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(titleBlock, play)).toBe(true);
    expect(follows(play, breaker)).toBe(true);
    expect(follows(breaker, controls)).toBe(true);
    const order = Array.from(controls.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["export-button", "feel-button", "suggest-button"]);
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
