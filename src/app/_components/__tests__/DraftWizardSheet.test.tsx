import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/v1/actions", () => ({
  generateDraftAction: vi.fn(),
  generateDraftAnglesAction: vi.fn().mockResolvedValue({
    angles: [
      { kind: "archive", label: "Archive contrast", title: "T1", rationale: "R1" },
      { kind: "gap", label: "Gap in coverage", title: "T2", rationale: "R2" },
      { kind: "fresh", label: "Reader on-ramp", title: "T3", rationale: "R3" },
    ],
  }),
}));

import { DraftWizardSheet } from "../DraftWizardSheet";
import { AI_THINKING_LINES, thinkingLineDurationMs } from "../AiThinkingLines";
import { defaultDraftFormatOptions } from "@/lib/v1/draft-format";
import { generateDraftAnglesAction } from "@/lib/v1/actions";

const baseProps = {
  clusterId: "c1",
  outletId: "o1",
  outletDisplayName: "lucas.media",
  formats: defaultDraftFormatOptions(),
  clusterTitle: "Test cluster",
  prefs: { format: "narrative", length: 1000 as const },
  onClose: vi.fn(),
};

describe("DraftWizardSheet", () => {
  it("keeps thirty distinct AI thinking lines available", () => {
    expect(AI_THINKING_LINES).toHaveLength(30);
    expect(new Set(AI_THINKING_LINES).size).toBe(30);
  });

  it("keeps longer thinking lines visible longer with a cap", () => {
    const shortDuration = thinkingLineDurationMs("Short.");
    const longDuration = thinkingLineDurationMs(
      "This is a longer thinking line that needs more reading time.",
    );
    const cappedDuration = thinkingLineDurationMs("x".repeat(200));

    expect(longDuration).toBeGreaterThan(shortDuration);
    expect(shortDuration).toBe(2200);
    expect(cappedDuration).toBe(4200);
  });

  it("starts on step 1 with Format step", () => {
    render(<DraftWizardSheet {...baseProps} />);
    expect(screen.getByText(/Step 1 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText("Pick the format")).toBeInTheDocument();
  });

  it("advances to step 2 (Length) on Next click", async () => {
    render(<DraftWizardSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Step 2 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText("Pick the length")).toBeInTheDocument();
  });

  it("shows Just go on every step", async () => {
    render(<DraftWizardSheet {...baseProps} />);
    expect(screen.getByText("Just go")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Just go")).toBeInTheDocument();
  });

  it("shows Back button after step 1", async () => {
    render(<DraftWizardSheet {...baseProps} />);
    expect(screen.queryByText(/Back/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Back/)).toBeInTheDocument();
  });

  it("shows Back button on step 3", async () => {
    render(<DraftWizardSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Step 3 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/Back/)).toBeInTheDocument();
  });

  it("shows thinking copy while angles are loading", async () => {
    vi.mocked(generateDraftAnglesAction).mockReturnValueOnce(new Promise(() => undefined));

    render(<DraftWizardSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(screen.getByRole("status")).toHaveTextContent(AI_THINKING_LINES[0]!);
  });

  it("goes back from step 2 to step 1", async () => {
    render(<DraftWizardSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText(/Step 1 \/ 3/)).toBeInTheDocument();
  });

  it("renders title with cluster name", () => {
    render(<DraftWizardSheet {...baseProps} />);
    expect(screen.getByText(/Draft "Test cluster"/)).toBeInTheDocument();
  });

  it("shows format pills on step 1", () => {
    render(<DraftWizardSheet {...baseProps} />);
    expect(screen.getByRole("button", { name: "Narrative essay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listicle" })).toBeInTheDocument();
  });

  it("shows length pills on step 2", async () => {
    render(<DraftWizardSheet {...baseProps} />);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("button", { name: "500" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1000" })).toBeInTheDocument();
  });

  it("does not render No Back button on step 1", () => {
    render(<DraftWizardSheet {...baseProps} />);
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
  });
});
