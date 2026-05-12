import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountMenu, gravatarUrl } from "../AccountMenu";

describe("gravatarUrl", () => {
  it("normalizes the email before hashing", () => {
    expect(gravatarUrl("  MyEmailAddress@example.com  ")).toContain(
      "0bc83cb571cd1c50ba6f3e8a78ef1346",
    );
  });
});

describe("AccountMenu", () => {
  it("renders a Gravatar trigger and logout form", () => {
    render(<AccountMenu email="lucas@example.com" />);

    const trigger = screen.getByLabelText("Account menu");
    expect(trigger.querySelector(".fp-account-avatar")?.getAttribute("style")).toContain(
      "gravatar.com/avatar/",
    );
    expect(screen.getByText("lucas@example.com")).toBeInTheDocument();

    const logout = screen.getByRole("button", { name: "Log out" });
    expect(logout.closest("form")?.getAttribute("action")).toBe("/logout");
    expect(logout.closest("form")?.getAttribute("method")).toBe("post");
  });

  it("renders an admin link when requested", () => {
    render(<AccountMenu email="lucas@example.com" showAdmin />);
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/settings/admin");
  });
});
