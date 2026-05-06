import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Inter, Newsreader } from "next/font/google";
import { HelpFlyout, HelpIndexButton } from "@/components/Help";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body>
        <ToastProvider>
          <header className="fp-topbar">
            <Link href="/" className="fp-brand">
              <span className="fp-brand-name">FlavorPress</span>
              <span className="fp-version-badge">v1 alpha</span>
            </Link>
            <div className="fp-topbar-right">
              <Link href="/settings" className="fp-topbar-link">
                Settings
              </Link>
              <Suspense fallback={null}>
                <HelpIndexButton />
              </Suspense>
            </div>
          </header>
          <ShellNav />
          <main className="fp-main">{children}</main>
          <Suspense fallback={null}>
            <HelpFlyout />
          </Suspense>
          <AgentationDev />
          <PublishToastBridge />
        </ToastProvider>
      </body>
    </html>
  );
}
