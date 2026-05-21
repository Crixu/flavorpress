import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShellNav } from "../ShellNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/reader",
}));

describe("ShellNav", () => {
  it("renders all tab labels", () => {
    render(<ShellNav />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Reader")).toBeInTheDocument();
    expect(screen.getByText("Drafts")).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText(/Voice/)).toBeInTheDocument();
  });

  it("shows workflows only when available", () => {
    const { rerender } = render(<ShellNav />);
    expect(screen.queryByText("Workflows")).not.toBeInTheDocument();

    rerender(<ShellNav showWorkflowAutopublish />);
    expect(screen.getByText("Workflows")).toBeInTheDocument();
  });

  it("marks the active tab based on pathname", () => {
    render(<ShellNav />);
    const reader = screen.getByText("Reader").closest("a");
    expect(reader?.className).toMatch(/on/);
  });

  it("does not mark inactive tabs", () => {
    render(<ShellNav />);
    const today = screen.getByText("Today").closest("a");
    expect(today?.className).not.toMatch(/\bon\b/);
  });
});
