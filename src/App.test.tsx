// ABOUTME: App tests — autosave starts after every load that resolves; a rejected load shows one line.
// ABOUTME: Pins the header rows for both modes; no storage or recovery banners render.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rehydrateMocks = vi.hoisted(() => ({
  rehydrateFromStorage: vi.fn(),
}));

const moodRehydrateMocks = vi.hoisted(() => ({
  rehydrateMoodFromStorage: vi.fn(),
  decodeMoodTakes: vi.fn(),
}));

const autoSaveMocks = vi.hoisted(() => ({
  startAutoSave: vi.fn(),
  shutdownAutoSave: vi.fn(),
}));

const chopRecordingMocks = vi.hoisted(() => ({
  cancelCurrentRecording: vi.fn(),
  registerChopRecordingInterrupt: vi.fn(),
  unregisterChopRecordingInterrupt: vi.fn(),
}));

const audioMocks = vi.hoisted(() => ({
  context: { currentTime: 12 },
}));

const moodModeHarness = vi.hoisted(() => ({
  pending: new Promise<never>(() => undefined),
  suspend: true,
  crash: false,
}));

vi.mock("./lib/audio", () => ({
  getAudioContext: () => audioMocks.context,
  initTransport: vi.fn(),
}));
vi.mock("./lib/audioLifecycle", () => ({ initAudioLifecycle: vi.fn(() => vi.fn()) }));
vi.mock("./lib/recordingFlow", () => ({
  COUNTDOWN_MS: 3_000,
  RECORD_DURATION_MS: 2_000,
  cancelCurrentRecording: chopRecordingMocks.cancelCurrentRecording,
  registerChopRecordingInterrupt: chopRecordingMocks.registerChopRecordingInterrupt,
}));
vi.mock("./lib/streamLifecycle", () => ({ installVisibilityListener: vi.fn(() => vi.fn()) }));
vi.mock("./lib/install", () => ({
  captureInstallPrompt: vi.fn(() => vi.fn()),
  getStorageDurability: vi.fn(async () => "unknown"),
}));
vi.mock("./lib/rehydrate", () => ({
  rehydrateFromStorage: rehydrateMocks.rehydrateFromStorage,
}));
vi.mock("./lib/moodRehydrate", () => ({
  rehydrateMoodFromStorage: moodRehydrateMocks.rehydrateMoodFromStorage,
  decodeMoodTakes: moodRehydrateMocks.decodeMoodTakes,
}));
vi.mock("./lib/autoSave", () => ({
  startAutoSave: autoSaveMocks.startAutoSave,
  shutdownAutoSave: autoSaveMocks.shutdownAutoSave,
}));
vi.mock("./lib/useSpacebarPlayToggle", () => ({ useSpacebarPlayToggle: vi.fn() }));
vi.mock("./lib/useKeyboardTriggers", () => ({ useKeyboardTriggers: vi.fn() }));
vi.mock("./lib/aiSuggest", () => ({ AI_UNLOCK_CLIPS: 3 }));
vi.mock("./components/Viewport", () => ({
  Viewport: () => <div data-testid="chop-viewport" />,
}));
vi.mock("./components/PadGrid", () => ({
  PadGrid: () => <div data-testid="pad-grid" />,
}));
vi.mock("./components/StepGrid", () => ({
  StepGrid: () => <div data-testid="step-grid" />,
}));
vi.mock("./components/PlayButton", () => ({ PlayButton: () => <div data-testid="play-button" /> }));
vi.mock("./components/BpmDial", () => ({ BpmDial: () => <div data-testid="bpm-dial" /> }));
vi.mock("./components/ExportButton", () => ({ ExportButton: () => <div data-testid="export-button" /> }));
vi.mock("./components/SuggestButton", () => ({ SuggestButton: () => <div data-testid="suggest-button" /> }));
vi.mock("./components/CompatibilityBanner", () => ({ CompatibilityBanner: () => null }));
vi.mock("./components/FeelDisclosure", () => ({ FeelDisclosure: () => <div data-testid="feel-button" /> }));
vi.mock("./components/mood/MoodMode", async () => {
  const { createElement } = await import("react");
  const { createPortal } = await import("react-dom");
  const { useAppStore: useMockStore } = await import("./store/useAppStore");
  return {
    default: function MockMoodMode() {
      if (moodModeHarness.crash) {
        throw new TypeError("Failed to fetch dynamically imported module: /assets/MoodMode-old.js");
      }
      if (moodModeHarness.suspend) throw moodModeHarness.pending;
      const recordingState = useMockStore((s) => s.recording.state);
      const slot = document.querySelector<HTMLElement>("[data-mood-header-slot]");
      if (!slot) return null;
      const capturing = recordingState !== "idle";
      return createPortal(
        createElement(
          "div",
          {
            "data-testid": capturing ? "mood-recording-bar" : "mood-transport-cluster",
            role: capturing ? "status" : undefined,
          },
          capturing ? "Mood recording" : "Mood transport",
        ),
        slot,
      );
    },
  };
});

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
    window.localStorage.clear();
    vi.clearAllMocks();
    clearLogs();
    moodModeHarness.suspend = true;
    moodModeHarness.crash = false;
    useAppStore.getState().actions.reset();
    rehydrateMocks.rehydrateFromStorage.mockResolvedValue({
      ok: true,
      degraded: false,
      warnings: [],
    });
    chopRecordingMocks.registerChopRecordingInterrupt.mockReturnValue(
      chopRecordingMocks.unregisterChopRecordingInterrupt,
    );
  });

  it("registers the Chop recording interrupt handler for the app lifetime", async () => {
    let unmount: () => void = () => undefined;
    await act(async () => {
      ({ unmount } = render(<App />));
    });

    expect(chopRecordingMocks.registerChopRecordingInterrupt).toHaveBeenCalledTimes(1);

    unmount();
    expect(chopRecordingMocks.unregisterChopRecordingInterrupt).toHaveBeenCalledTimes(1);
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

  it("before the first clip the header is the title and the mode switch: no Play, no controls row, no dial", async () => {
    await renderApp();

    const title = screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i });
    const row = title.parentElement!.parentElement as HTMLElement;
    // The title block and the Play cell, which holds only the mode switch.
    expect(row.children).toHaveLength(2);
    expect(screen.queryByTestId("play-button")).not.toBeInTheDocument();
    expect(row).toContainElement(screen.getByRole("group", { name: "Mode" }));
  });

  it("reserves an empty controls row while a saved project hydrates, so the page does not jump when the clips arrive", async () => {
    rehydrateMocks.rehydrateFromStorage.mockReturnValue(new Promise(() => undefined));
    await renderApp();

    expect(screen.getByText("Loading project…")).toBeInTheDocument();
    const title = screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i });
    const row = title.parentElement!.parentElement as HTMLElement;
    const wrapper = row.children[1] as HTMLElement;
    // No Play while loading: the mode switch's cell and the reserved
    // controls row.
    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.firstElementChild).toContainElement(screen.getByRole("group", { name: "Mode" }));
    expect(screen.queryByTestId("play-button")).not.toBeInTheDocument();
    const controls = wrapper.lastElementChild as HTMLElement;
    expect(controls.children).toHaveLength(0);
    // The buttons' height: 38 px on fine pointers, 44 px on coarse ones.
    expect(controls).toHaveClass("min-h-[2.375rem]", "pointer-coarse:min-h-11");
  });

  it("with clips: title and Play share the first line; Export, Feel, Suggest fill the line below; at lg Play sits above them in a right-aligned column", async () => {
    seedClips(3);
    await renderApp();

    const title = screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i });
    // 5xl only from lg: a phone in landscape is wider than sm and must keep
    // the phone header.
    expect(title).toHaveClass("text-2xl", "min-[360px]:text-3xl", "lg:text-5xl");
    expect(title.className.split(/\s+/)).not.toContain("sm:text-5xl");

    // One wrapping flex container. The outer row stays wrappable at lg so a
    // narrow desktop window drops the column under the title rather than
    // scrolling sideways.
    const titleBlock = title.parentElement as HTMLElement;
    const row = titleBlock.parentElement as HTMLElement;
    expect(row).toHaveClass("flex", "flex-wrap", "items-center", "gap-y-0");
    expect(row.className.split(/\s+/)).not.toContain("lg:flex-nowrap");
    expect(titleBlock).toHaveClass("mr-auto");
    expect(titleBlock.className.split(/\s+/)).not.toContain("lg:mr-0");
    const play = screen.getByTestId("play-button");
    const playWrapper = play.parentElement as HTMLElement;
    expect(playWrapper).toHaveClass("shrink-0");
    expect(playWrapper.className.split(/\s+/)).not.toContain("lg:ml-auto");
    // Below lg the wrapper is display: contents, so Play and the controls
    // are the row's own items; at lg it is a right-aligned column.
    const wrapper = playWrapper.parentElement as HTMLElement;
    expect(wrapper).toHaveClass("contents", "lg:flex", "lg:flex-col", "lg:items-end", "lg:gap-3");
    // If a wide Suggest error wraps the column under the title, it stays
    // right-aligned instead of dropping to the left edge.
    expect(wrapper).toHaveClass("lg:ml-auto");
    expect(wrapper.parentElement).toBe(row);
    // A full-width controls row is its own line: no breaker needed.
    expect(row.querySelector(".basis-full")).toBeNull();
    const controls = wrapper.lastElementChild as HTMLElement;
    expect(controls).toHaveClass("w-full", "lg:w-auto", "mt-3", "lg:mt-0");
    expect(controls.className.split(/\s+/)).not.toContain("ml-auto");
    expect(controls.className.split(/\s+/)).not.toContain("justify-end");
    expect(controls).not.toContainElement(play);
    // The mode switch shares Play's cell (stacked on phones, beside Play at
    // lg with Play at the right edge), never the controls row.
    const modeSwitch = screen.getByRole("group", { name: "Mode" });
    expect(play.parentElement).toContainElement(modeSwitch);
    expect(play.parentElement).toHaveClass("flex-col", "lg:flex-row-reverse");
    expect(controls).not.toContainElement(modeSwitch);
    // The tempo lives under Feel; the header holds no dial at any width.
    expect(screen.queryByTestId("bpm-dial")).not.toBeInTheDocument();

    // DOM order: title, Play, controls.
    const follows = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(titleBlock, play)).toBe(true);
    expect(follows(play, controls)).toBe(true);
    const order = Array.from(controls.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["export-button", "feel-button", "suggest-button"]);
  });

  it("keeps Play, the pads and the grid after the last clip is deleted, so a drums-only beat stays editable", async () => {
    seedClips(1);
    await renderApp();

    act(() => useAppStore.getState().actions.deleteTrackClip(0));

    expect(screen.getByTestId("play-button")).toBeInTheDocument();
    expect(screen.getByTestId("pad-grid")).toBeInTheDocument();
    expect(screen.getByTestId("step-grid")).toBeInTheDocument();
    expect(screen.queryByText(/Record your first sound/)).not.toBeInTheDocument();
  });

  it("keeps Play and the controls while playing after the last clip goes, and after stop; reset drops them", async () => {
    seedClips(1);
    await renderApp();
    const actions = useAppStore.getState().actions;

    act(() => actions.setIsPlaying(true));
    act(() => actions.clearTrackClip(0));
    expect(screen.getByTestId("play-button")).toBeInTheDocument();
    expect(screen.getByTestId("export-button")).toBeInTheDocument();

    act(() => actions.setIsPlaying(false));
    // The editor stays unlocked after the first clip, so they stay after
    // stop too; only Scratch returns the header to the title.
    expect(screen.getByTestId("play-button")).toBeInTheDocument();
    act(() => actions.reset());
    expect(screen.queryByTestId("play-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-button")).not.toBeInTheDocument();
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

  it("locks the Mood viewport only when a piece exists and only at sm+tall", async () => {
    const shell = await renderApp();
    const main = shell.querySelector("main");
    expect(main).not.toBeNull();
    expect(shell).not.toHaveClass(
      "sm:h-[100dvh]",
      "sm:overflow-hidden",
      "sm:flex",
      "sm:flex-col",
    );
    expect(main).not.toHaveClass("sm:flex-1", "sm:min-h-0");

    act(() => {
      useAppStore.getState().actions.setAppMode("mood");
    });

    expect(shell).not.toHaveClass(
      "sm:tall:h-[100dvh]",
      "sm:tall:overflow-hidden",
      "sm:tall:flex",
      "sm:tall:flex-col",
    );
    expect(main).not.toHaveClass("sm:tall:flex-1", "sm:tall:min-h-0");

    act(() => {
      useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    });

    expect(shell).toHaveClass(
      "sm:tall:h-[100dvh]",
      "sm:tall:overflow-hidden",
      "sm:tall:flex",
      "sm:tall:flex-col",
    );
    expect(main).toHaveClass(
      "sm:tall:flex-1",
      "sm:tall:min-h-0",
      "sm:tall:flex",
      "sm:tall:flex-col",
    );
    expect(shell.className).not.toMatch(/(?:^|\s)sm:h-\[100dvh\](?:\s|$)/);
  });

  it("starts autosave after a clean load", async () => {
    await renderApp();

    expect(autoSaveMocks.startAutoSave).toHaveBeenCalledTimes(1);
  });

  it("does not hydrate Mood at App boot", async () => {
    await renderApp();

    expect(moodRehydrateMocks.rehydrateMoodFromStorage).not.toHaveBeenCalled();
    expect(moodRehydrateMocks.decodeMoodTakes).not.toHaveBeenCalled();
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

  it("keeps the one failed-load line in Mood, where nothing is saved either", async () => {
    rehydrateMocks.rehydrateFromStorage.mockRejectedValue(new Error("load blew up"));
    useAppStore.getState().actions.setAppMode("mood");

    await renderApp();

    expect(autoSaveMocks.startAutoSave).not.toHaveBeenCalled();
    expect(screen.getByText(LOAD_FAILED_COPY)).toBeInTheDocument();
    expect(screen.getByText("Loading mood...")).toBeInTheDocument();
  });

  it("keeps the app and shows one reload line when the Mood screen fails to load", async () => {
    // After a deploy an open app's lazy Mood chunk can 404; React reports the
    // caught error on the console, which this test captures.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    moodModeHarness.crash = true;
    useAppStore.getState().actions.setAppMode("mood");

    await renderApp();

    expect(screen.getByText("Couldn't open Mood — reload to try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Hyperactive\s+Amateur/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    const failed = getLogs().find((entry) => entry.event === LOG_EVENTS.MOOD_LOAD_FAILED);
    expect(failed?.payload).toMatchObject({ message: expect.stringContaining("dynamically imported") });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("shows the lazy Mood fallback and unmounts the Chop surface in Mood", async () => {
    seedClips(1);
    useAppStore.getState().actions.setAppMode("mood");

    await renderApp();

    expect(screen.getByText("Loading mood...")).toBeInTheDocument();
    expect(screen.queryByTestId("chop-viewport")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pad-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-grid")).not.toBeInTheDocument();
  });

  it("provides the bare Mood header portal slot before Export", async () => {
    useAppStore.getState().actions.setAppMode("mood");
    const shell = await renderApp();

    const slot = shell.querySelector<HTMLElement>("[data-mood-header-slot]");
    expect(slot).not.toBeNull();
    expect(slot).toHaveClass("contents");

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodTake("mic-0", {
        id: "the-one",
        videoBlob: new Blob(["take"], { type: "video/webm" }),
        audioBlob: null,
        posterBlob: null,
        url: "blob:take",
        audioBuffer: { duration: 2, sampleRate: 48000 } as AudioBuffer,
        audioStatus: "ok",
        posterUrl: null,
        trimStartMs: 0,
        trimEndMs: 2000,
        durationSeconds: 2,
        cycleMultiple: 1,
        syncOffsetMs: 0,
        part: null,
        partSource: null,
        recordedAt: 1,
      });
    });

    const exportButton = screen.getByTestId("export-button");
    expect(
      slot?.compareDocumentPosition(exportButton) ?? 0,
    ).toEqual(expect.any(Number));
    expect(
      (slot?.compareDocumentPosition(exportButton) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("mounts the export affordance in Mood once a cycle exists", async () => {
    useAppStore.getState().actions.setAppMode("mood");
    await renderApp();

    expect(screen.queryByTestId("export-button")).not.toBeInTheDocument();

    act(() => {
      const actions = useAppStore.getState().actions;
      actions.createMoodPiece("corners", "pocket");
      actions.setMoodTake("mic-0", {
        id: "the-one",
        videoBlob: new Blob(["take"], { type: "video/webm" }),
        audioBlob: null,
        posterBlob: null,
        url: "blob:take",
        audioBuffer: { duration: 2, sampleRate: 48000 } as AudioBuffer,
        audioStatus: "ok",
        posterUrl: null,
        trimStartMs: 0,
        trimEndMs: 2000,
        durationSeconds: 2,
        cycleMultiple: 1,
        syncOffsetMs: 0,
        part: null,
        partSource: null,
        recordedAt: 1,
      });
    });

    // Mood's Export sits in a full-width controls row after the mode
    // switch's cell, like Chop's.
    const exportButton = screen.getByTestId("export-button");
    const controls = exportButton.parentElement as HTMLElement;
    expect(controls).toHaveClass("w-full", "lg:w-auto", "mt-3", "lg:mt-0");
    expect(controls.previousElementSibling).toContainElement(
      screen.getByRole("group", { name: "Mode" }),
    );
  });

  it("Mood's controls line holds the transport cluster and Export; capture swaps in the recording bar", async () => {
    moodModeHarness.suspend = false;
    useAppStore.getState().actions.setAppMode("mood");
    const actions = useAppStore.getState().actions;
    actions.createMoodPiece("corners", "pocket");
    actions.setMoodTake("mic-0", {
      id: "the-one",
      videoBlob: new Blob(["take"], { type: "video/webm" }),
      audioBlob: null,
      posterBlob: null,
      url: "blob:take",
      audioBuffer: { duration: 2, sampleRate: 48000 } as AudioBuffer,
      audioStatus: "ok",
      posterUrl: null,
      trimStartMs: 0,
      trimEndMs: 2000,
      durationSeconds: 2,
      cycleMultiple: 1,
      syncOffsetMs: 0,
      part: null,
      partSource: null,
      recordedAt: 1,
    });
    const shell = await renderApp();

    const slot = shell.querySelector<HTMLElement>("[data-mood-header-slot]");
    const controlRow = slot?.parentElement as HTMLElement;
    // A full-width controls row after the mode switch's cell, like Chop's;
    // the switch stays on the title line.
    expect(controlRow).toHaveClass("w-full", "lg:w-auto", "mt-3", "lg:mt-0", "flex", "flex-wrap");
    expect(controlRow.previousElementSibling).toContainElement(
      screen.getByRole("group", { name: "Mode" }),
    );
    expect(within(controlRow).queryByRole("group", { name: "Mode" })).not.toBeInTheDocument();
    expect(within(controlRow).getByTestId("mood-transport-cluster")).toBeInTheDocument();
    expect(within(controlRow).queryByTestId("mood-recording-bar")).not.toBeInTheDocument();
    expect(within(controlRow).getByTestId("export-button")).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setRecordingState("countdown", null);
    });

    expect(within(controlRow).queryByTestId("mood-transport-cluster")).not.toBeInTheDocument();
    expect(within(controlRow).getByTestId("mood-recording-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("export-button")).not.toBeInTheDocument();
  });

  it("hides Chop header controls in Mood and restores them in Chop", async () => {
    seedClips(1);
    await renderApp();

    expect(screen.getByTestId("play-button")).toBeInTheDocument();
    expect(screen.getByTestId("export-button")).toBeInTheDocument();
    expect(screen.getByTestId("feel-button")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mood" }));

    expect(screen.queryByTestId("play-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feel-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-grid")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chop" }));

    expect(screen.getByTestId("play-button")).toBeInTheDocument();
    expect(screen.getByTestId("export-button")).toBeInTheDocument();
    expect(screen.getByTestId("feel-button")).toBeInTheDocument();
    expect(screen.getByTestId("step-grid")).toBeInTheDocument();
  });
});
