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
    expect(screen.queryByText("Workflow autopublish")).not.toBeInTheDocument();
  });

  it("marks the active section", () => {
    render(<SettingsSidebar active="library" />);
    expect(screen.getByText("Library").closest("a")?.className).toMatch(/on/);
    expect(screen.getByText("Authentication").closest("a")?.className).not.toMatch(/\bon\b/);
  });
});
