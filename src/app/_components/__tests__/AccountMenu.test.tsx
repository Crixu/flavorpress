import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, gravatarUrl } from "../AccountMenu";
import { AccountMenuClient } from "../AccountMenuClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gravatarUrl", () => {
  it("normalizes the email before hashing", () => {
    expect(gravatarUrl("  MyEmailAddress@example.com  ")).toContain(
      "84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee",
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

describe("AccountMenuClient", () => {
  it("renders the account Gravatar returned by the session API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          email: "lucas@example.com",
          avatarUrl: "https://www.gravatar.com/avatar/lucas?s=80&d=404&r=g",
          showAdmin: false,
        }),
      })),
    );

    const { container } = render(<AccountMenuClient />);

    await screen.findByText("lucas@example.com");
    const avatar = container.querySelector(".fp-account-avatar-img");
    expect(avatar).toHaveAttribute("src", "https://www.gravatar.com/avatar/lucas?s=80&d=404&r=g");
    expect(screen.getByText("lucas@example.com")).toBeInTheDocument();
  });

  it("falls back to an initial when the Gravatar image fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          email: "lucas@example.com",
          avatarUrl: "https://www.gravatar.com/avatar/lucas?s=80&d=404&r=g",
          showAdmin: false,
        }),
      })),
    );

    const { container } = render(<AccountMenuClient />);

    await screen.findByText("lucas@example.com");
    const avatar = container.querySelector(".fp-account-avatar-img");
    expect(avatar).not.toBeNull();
    fireEvent.error(avatar!);
    await waitFor(() => {
      expect(screen.getByText("L")).toBeInTheDocument();
    });
  });
});
