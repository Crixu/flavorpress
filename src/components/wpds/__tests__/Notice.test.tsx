import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Notice } from "../Notice";

describe("Notice", () => {
  it("renders children", () => {
    render(<Notice>Hello</Notice>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies info tone by default", () => {
    render(<Notice>X</Notice>);
    expect(screen.getByText("X").className).toMatch(/wpds-notice-info/);
  });

  it("applies each tone variant", () => {
    const { rerender } = render(<Notice tone="warn">A</Notice>);
    expect(screen.getByText("A").className).toMatch(/wpds-notice-warn/);
    rerender(<Notice tone="error">B</Notice>);
    expect(screen.getByText("B").className).toMatch(/wpds-notice-error/);
    rerender(<Notice tone="success">C</Notice>);
    expect(screen.getByText("C").className).toMatch(/wpds-notice-success/);
  });
});
