"use client";

import { Agentation } from "agentation";

/**
 * Visual feedback overlay for AI coding agents. Gated behind a hidden
 * NEXT_PUBLIC_FLAVORPRESS_AGENTATION env var so it never renders on
 * Vercel or in the packaged macOS app by default.
 *
 * To enable locally, add `NEXT_PUBLIC_FLAVORPRESS_AGENTATION=1` to your
 * `.env` (or `.env.local`) and restart `next dev`. The flag is
 * intentionally NOT documented in `.env.example` to keep the overlay
 * out of casual installs.
 *
 * NEXT_PUBLIC_* is required because this is a client component; Next.js
 * inlines NEXT_PUBLIC_* values at build time.
 */
export function AgentationDev() {
  if (process.env.NEXT_PUBLIC_FLAVORPRESS_AGENTATION !== "1") return null;
  return <Agentation />;
}
