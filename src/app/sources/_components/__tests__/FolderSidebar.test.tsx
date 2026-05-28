import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFolderResultAction } from "@/lib/v1/actions";
import { FolderSidebar } from "../FolderSidebar";

// Mock Next.js navigation so useRouter doesn't throw outside app router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/sources",
}));

// Mock Next.js Link and the server actions used inside FolderSidebar.
vi.mock("next/link", () => ({
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/v1/actions", () => ({
  createFolderResultAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  pollFolderAction: vi.fn(),
  renameFolderAction: vi.fn(),
}));

vi.mock("../../_components/SubmitButton", () => ({
  SubmitButton: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <button className={className}>{children}</button>
  ),
}));

vi.mock("../../_components/useBackgroundPolling", () => ({
  useBackgroundPolling: () => ({ active: false, start: vi.fn() }),
}));

const folders = [{ id: "coffee", name: "Coffee" }];

const defaultProps: React.ComponentProps<typeof FolderSidebar> = {
  folders,
  allCount: 28,
  ungroupedCount: 3,
  folderCounts: { coffee: 9 },
  currentFolder: null,
  outletParam: null,
  folderLimit: 5,
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof FolderSidebar>> = {}) {
  return render(<FolderSidebar {...defaultProps} {...overrides} />);
}

describe("FolderSidebar", () => {
  it("renders All and Ungrouped links", () => {
    renderSidebar();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
  });

  it("renders named folders", () => {
    renderSidebar();
    expect(screen.getByText("Coffee")).toBeInTheDocument();
  });

  it("marks All as active when currentFolder is null", () => {
    renderSidebar();
    const allLink = screen.getByText("All").closest("a");
    expect(allLink?.className).toMatch(/\bon\b/);
  });

  it("marks active folder with on class", () => {
    renderSidebar({ currentFolder: "coffee" });
    const coffeeLink = screen.getByText("Coffee").closest("a");
    expect(coffeeLink?.className).toMatch(/\bon\b/);
  });

  it("marks Ungrouped as active when currentFolder is ungrouped", () => {
    renderSidebar({ currentFolder: "ungrouped" });
    // "Ungrouped" appears in both the nav link and the manage panel.
    // Narrow to the <a> anchor using role.
    const ungroupedLinks = screen
      .getAllByText("Ungrouped")
      .map((el) => el.closest("a"))
      .filter(Boolean);
    expect(ungroupedLinks.length).toBeGreaterThan(0);
    expect(ungroupedLinks[0]?.className).toMatch(/\bon\b/);
  });

  it("does not mark All as active when a folder is selected", () => {
    renderSidebar({ currentFolder: "coffee" });
    const allLink = screen.getByText("All").closest("a");
    expect(allLink?.className).not.toMatch(/\bon\b/);
  });

  it("shows the folder cap before opening the create form", () => {
    renderSidebar({ folderLimit: 1 });
    expect(screen.queryByRole("button", { name: "+ New folder" })).not.toBeInTheDocument();
    expect(screen.getByText(/This plan allows 1 folder/)).toBeInTheDocument();
  });

  it("keeps the create form open and shows action errors", async () => {
    const user = userEvent.setup();
    vi.mocked(createFolderResultAction).mockResolvedValueOnce({
      ok: false,
      error: "This plan allows 1 folder. Remove a folder or ask an admin to raise the cap.",
      code: "plan_limit",
      limit: 1,
    });

    renderSidebar();
    await user.click(screen.getByRole("button", { name: "+ New folder" }));
    await user.type(screen.getByLabelText("New folder name"), "Travel");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/This plan allows 1 folder/);
    expect(screen.getByLabelText("New folder name")).toBeInTheDocument();
  });
});
