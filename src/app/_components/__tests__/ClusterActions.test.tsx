import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClusterActions } from "../ClusterActions";
import { generateDraftAction } from "@/lib/v1/actions";

vi.mock("@/lib/v1/actions", () => ({
  generateDraftAction: vi.fn().mockResolvedValue(undefined),
  getDraftWizardPrefsAction: vi.fn().mockResolvedValue({ format: "standard", length: 600 }),
}));

vi.mock("../DraftWizardSheet", () => ({
  DraftWizardSheet: ({
    clusterId,
    outletDisplayName,
  }: {
    clusterId: string;
    outletDisplayName: string;
  }) => (
    <div data-testid="draft-wizard">
      {clusterId} for {outletDisplayName}
    </div>
  ),
}));

const outlets = [{ id: "outlet-1", displayName: "My Blog" }];

describe("ClusterActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Draft this and Take notes without a mode toggle", () => {
    render(
      <ClusterActions
        clusterId="cluster-1"
        clusterTitle="Cluster headline"
        outlets={outlets}
        defaultOutletId="outlet-1"
        draftsByOutlet={{}}
      />,
    );

    expect(screen.getByRole("button", { name: "Draft this →" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take notes →" })).toBeInTheDocument();
    expect(screen.queryByText("Mode")).not.toBeInTheDocument();
  });

  it("opens the draft wizard from the primary action", () => {
    render(
      <ClusterActions
        clusterId="cluster-1"
        clusterTitle="Cluster headline"
        outlets={outlets}
        defaultOutletId="outlet-1"
        draftsByOutlet={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Draft this →" }));

    expect(screen.getByTestId("draft-wizard")).toHaveTextContent("cluster-1 for My Blog");
  });

  it("runs notes directly from the secondary action", async () => {
    render(
      <ClusterActions
        clusterId="cluster-1"
        clusterTitle="Cluster headline"
        outlets={outlets}
        defaultOutletId="outlet-1"
        draftsByOutlet={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Take notes →" }));

    await waitFor(() => expect(generateDraftAction).toHaveBeenCalled());
    const formData = vi.mocked(generateDraftAction).mock.calls[0]![0] as FormData;
    expect(formData.get("clusterId")).toBe("cluster-1");
    expect(formData.get("outletId")).toBe("outlet-1");
    expect(formData.get("mode")).toBe("researcher");
  });

  it("opens existing draft and notebook artifacts", () => {
    render(
      <ClusterActions
        clusterId="cluster-1"
        clusterTitle="Cluster headline"
        outlets={outlets}
        defaultOutletId="outlet-1"
        draftsByOutlet={{
          "outlet-1": {
            drafter: { id: "draft-1", voiceMatch: 0.82, wpEditLink: null },
            researcher: { id: "notes-1", voiceMatch: 0, wpEditLink: null },
          },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Open draft →" })).toHaveAttribute(
      "href",
      "/editor/draft-1",
    );
    expect(screen.getByRole("link", { name: "Open notebook →" })).toHaveAttribute(
      "href",
      "/editor/notes-1",
    );
    expect(screen.getByText("voice-match")).toBeInTheDocument();
  });
});
