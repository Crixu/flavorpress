import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MasterDetail } from "../MasterDetail";

describe("MasterDetail", () => {
  it("renders sidebar and detail", () => {
    render(
      <MasterDetail sidebar={<nav>side</nav>}>
        <main>main</main>
      </MasterDetail>,
    );
    expect(screen.getByText("side")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("applies default sidebar width", () => {
    render(
      <MasterDetail sidebar={<nav>s</nav>}>
        <main>m</main>
      </MasterDetail>,
    );
    const aside = screen.getByText("s").closest("aside");
    expect(aside?.style.width).toBe("220px");
  });

  it("respects sidebarWidth prop", () => {
    render(
      <MasterDetail sidebar={<nav>s</nav>} sidebarWidth={300}>
        <main>m</main>
      </MasterDetail>,
    );
    const aside = screen.getByText("s").closest("aside");
    expect(aside?.style.width).toBe("300px");
  });
});
