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
});
