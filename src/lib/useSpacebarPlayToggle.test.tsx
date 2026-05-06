// ABOUTME: Tests that spacebar at the document level toggles playback,
// ABOUTME: but is suppressed when focus is in an input/textarea or when key is held.
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const togglePlayback = vi.fn();
vi.mock("./audio", () => ({
  togglePlayback: (...args: unknown[]) => togglePlayback(...args),
}));

import { useSpacebarPlayToggle } from "./useSpacebarPlayToggle";

function Harness({ withInput = false }: { withInput?: boolean }) {
  useSpacebarPlayToggle();
  return withInput ? <input data-testid="x" /> : null;
}

describe("useSpacebarPlayToggle", () => {
  beforeEach(() => {
    togglePlayback.mockClear();
  });

  it("calls togglePlayback on spacebar from document body", () => {
    render(<Harness />);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    expect(togglePlayback).toHaveBeenCalledTimes(1);
  });

  it("ignores key repeats", () => {
    render(<Harness />);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", repeat: true, bubbles: true }),
    );
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("ignores spacebar inside input elements", () => {
    const { getByTestId } = render(<Harness withInput />);
    const input = getByTestId("x");
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("only triggers on Space, not other keys", () => {
    render(<Harness />);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Enter", bubbles: true }),
    );
    expect(togglePlayback).not.toHaveBeenCalled();
  });
});
