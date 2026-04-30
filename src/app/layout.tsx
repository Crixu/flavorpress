import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Inter, Newsreader } from "next/font/google";
import { HelpFlyout, HelpIndexButton } from "@/components/Help";
import { ShellNav } from "./_components/ShellNav";
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
        <header className="fp-pill-nav">
          <div className="fp-pill-nav-inner">
            <Link href="/" className="group flex items-center gap-3">
              <BrandMark />
              <span className="text-[15px] font-semibold tracking-tight">
                FlavorPress
              </span>
              <span
                className="ml-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]"
                style={{ background: "var(--bg-subtle)", color: "var(--fg-muted)" }}
              >
                v1 alpha
              </span>
            </Link>
            <ShellNav />
            <div className="flex items-center gap-2">
              <Suspense fallback={null}>
                <HelpIndexButton />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1280px] px-6 pt-8 pb-16">{children}</main>
        <Suspense fallback={null}>
          <HelpFlyout />
        </Suspense>
      </body>
    </html>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 items-center justify-center rounded-full transition group-hover:scale-105"
      style={{
        background: "linear-gradient(135deg, #FF8B60 0%, #F5B26A 100%)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <span style={{ color: "#FFFFFF", fontSize: 13, fontWeight: 700 }}>F</span>
    </span>
  );
}
