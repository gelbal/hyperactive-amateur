// ABOUTME: HoldTimeControl tests — initial value, slider change updates store.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { HoldTimeControl } from "./HoldTimeControl";
import { useAppStore } from "../store/useAppStore";

describe("HoldTimeControl", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders with the default 400ms value", () => {
    render(<HoldTimeControl />);
    const slider = screen.getByLabelText("hold time") as HTMLInputElement;
    expect(slider.value).toBe("400");
    expect(screen.getByText("400ms")).toBeInTheDocument();
  });

  it("changing the slider updates the store", () => {
    render(<HoldTimeControl />);
    fireEvent.change(screen.getByLabelText("hold time"), { target: { value: "750" } });
    expect(useAppStore.getState().project.sameTierHoldMs).toBe(750);
  });
});
