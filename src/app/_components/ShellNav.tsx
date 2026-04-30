"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/drafts", label: "Drafts" },
  { href: "/sources", label: "Sources" },
  { href: "/voice", label: "Voice & Publishing" },
  { href: "/settings", label: "Settings" },
];

export function ShellNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="order-3 flex w-full items-center justify-center gap-1 md:order-none md:w-auto">
      {ITEMS.map((it) => {
        const active =
          it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className="rounded-full px-4 py-1.5 text-[13px] transition"
            style={{
              background: active ? "var(--fg)" : "transparent",
              color: active ? "var(--surface)" : "var(--fg-muted)",
              fontWeight: active ? 500 : 400,
            }}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
