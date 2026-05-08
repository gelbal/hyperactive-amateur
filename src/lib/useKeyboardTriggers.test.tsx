// ABOUTME: useKeyboardTriggers tests — code → trackId mapping + suppression in inputs.
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const triggerTrack = vi.fn();
vi.mock("./audio", () => ({
  triggerTrack: (...args: unknown[]) => triggerTrack(...args),
  nowSeconds: () => 0.5,
}));

import { useKeyboardTriggers, trackIdForCode } from "./useKeyboardTriggers";

function Harness({ withInput = false }: { withInput?: boolean }) {
  useKeyboardTriggers();
  return withInput ? <input data-testid="x" /> : null;
}

describe("trackIdForCode", () => {
  it("maps Digit1..8 and Numpad1..8; rejects everything else", () => {
    expect(trackIdForCode("Digit1")).toBe(0);
    expect(trackIdForCode("Digit8")).toBe(7);
    expect(trackIdForCode("Numpad3")).toBe(2);
    expect(trackIdForCode("Digit0")).toBeNull();
    expect(trackIdForCode("Digit9")).toBeNull();
    expect(trackIdForCode("KeyA")).toBeNull();
  });
});

describe("useKeyboardTriggers", () => {
  beforeEach(() => triggerTrack.mockClear());

  it("fires on Digit1, ignores held keys, ignores key-press inside an input", () => {
    const { getByTestId } = render(<Harness withInput />);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));
    expect(triggerTrack).toHaveBeenCalledWith(2, 0.5);
    triggerTrack.mockClear();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", repeat: true, bubbles: true }),
    );
    expect(triggerTrack).not.toHaveBeenCalled();
    getByTestId("x").dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }),
    );
    expect(triggerTrack).not.toHaveBeenCalled();
  });
});
