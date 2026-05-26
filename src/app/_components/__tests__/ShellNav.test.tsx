import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShellNav } from "../ShellNav";

const mockUsePathname = vi.fn(() => "/reader");

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("ShellNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/reader");
  });

  it("renders all tab labels", () => {
    render(<ShellNav />);
    expect(screen.getAllByRole("link", { name: "Today" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Reader" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Drafts" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Sources" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Voice/ })).toHaveLength(2);
  });

  it("shows workflows only when available", () => {
    const { rerender } = render(<ShellNav />);
    expect(screen.queryByRole("link", { name: "Workflows" })).not.toBeInTheDocument();

    rerender(<ShellNav showWorkflowAutopublish />);
    expect(screen.getAllByRole("link", { name: "Workflows" })).toHaveLength(2);
  });

  it("marks the active tab based on pathname", () => {
    render(<ShellNav />);
    const readerLinks = screen.getAllByRole("link", { name: "Reader" });
    expect(readerLinks.every((link) => link.className.match(/\bon\b/))).toBe(true);
    expect(readerLinks.every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("does not mark inactive tabs", () => {
    render(<ShellNav />);
    const todayLinks = screen.getAllByRole("link", { name: "Today" });
    expect(todayLinks.every((link) => !link.className.match(/\bon\b/))).toBe(true);
  });

  it("shows the active section in the mobile menu trigger", () => {
    const { container } = render(<ShellNav />);
    expect(container.querySelector(".fp-mobile-menu-current")).toHaveTextContent("Reader");
  });

  it("uses a neutral mobile menu label on routes outside the primary nav", () => {
    mockUsePathname.mockReturnValue("/settings");
    const { container } = render(<ShellNav />);

    expect(container.querySelector(".fp-mobile-menu-current")).toHaveTextContent("Navigation");
    expect(screen.getAllByRole("link").every((link) => !link.className.match(/\bon\b/))).toBe(true);
  });

  it("closes the mobile menu after selecting a link", async () => {
    const user = userEvent.setup();
    const { container } = render(<ShellNav />);
    const menu = container.querySelector(".fp-mobile-menu") as HTMLDetailsElement;

    await user.click(screen.getByText("Menu"));
    expect(menu.open).toBe(true);

    await user.click(screen.getAllByRole("link", { name: "Sources" })[1]!);
    expect(menu.open).toBe(false);
  });
});
