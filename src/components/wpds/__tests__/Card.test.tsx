import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Card } from "../Card";

describe("Card", () => {
  it("renders children inside a wpds-card div", () => {
    const { container } = render(<Card>content</Card>);
    const card = container.querySelector("div");
    expect(card?.className).toMatch(/wpds-card/);
  });

  it("applies emphasis variant when prop set", () => {
    const { container } = render(<Card emphasis>x</Card>);
    const card = container.querySelector("div");
    expect(card?.className).toMatch(/wpds-card-emphasis/);
  });

  it("forwards extra className", () => {
    const { container } = render(<Card className="extra">y</Card>);
    const card = container.querySelector("div");
    expect(card?.className).toMatch(/extra/);
  });
});
