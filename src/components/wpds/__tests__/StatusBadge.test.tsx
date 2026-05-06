import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";

describe("StatusBadge", () => {
  it("renders children", () => {
    render(<StatusBadge status="ok">Connected</StatusBadge>);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("applies status class for each tone", () => {
    const { rerender } = render(<StatusBadge status="ok">A</StatusBadge>);
    expect(screen.getByText("A").className).toMatch(/wpds-badge-ok/);
    rerender(<StatusBadge status="warn">B</StatusBadge>);
    expect(screen.getByText("B").className).toMatch(/wpds-badge-warn/);
    rerender(<StatusBadge status="error">C</StatusBadge>);
    expect(screen.getByText("C").className).toMatch(/wpds-badge-error/);
    rerender(<StatusBadge status="default-outlet">D</StatusBadge>);
    expect(screen.getByText("D").className).toMatch(/wpds-badge-default-outlet/);
  });
});
