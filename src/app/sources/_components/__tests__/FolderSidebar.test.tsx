import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  createFolderAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  pollFolderAction: vi.fn(),
  renameFolderAction: vi.fn(),
}));

vi.mock("../../_components/SubmitButton", () => ({
  SubmitButton: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <button className={className}>{children}</button>,
}));

vi.mock("../../_components/useBackgroundPolling", () => ({
  useBackgroundPolling: () => ({ active: false, start: vi.fn() }),
}));

const folders = [{ id: "coffee", name: "Coffee" }];

describe("FolderSidebar", () => {
  it("renders All and Ungrouped links", () => {
    render(
      <FolderSidebar
        folders={folders}
        allCount={28}
        ungroupedCount={3}
        folderCounts={{ coffee: 9 }}
        currentFolder={null}
        outletParam={null}
      />,
    );
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
  });

  it("renders named folders", () => {
    render(
      <FolderSidebar
        folders={folders}
        allCount={28}
        ungroupedCount={3}
        folderCounts={{ coffee: 9 }}
        currentFolder={null}
        outletParam={null}
      />,
    );
    expect(screen.getByText("Coffee")).toBeInTheDocument();
  });

  it("marks All as active when currentFolder is null", () => {
    render(
      <FolderSidebar
        folders={folders}
        allCount={28}
        ungroupedCount={3}
        folderCounts={{ coffee: 9 }}
        currentFolder={null}
        outletParam={null}
      />,
    );
    const allLink = screen.getByText("All").closest("a");
    expect(allLink?.className).toMatch(/\bon\b/);
  });

  it("marks active folder with on class", () => {
    render(
      <FolderSidebar
        folders={folders}
        allCount={28}
        ungroupedCount={3}
        folderCounts={{ coffee: 9 }}
        currentFolder="coffee"
        outletParam={null}
      />,
    );
    const coffeeLink = screen.getByText("Coffee").closest("a");
    expect(coffeeLink?.className).toMatch(/\bon\b/);
  });

  it("marks Ungrouped as active when currentFolder is ungrouped", () => {
    render(
      <FolderSidebar
        folders={folders}
        allCount={28}
        ungroupedCount={3}
        folderCounts={{ coffee: 9 }}
        currentFolder="ungrouped"
        outletParam={null}
      />,
    );
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
    render(
      <FolderSidebar
        folders={folders}
        allCount={28}
        ungroupedCount={3}
        folderCounts={{ coffee: 9 }}
        currentFolder="coffee"
        outletParam={null}
      />,
    );
    const allLink = screen.getByText("All").closest("a");
    expect(allLink?.className).not.toMatch(/\bon\b/);
  });
});
