import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayStats } from "../TodayStats";

describe("TodayStats", () => {
  it("renders all three stat values", () => {
    render(<TodayStats newSinceLastVisit={5} draftsInProgress={2} sentThisMonth={14} />);
    expect(screen.getByText("5 new")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("renders zero values without breaking", () => {
    render(<TodayStats newSinceLastVisit={0} draftsInProgress={0} sentThisMonth={0} />);
    expect(screen.getByText("0 new")).toBeInTheDocument();
  });
});
