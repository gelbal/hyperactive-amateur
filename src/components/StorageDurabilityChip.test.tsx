// ABOUTME: StorageDurabilityChip tests — warns when recorded clips live in best-effort browser storage.
// ABOUTME: Pins local dismissal and iOS-class separate-storage caveat behavior.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetInstallForTesting } from "../lib/install";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";
import { StorageDurabilityChip } from "./StorageDurabilityChip";

const BASE_COPY =
  "This project can be cleared by the browser — visit regularly or install the app.";
const IOS_STORAGE_CAVEAT =
  "Installing the app later starts with separate storage, so this browser project will stay here.";

const originalMatchMedia = window.matchMedia;

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/storage-chip",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

function stubMatchMedia({
  coarse = false,
  standalone = false,
}: {
  coarse?: boolean;
  standalone?: boolean;
}) {
  window.matchMedia = vi.fn((query: string) => ({
    matches:
      (query === "(pointer: coarse)" && coarse) ||
      (query === "(display-mode: standalone)" && standalone),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("StorageDurabilityChip", () => {
  beforeEach(() => {
    __resetInstallForTesting();
    useAppStore.getState().actions.reset();
    window.matchMedia = originalMatchMedia;
  });

  afterEach(() => {
    __resetInstallForTesting();
    window.matchMedia = originalMatchMedia;
  });

  it("renders the pinned durability copy when clips exist in best-effort storage", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    useAppStore.getState().actions.setStorageDurability("best-effort");

    render(<StorageDurabilityChip />);

    expect(screen.getByText(BASE_COPY)).toBeInTheDocument();
  });

  it("is hidden without clips and when storage is persistent", () => {
    useAppStore.getState().actions.setStorageDurability("best-effort");
    const { rerender } = render(<StorageDurabilityChip />);
    expect(screen.queryByText(BASE_COPY)).toBeNull();

    act(() => {
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      useAppStore.getState().actions.setStorageDurability("persistent");
    });
    rerender(<StorageDurabilityChip />);
    expect(screen.queryByText(BASE_COPY)).toBeNull();
  });

  it("treats unknown durability as a warning state once clips exist", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());

    render(<StorageDurabilityChip />);

    expect(screen.getByText(BASE_COPY)).toBeInTheDocument();
  });

  it("dismisses only for the current component mount", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    useAppStore.getState().actions.setStorageDurability("best-effort");
    const { unmount } = render(<StorageDurabilityChip />);

    fireEvent.click(screen.getByLabelText("Dismiss storage durability notice"));
    expect(screen.queryByText(BASE_COPY)).toBeNull();

    unmount();
    render(<StorageDurabilityChip />);
    expect(screen.getByText(BASE_COPY)).toBeInTheDocument();
  });

  it("appends the separate-storage caveat in iOS-class browser mode", () => {
    stubMatchMedia({ coarse: true });
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    useAppStore.getState().actions.setStorageDurability("best-effort");

    render(<StorageDurabilityChip />);

    expect(screen.getByText(`${BASE_COPY} ${IOS_STORAGE_CAVEAT}`)).toBeInTheDocument();
  });
});
