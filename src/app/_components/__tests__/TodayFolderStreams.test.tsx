import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TodayFolderStreams } from "../TodayFolderStreams";
import type { TodayFolderStream, TodayClusterPreview } from "../TodayFolderStreams";

// Mock next/navigation (useRouter used inside ClusterCard)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Mock server actions used in FolderSectionHeader and ClusterCard
vi.mock("@/lib/v1/actions", () => ({
  dismissClusterAction: vi.fn().mockResolvedValue(undefined),
  pollFolderAction: vi.fn().mockResolvedValue({ sourceCount: 0, startedAt: Date.now() }),
  getFolderPollProgressAction: vi.fn().mockResolvedValue({ total: 0, completed: 0 }),
}));

// Mock ClusterActions so tests don't need to wire up the full draft chain
vi.mock("../ClusterActions", () => ({
  ClusterActions: ({ clusterId }: { clusterId: string }) => (
    <div data-testid={`cluster-actions-${clusterId}`} />
  ),
}));

// Mock Toast and useBackgroundPolling
vi.mock("../Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock("../useBackgroundPolling", () => ({
  useBackgroundPolling: () => ({ start: vi.fn(), stop: vi.fn(), polling: false }),
}));

// Minimal cluster preview factory
function makeCluster(overrides: {
  id: string;
  sourceCount: number;
  folderId?: string;
  folderName?: string;
  title?: string;
}): TodayClusterPreview {
  const folderId = overrides.folderId ?? "folder-1";
  const folderName = overrides.folderName ?? "Coffee";
  return {
    cluster: {
      id: overrides.id,
      formedAt: Date.now() - 3600_000,
      firedAt: Date.now() - 1800_000,
      latestPublishedAt: Date.now() - 1800_000,
      sourceCount: overrides.sourceCount,
      signals: {
        archiveOverlap: 0.5,
        beatMatch: 0.7,
        sourceTrust: 0.8,
        composite: 0.65,
      },
    },
    folder: { id: folderId, name: folderName },
    items: [
      {
        title: overrides.title ?? `Cluster ${overrides.id} headline`,
        sourceId: "src-1",
        sourceUrl: "https://example.com",
        displayName: "Example",
      },
    ],
    draftsByOutlet: {},
    preferredOutletId: null,
  };
}

function makeStream(overrides: {
  id: string;
  name: string;
  clusters: TodayClusterPreview[];
}): TodayFolderStream {
  return {
    id: overrides.id,
    folderId: overrides.id,
    name: overrides.name,
    clusters: overrides.clusters,
  };
}

const outlets = [{ id: "outlet-1", displayName: "My Blog" }];
const renderedAt = 1_700_000_000_000;
const todayTutorialDoneKey = "flavorpress.today.onboarded.v1";

