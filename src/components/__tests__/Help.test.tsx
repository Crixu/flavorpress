import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpTrigger } from "../Help";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/voice",
  useSearchParams: () => new URLSearchParams(""),
}));

describe("<HelpTrigger />", () => {
  it("renders an accessible help button using the glossary term", () => {
    render(<HelpTrigger id="trust" />);
    const button = screen.getByRole("button", { name: /Help: Source trust/i });
    expect(button).toBeInTheDocument();
  });

  it("renders the wrapped children alongside the help icon", () => {
    render(<HelpTrigger id="trust">Trust score</HelpTrigger>);
    expect(screen.getByText("Trust score")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Help: Source trust/i })).toBeInTheDocument();
  });

  it("pushes ?help=<id> onto the URL when clicked", async () => {
    replace.mockClear();
    render(<HelpTrigger id="ranker" />);
    await userEvent.click(screen.getByRole("button", { name: /Help: Personal ranker/i }));
    expect(replace).toHaveBeenCalledWith("/voice?help=ranker", { scroll: false });
  });

  it("falls back to the raw id when the glossary entry is unknown", () => {
    render(<HelpTrigger id="not-a-real-term" />);
    expect(screen.getByRole("button", { name: /Help: not-a-real-term/i })).toBeInTheDocument();
  });
});
