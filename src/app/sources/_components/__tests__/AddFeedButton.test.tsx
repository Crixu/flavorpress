import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddFeedButton } from "../AddFeedButton";

vi.mock("../AddFeedSheet", () => ({
  AddFeedSheet: () => null,
}));

describe("AddFeedButton", () => {
  it("disables adding feeds at the source cap", () => {
    render(<AddFeedButton folders={[]} currentFolderId={null} sourceCount={10} sourceLimit={10} />);

    expect(screen.getByRole("button", { name: "+ Add feed" })).toBeDisabled();
    expect(screen.getByText(/This plan allows 10 sources/)).toBeInTheDocument();
  });
});
