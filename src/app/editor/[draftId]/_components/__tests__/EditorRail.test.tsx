import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorRail } from "../EditorRail";

const sources = [
  { id: "s1", title: "Article 1", source: "Espresso Letter", link: "https://example.com/1" },
];

describe("EditorRail", () => {
  it("starts on Sources tab", () => {
    render(<EditorRail sources={sources} extensions={<div>EXT</div>} remix={<div>REMIX</div>} />);
    expect(screen.getByText("Article 1")).toBeInTheDocument();
    expect(screen.queryByText("EXT")).not.toBeInTheDocument();
  });

  it("switches to Extensions tab on click", () => {
    render(<EditorRail sources={sources} extensions={<div>EXT</div>} remix={<div>REMIX</div>} />);
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    expect(screen.getByText("EXT")).toBeInTheDocument();
  });

  it("switches to Remix tab on click", () => {
    render(<EditorRail sources={sources} extensions={<div>EXT</div>} remix={<div>REMIX</div>} />);
    fireEvent.click(screen.getByRole("button", { name: /Remix/ }));
    expect(screen.getByText("REMIX")).toBeInTheDocument();
  });

  it("shows source count in tab", () => {
    render(
      <EditorRail
        sources={[sources[0]!, { ...sources[0]!, id: "s2" }]}
        extensions={<div>EXT</div>}
        remix={<div>REMIX</div>}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
