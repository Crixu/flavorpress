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

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ShellNav({
  showWorkflowAutopublish = false,
}: {
  showWorkflowAutopublish?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const items = showWorkflowAutopublish
    ? [
        ...ITEMS,
        {
          href: "/workflows",
          label: "Workflows",
        },
      ]
    : ITEMS;
  const activeItem = items.find((it) => isActivePath(pathname, it.href));

  return (
    <nav className="fp-shell-nav" aria-label="Primary">
      <div className="fp-tabs">
        {items.map((it) => {
          const active = isActivePath(pathname, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`fp-tab ${active ? "on" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {it.label}
            </Link>
          );
        })}
      </div>
      <details key={pathname} className="fp-mobile-menu">
        <summary className="fp-mobile-menu-trigger">
          <span className="fp-mobile-menu-label">Menu</span>
          <span className="fp-mobile-menu-current">{activeItem?.label ?? "Navigation"}</span>
          <span className="fp-mobile-menu-chevron" aria-hidden="true" />
        </summary>
        <div className="fp-mobile-menu-panel">
          {items.map((it) => {
            const active = isActivePath(pathname, it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`fp-mobile-menu-item ${active ? "on" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      </details>
    </nav>
  );
}
