// ABOUTME: FlowSelector tests — pin the compact AI flow control's touch target contract.
// ABOUTME: The select stays visually small on fine pointers but reaches 44px on coarse pointers.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowSelector } from "./FlowSelector";

describe("FlowSelector", () => {
  it("sizes the select to 44px on coarse pointers", () => {
    render(<FlowSelector />);

    expect(screen.getByLabelText("Flow")).toHaveClass("pointer-coarse:min-h-11");
  });
});
