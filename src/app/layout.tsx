import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Inter, Newsreader } from "next/font/google";
import { HelpFlyout, HelpIndexButton } from "@/components/Help";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FlavorPress",
  description: "Your reading turns into your writing.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body>
        <header className="fp-nav">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 text-sm">
            <Link href="/" className="flex items-center gap-2 group">
              <BrandMark />
              <span className="font-semibold tracking-tight">FlavorPress</span>
              <span className="fp-chip" style={{ fontSize: 10, padding: "1px 6px" }}>v1 alpha</span>
            </Link>
            <div className="flex items-center gap-1">
              <NavLink href="/">Today</NavLink>
              <NavLink href="/sources">Sources</NavLink>
              <NavLink href="/voice">Voice & Publishing</NavLink>
              <Suspense fallback={null}>
                <HelpIndexButton />
              </Suspense>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        <Suspense fallback={null}>
          <HelpFlyout />
        </Suspense>
      </body>
    </html>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-[13px] font-medium transition hover:bg-[var(--bg-subtle)]"
      style={{ color: "var(--fg-muted)" }}
    >
      {children}
    </Link>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 items-center justify-center rounded-md transition group-hover:scale-105"
      style={{
        background:
          "linear-gradient(135deg, var(--indigo) 0%, var(--rose) 120%)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    </span>
  );
}
