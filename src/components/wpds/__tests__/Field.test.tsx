import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "../Field";

describe("Field", () => {
  it("renders label", () => {
    render(<Field label="Site URL"><input /></Field>);
    expect(screen.getByText("Site URL")).toBeInTheDocument();
  });

  it("renders child input", () => {
    render(<Field label="x"><input placeholder="ph" /></Field>);
    expect(screen.getByPlaceholderText("ph")).toBeInTheDocument();
  });

  it("renders hint when provided", () => {
    render(<Field label="x" hint="some hint"><input /></Field>);
    expect(screen.getByText("some hint")).toBeInTheDocument();
  });

  it("omits hint when not provided", () => {
    const { container } = render(<Field label="x"><input /></Field>);
    expect(container.querySelector(".wpds-field-hint")).toBeNull();
  });
});
