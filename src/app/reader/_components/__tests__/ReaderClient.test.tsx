import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock Next.js navigation so Link and router calls don't explode in jsdom
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reader",
}));

// Mock Next.js Link to render a plain anchor in tests
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

// Mock server actions - they are never called in the filter / hints tests
vi.mock("../../actions", () => ({
  markItemAction: vi.fn().mockResolvedValue({ ok: true, markedCount: 0, thresholdReached: false }),
  dismissItemAction: vi
    .fn()
    .mockResolvedValue({ ok: true, markedCount: 0, thresholdReached: false }),
  unmarkItemAction: vi
    .fn()
    .mockResolvedValue({ ok: true, markedCount: 0, thresholdReached: false }),
  clusterMarkedAction: vi.fn().mockResolvedValue({ ok: true, formed: [] }),
}));

// Stub localStorage to always return "1" so we skip the practice deck
beforeEach(() => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
    if (key === "flavorpress.reader.onboarded.v1") return "1";
    return null;
  });
});

import { ReaderClient } from "../ReaderClient";
import type { ReaderItem } from "../SwipeDeck";

const folders = [{ id: "coffee", name: "Coffee", queueCount: 9 }];

const sampleItem: ReaderItem = {
  id: "i1",
  title: "Test article title",
  lede: "A summary of the article.",
  publishedAt: Date.now() - 60_000,
  canonicalUrl: "https://example.com/article",
  sourceId: "s1",
  sourceName: "Espresso Letter",
  sourceKind: "rss",
  folderId: "coffee",
  folderName: "Coffee",
  score: null,
  commentCount: null,
  alsoCoveredBy: [],
};

describe("ReaderClient - folder filter", () => {
  it("renders Filter button when folders are present", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={9}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    expect(screen.getByRole("button", { name: /Filter/i })).toBeInTheDocument();
  });

  it("shows folder list in popover when Filter button is clicked", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={9}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Filter/i }));
    expect(screen.getByText("Coffee")).toBeInTheDocument();
    expect(screen.getByText("All folders")).toBeInTheDocument();
  });

  it("closes the popover when clicking a folder link", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={9}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Filter/i }));
    // Coffee link visible
    const coffeeLink = screen.getByText("Coffee").closest("a")!;
    fireEvent.click(coffeeLink);
    // Popover should be gone
    expect(screen.queryByText("All folders")).not.toBeInTheDocument();
  });

  it("does not render Filter button when no folders exist", () => {
    render(
      <ReaderClient
        folders={[]}
        totalCount={0}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    expect(screen.queryByRole("button", { name: /Filter/i })).not.toBeInTheDocument();
  });

  it("shows active folder name in button label", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={9}
        activeFolder="coffee"
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    expect(screen.getByRole("button", { name: /Coffee/i })).toBeInTheDocument();
  });
});

describe("ReaderClient - keyboard hints", () => {
  it("renders skip keyboard hint", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={1}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    expect(screen.getByText(/skip/i)).toBeInTheDocument();
  });

  it("renders save keyboard hint", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={1}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    expect(screen.getByText(/save/i)).toBeInTheDocument();
  });

  it("renders space/open keyboard hint", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={1}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    // The aria-label on the hints paragraph uniquely identifies it
    expect(screen.getByLabelText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByLabelText("Keyboard shortcuts").textContent).toContain("open");
  });

  it("wraps shortcut keys in kbd elements", () => {
    const { container } = render(
      <ReaderClient
        folders={folders}
        totalCount={1}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    const kbdElements = container.querySelectorAll("kbd");
    expect(kbdElements.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ReaderClient - counter strip", () => {
  it("shows counter with total count", () => {
    render(
      <ReaderClient
        folders={folders}
        totalCount={42}
        activeFolder={null}
        initialItems={[sampleItem]}
        initialMarkedCount={0}
      />,
    );
    expect(screen.getByText(/of 42/i)).toBeInTheDocument();
  });
});
