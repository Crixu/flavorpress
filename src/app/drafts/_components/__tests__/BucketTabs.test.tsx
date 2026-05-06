import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BucketTabs } from "../BucketTabs";

describe("BucketTabs", () => {
  it("renders three tabs with counts", () => {
    render(<BucketTabs active="in-progress" counts={{ "in-progress": 2, notes: 3, sent: 14 }} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("marks the active tab", () => {
    render(<BucketTabs active="notes" counts={{ "in-progress": 0, notes: 1, sent: 0 }} />);
    expect(screen.getByText("Notes").closest("a")?.className).toMatch(/on/);
    expect(screen.getByText("In progress").closest("a")?.className).not.toMatch(/\bon\b/);
  });

  it("links in-progress to /drafts (no bucket param)", () => {
    render(<BucketTabs active="in-progress" counts={{ "in-progress": 1, notes: 0, sent: 0 }} />);
    const link = screen.getByText("In progress").closest("a");
    expect(link?.getAttribute("href")).toBe("/drafts");
  });

  it("links notes and sent with bucket param", () => {
    render(<BucketTabs active="sent" counts={{ "in-progress": 0, notes: 0, sent: 5 }} />);
    const notesLink = screen.getByText("Notes").closest("a");
    const sentLink = screen.getByText("Sent").closest("a");
    expect(notesLink?.getAttribute("href")).toBe("/drafts?bucket=notes");
    expect(sentLink?.getAttribute("href")).toBe("/drafts?bucket=sent");
  });
});
