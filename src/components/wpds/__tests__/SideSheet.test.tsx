import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SideSheet } from "../SideSheet";

describe("SideSheet", () => {
  it("renders children when open", () => {
    render(
      <SideSheet open onClose={() => {}} title="Hi">
        body
      </SideSheet>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <SideSheet open={false} onClose={() => {}} title="Hi">
        body
      </SideSheet>,
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });

  it("calls onClose when scrim is clicked", async () => {
    const close = vi.fn();
    render(
      <SideSheet open onClose={close} title="Hi">
        body
      </SideSheet>,
    );
    await userEvent.click(screen.getByTestId("wpds-sidesheet-scrim"));
    expect(close).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const close = vi.fn();
    render(
      <SideSheet open onClose={close} title="Hi">
        body
      </SideSheet>,
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("renders footer when provided", () => {
    render(
      <SideSheet open onClose={() => {}} title="Hi" footer={<span>foot</span>}>
        body
      </SideSheet>,
    );
    expect(screen.getByText("foot")).toBeInTheDocument();
  });

  it("calls onClose when × button is clicked", async () => {
    const close = vi.fn();
    render(
      <SideSheet open onClose={close} title="Hi">
        body
      </SideSheet>,
    );
    await userEvent.click(screen.getByLabelText("Close"));
    expect(close).toHaveBeenCalledOnce();
  });
});
