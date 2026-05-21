import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsSidebar } from "../SettingsSidebar";

describe("SettingsSidebar", () => {
  it("renders all sections", () => {
    render(<SettingsSidebar active="authentication" />);
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("Extensions")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin / Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin / Extensions")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow autopublish")).not.toBeInTheDocument();
  });

  it("marks the active section", () => {
    render(<SettingsSidebar active="library" />);
    expect(screen.getByText("Library").closest("a")?.className).toMatch(/on/);
    expect(screen.getByText("Authentication").closest("a")?.className).not.toMatch(/\bon\b/);
  });

  it("renders branched admin sections for admins", () => {
    render(<SettingsSidebar active="admin-users" showAdmin />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Admin / Users")).toBeInTheDocument();
    expect(screen.getByText("Admin / Extensions")).toBeInTheDocument();
    expect(screen.getByText("Admin / Users").closest("a")).toHaveAttribute(
      "href",
      "/settings/admin/users",
    );
    expect(screen.getByText("Admin / Users").closest("a")?.className).toMatch(/\bon\b/);
  });
});
