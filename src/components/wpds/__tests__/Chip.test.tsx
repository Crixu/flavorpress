import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chip } from "../Chip";

describe("Chip", () => {
  it("renders label", () => {
    render(<Chip label="Coffee" />);
    expect(screen.getByText("Coffee")).toBeInTheDocument();
  });

  it("renders count when provided", () => {
    render(<Chip label="Coffee" count={9} />);
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("applies on state when active", () => {
    render(<Chip label="A" active />);
    expect(screen.getByText("A").closest("button")?.className).toMatch(/on/);
  });

  it("calls onClick when clicked", async () => {
    const fn = vi.fn();
    render(<Chip label="Click" onClick={fn} />);
    await userEvent.click(screen.getByText("Click"));
    expect(fn).toHaveBeenCalledOnce();
  });

  it("omits count when undefined", () => {
    render(<Chip label="X" />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