describe("TodayFolderStreams", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("expands the first folder by default and leaves others collapsed", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [makeCluster({ id: "c1", sourceCount: 3 })],
      }),
      makeStream({
        id: "tech",
        name: "Tech",
        clusters: [makeCluster({ id: "c2", sourceCount: 2, folderId: "tech", folderName: "Tech" })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    // First folder header should have aria-expanded=true
    const headers = screen.getAllByRole("button", { name: /coffee|tech/i });
    const coffeeHeader = headers.find((h) => h.textContent?.includes("Coffee"));
    expect(coffeeHeader).toBeTruthy();
    expect(coffeeHeader?.getAttribute("aria-expanded")).toBe("true");

    // The first cluster's headline should be visible (folder is expanded)
    expect(screen.getByText("Cluster c1 headline")).toBeInTheDocument();

    // The second folder's cluster headline should NOT be visible (collapsed)
    expect(screen.queryByText("Cluster c2 headline")).not.toBeInTheDocument();
  });

  it("toggles a folder open on header click and closes it on a second click", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [makeCluster({ id: "c1", sourceCount: 3 })],
      }),
      makeStream({
        id: "tech",
        name: "Tech",
        clusters: [makeCluster({ id: "c2", sourceCount: 2, folderId: "tech", folderName: "Tech" })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    // Tech folder starts collapsed; its cluster headline is not visible
    expect(screen.queryByText("Cluster c2 headline")).not.toBeInTheDocument();

    // Find and click the Tech folder header button
    const techHeader = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes("Tech"));
    expect(techHeader).toBeTruthy();
    fireEvent.click(techHeader!);

    // Now the Tech cluster headline should be visible
    expect(screen.getByText("Cluster c2 headline")).toBeInTheDocument();
    expect(techHeader?.getAttribute("aria-expanded")).toBe("true");

    // Click again to collapse
    fireEvent.click(techHeader!);
    expect(screen.queryByText("Cluster c2 headline")).not.toBeInTheDocument();
    expect(techHeader?.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands the first folder with content when earlier folders are empty", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [],
      }),
      makeStream({
        id: "tech",
        name: "Tech",
        clusters: [makeCluster({ id: "c2", sourceCount: 2, folderId: "tech", folderName: "Tech" })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    const coffeeHeader = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes("Coffee"));
    const techHeader = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes("Tech"));

    expect(coffeeHeader?.getAttribute("aria-expanded")).toBe("false");
    expect(techHeader?.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Cluster c2 headline")).toBeInTheDocument();
  });

  it("renders a single-source cluster card with the wpds-card-emphasis class", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [makeCluster({ id: "c-saved", sourceCount: 1, title: "Single source story" })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    // The card wrapping "Single source story" should carry the emphasis class
    const headline = screen.getByText("Single source story");
    // Walk up to find the wpds-card container
    let el: HTMLElement | null = headline;
    let emphasisCard: HTMLElement | null = null;
    while (el) {
      if (el.classList.contains("wpds-card-emphasis")) {
        emphasisCard = el;
        break;
      }
      el = el.parentElement;
    }
    expect(emphasisCard).not.toBeNull();
  });

  it("does not apply wpds-card-emphasis to a multi-source cluster card", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [makeCluster({ id: "c-multi", sourceCount: 3, title: "Multi source story" })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    const headline = screen.getByText("Multi source story");
    let el: HTMLElement | null = headline;
    let emphasisCard: HTMLElement | null = null;
    while (el) {
      if (el.classList.contains("wpds-card-emphasis")) {
        emphasisCard = el;
        break;
      }
      el = el.parentElement;
    }
    expect(emphasisCard).toBeNull();
  });

  it("shows the Today tutorial on first ready visit and finishes it", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [makeCluster({ id: "c1", sourceCount: 3 })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    expect(screen.getByTestId("today-tutorial-coach")).toBeInTheDocument();
    expect(screen.getByText("Today is sorted into reading lanes.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Judge the cluster before drafting.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Create a draft, not a post.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByTestId("today-tutorial-coach")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(todayTutorialDoneKey)).toBe("1");
  });

  it("does not show the Today tutorial after it has been completed", () => {
    window.localStorage.setItem(todayTutorialDoneKey, "1");
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [makeCluster({ id: "c1", sourceCount: 3 })],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    expect(screen.queryByTestId("today-tutorial-coach")).not.toBeInTheDocument();
  });

  it("does not show the Today tutorial when folders have no clusters", () => {
    const streams: TodayFolderStream[] = [
      makeStream({
        id: "coffee",
        name: "Coffee",
        clusters: [],
      }),
    ];

    render(
      <TodayFolderStreams
        streams={streams}
        outlets={outlets}
        defaultOutletId="outlet-1"
        renderedAt={renderedAt}
      />,
    );

    expect(screen.queryByTestId("today-tutorial-coach")).not.toBeInTheDocument();
    expect(screen.getByText("No fired clusters in Coffee yet.")).toBeInTheDocument();
  });
});
