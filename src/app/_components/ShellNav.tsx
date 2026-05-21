"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Today" },
  { href: "/reader", label: "Reader" },
  { href: "/drafts", label: "Drafts" },
  { href: "/sources", label: "Sources" },
  { href: "/voice", label: "Voice & Publishing" },
];

export function ShellNav({
  showWorkflowAutopublish = false,
}: {
  showWorkflowAutopublish?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const items = showWorkflowAutopublish
    ? [
        ...ITEMS,
        {
          href: "/settings?section=workflow-autopublish",
          label: "Autopublish",
          section: "workflow-autopublish",
        },
      ]
    : ITEMS;
  return (
    <nav className="fp-tabs">
      {items.map((it) => {
        const active =
          "section" in it
            ? pathname === "/settings" && searchParams.get("section") === it.section
            : it.href === "/"
              ? pathname === "/"
              : pathname.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} className={`fp-tab ${active ? "on" : ""}`}>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
