// ABOUTME: FeelDisclosure tests — closed by default, label reflects state, click toggles popover.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { FeelDisclosure } from "./FeelDisclosure";
import { useAppStore } from "../store/useAppStore";

describe("FeelDisclosure", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders the live state in the trigger label", () => {
    render(<FeelDisclosure />);
    const trigger = screen.getByLabelText("Feel — cut rate, swing, hold");
    expect(trigger).toHaveTextContent("1/8");
    expect(trigger).toHaveTextContent("0%");
    expect(trigger).toHaveTextContent("400ms");
  });

  it("starts closed and opens on click", () => {
    render(<FeelDisclosure />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Feel — cut rate, swing, hold"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("popover hosts the cut-rate, swing, and hold controls", () => {
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel — cut rate, swing, hold"));
    expect(screen.getByLabelText("cut rate")).toBeInTheDocument();
    expect(screen.getByLabelText("swing")).toBeInTheDocument();
    expect(screen.getByLabelText("hold time")).toBeInTheDocument();
  });

  it("changing a control inside the popover updates the trigger label", () => {
    render(<FeelDisclosure />);
    const trigger = screen.getByLabelText("Feel — cut rate, swing, hold");
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("swing"), { target: { value: "50" } });
    expect(trigger).toHaveTextContent("50%");
  });

  it("closes when Escape is pressed", () => {
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel — cut rate, swing, hold"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  describe("Scratch", () => {
    it("the first click reveals confirm + cancel without scratching", () => {
      useAppStore.getState().actions.setBpm(140);
      render(<FeelDisclosure />);
      fireEvent.click(screen.getByLabelText("Feel — cut rate, swing, hold"));
      fireEvent.click(screen.getByLabelText("Scratch — start fresh"));
      expect(screen.getByLabelText("Confirm scratch")).toBeInTheDocument();
      expect(screen.getByLabelText("Cancel scratch")).toBeInTheDocument();
      // BPM untouched.
      expect(useAppStore.getState().project.bpm).toBe(140);
    });

    it("Cancel returns to the initial Scratch button without changing state", () => {
      useAppStore.getState().actions.setBpm(140);
      render(<FeelDisclosure />);
      fireEvent.click(screen.getByLabelText("Feel — cut rate, swing, hold"));
      fireEvent.click(screen.getByLabelText("Scratch — start fresh"));
      fireEvent.click(screen.getByLabelText("Cancel scratch"));
      expect(screen.getByLabelText("Scratch — start fresh")).toBeInTheDocument();
      expect(useAppStore.getState().project.bpm).toBe(140);
    });

    it("Confirm wipes state and closes the popover", () => {
      useAppStore.getState().actions.setBpm(140);
      useAppStore.getState().actions.setSubgenre("phonk");
      render(<FeelDisclosure />);
      fireEvent.click(screen.getByLabelText("Feel — cut rate, swing, hold"));
      fireEvent.click(screen.getByLabelText("Scratch — start fresh"));
      fireEvent.click(screen.getByLabelText("Confirm scratch"));
      expect(useAppStore.getState().project.bpm).toBe(90);
      expect(useAppStore.getState().project.subgenre).toBe("boom-bap");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
