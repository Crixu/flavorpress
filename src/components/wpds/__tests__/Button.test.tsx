import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("forwards onClick", async () => {
    const fn = vi.fn();
    render(<Button onClick={fn}>Go</Button>);
    await userEvent.click(screen.getByText("Go"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("applies primary variant by default", () => {
    render(<Button>X</Button>);
    expect(screen.getByText("X").className).toMatch(/wpds-btn-primary/);
  });

  it("applies secondary, danger, link variants", () => {
    const { rerender } = render(<Button variant="secondary">A</Button>);
    expect(screen.getByText("A").className).toMatch(/wpds-btn-secondary/);
    rerender(<Button variant="danger">B</Button>);
    expect(screen.getByText("B").className).toMatch(/wpds-btn-danger/);
    rerender(<Button variant="link">C</Button>);
    expect(screen.getByText("C").className).toMatch(/wpds-btn-link/);
  });

  it("supports sm size", () => {
    render(<Button size="sm">Y</Button>);
    expect(screen.getByText("Y").className).toMatch(/wpds-btn-sm/);
  });

  it("forwards disabled prop", () => {
    render(<Button disabled>X</Button>);
    expect(screen.getByText("X")).toBeDisabled();
  });
});
