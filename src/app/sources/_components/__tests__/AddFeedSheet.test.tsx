import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addSourceResultAction } from "@/lib/v1/actions";
import { AddFeedSheet } from "../AddFeedSheet";

vi.mock("@/lib/v1/actions", () => ({
  addSourceResultAction: vi.fn(),
}));

vi.mock("../OpmlImportButton", () => ({
  OpmlImportButton: ({ sourceRemaining }: { sourceRemaining: number }) => (
    <button type="button">Import OPML ({sourceRemaining} left)</button>
  ),
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  folders: [{ id: "coffee", name: "Coffee" }],
  currentFolderId: null,
  sourceCount: 9,
  sourceLimit: 10,
};

describe("AddFeedSheet", () => {
  it("shows remaining source slots", () => {
    render(<AddFeedSheet {...defaultProps} />);

    expect(screen.getByText("1 source left on this plan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import OPML (1 left)" })).toBeInTheDocument();
  });

  it("keeps the sheet open and shows source limit errors", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(addSourceResultAction).mockResolvedValueOnce({
      ok: false,
      error: "This plan allows 10 sources. Remove a source or ask an admin to raise the cap.",
      code: "plan_limit",
      limit: 10,
    });

    render(<AddFeedSheet {...defaultProps} onClose={onClose} />);
    await user.type(
      screen.getByPlaceholderText(/https:\/\/example.com\/feed/),
      "https://example.com/feed",
    );
    await user.click(screen.getByRole("button", { name: "Add feeds" }));

    expect(await screen.findByText(/This plan allows 10 sources/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
