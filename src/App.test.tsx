// ABOUTME: Smoke tests for the App component — title renders, play button mounts.
// ABOUTME: Tone.js is mocked here because App calls initTransport() in a useEffect.
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("tone", () => ({
  now: vi.fn(() => 0),
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
    bpm: { value: 90 },
  })),
  getDraw: vi.fn(() => ({ schedule: vi.fn() })),
  getContext: vi.fn(() => ({ rawContext: {} })),
  MembraneSynth: vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    toDestination: vi.fn(function (this: object) {
      return this;
    }),
  })),
  Player: vi.fn(() => ({
    start: vi.fn(),
    dispose: vi.fn(),
    loaded: true,
    toDestination: vi.fn(function (this: object) {
      return this;
    }),
  })),
}));

vi.mock("./lib/rehydrate", () => ({
  rehydrateFromStorage: vi.fn().mockResolvedValue(false),
}));
vi.mock("./lib/autoSave", () => ({
  startAutoSave: vi.fn(),
  stopAutoSave: vi.fn(),
}));
vi.mock("./lib/media", () => ({
  tryAutoGrantMedia: vi.fn().mockResolvedValue(undefined),
  requestMedia: vi.fn().mockResolvedValue(undefined),
}));

import { App } from "./App";

describe("App", () => {
  it("renders the title", async () => {
    render(<App />);
    expect(screen.getByText("Hyperactive Amateur")).toBeInTheDocument();
    // Wait for the rehydration effect to settle so React doesn't warn.
    await waitFor(() => expect(screen.queryByText(/Loading project/i)).not.toBeInTheDocument());
  });

  it("renders the play button", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start playback/i })).toBeInTheDocument(),
    );
  });
});
