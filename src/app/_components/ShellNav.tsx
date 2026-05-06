"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/reader", label: "Reader" },
  { href: "/drafts", label: "Drafts" },
  { href: "/sources", label: "Sources" },
  { href: "/voice", label: "Voice & Publishing" },
];

export function ShellNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="fp-tabs">
      {ITEMS.map((it) => {
        const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`fp-tab ${active ? "on" : ""}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
