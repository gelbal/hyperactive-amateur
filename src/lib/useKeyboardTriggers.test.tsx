// ABOUTME: useKeyboardTriggers tests — pure code lookup + dispatch via mocked triggerTrack.
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
  it.each([
    ["Digit1", 0],
    ["Digit2", 1],
    ["Digit8", 7],
    ["Numpad1", 0],
    ["Numpad8", 7],
  ])("maps %s to %d", (code, id) => {
    expect(trackIdForCode(code)).toBe(id);
  });

  it.each(["Digit0", "Digit9", "KeyA", "Space", ""])("rejects %s", (code) => {
    expect(trackIdForCode(code)).toBeNull();
  });
});

describe("useKeyboardTriggers", () => {
  beforeEach(() => {
    triggerTrack.mockClear();
  });

  it("fires triggerTrack(trackId, now) on Digit1-8", () => {
    render(<Harness />);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }),
    );
    expect(triggerTrack).toHaveBeenCalledWith(2, 0.5);
  });

  it("ignores key repeats", () => {
    render(<Harness />);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit1", repeat: true, bubbles: true }),
    );
    expect(triggerTrack).not.toHaveBeenCalled();
  });

  it("ignores keys 9, 0, A, etc", () => {
    render(<Harness />);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit9", bubbles: true }),
    );
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", bubbles: true }));
    expect(triggerTrack).not.toHaveBeenCalled();
  });

  it("does not fire while focus is in an input", () => {
    const { getByTestId } = render(<Harness withInput />);
    const input = getByTestId("x");
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", bubbles: true }));
    expect(triggerTrack).not.toHaveBeenCalled();
  });
});
