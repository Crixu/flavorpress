import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Inter, Newsreader } from "next/font/google";
import { HelpFlyout, HelpIndexButton } from "@/components/Help";
import { hasSessionCookieForShell } from "@/lib/session";
import { AccountMenuClient } from "./_components/AccountMenuClient";
import { AgentationDev } from "./_components/Agentation";
import { ShellNav } from "./_components/ShellNav";
import { PublishToastBridge, ToastProvider } from "./_components/Toast";
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Hide the topbar + shell nav on logged-out pages (login, signup, reset
  // flows, verify-email status). The auth surface should look like a clean
  // standalone form, not a chrome with broken links to gated routes.
  const isAuthed = await hasSessionCookieForShell();

  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body>
        <ToastProvider>
          {isAuthed ? (
            <>
              <header className="fp-topbar">
                <Link href="/" className="fp-brand">
                  <span className="fp-brand-name">FlavorPress</span>
                  <span className="fp-version-badge">V1 - Closed Beta</span>
                </Link>
                <div className="fp-topbar-right">
                  <Link href="/settings" className="fp-topbar-link">
                    Settings
                  </Link>
                  <Suspense fallback={null}>
                    <HelpIndexButton />
                  </Suspense>
                  <AccountMenuClient />
                </div>
              </header>
              <ShellNav />
            </>
          ) : null}
          <main className="fp-main">{children}</main>
          {isAuthed ? (
            <Suspense fallback={null}>
              <HelpFlyout />
            </Suspense>
          ) : null}
          <AgentationDev />
          <PublishToastBridge />
        </ToastProvider>
      </body>
    </html>
  );
}
