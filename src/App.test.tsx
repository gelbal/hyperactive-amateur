// ABOUTME: Smoke test for the App component — confirms the title renders.
// ABOUTME: First test in the suite; doubles as a "test runner works" check.
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the title", () => {
    render(<App />);
    expect(screen.getByText("Hyperpad")).toBeInTheDocument();
  });
});
