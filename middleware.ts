import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  isAllowedMutationOrigin,
  isMutationMethod,
  safeRedirectPath,
  verifySessionCookie,
} from "@/lib/auth";

const PUBLIC_PATHS = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
]);

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (isMutationMethod(req.method) && !isAllowedMutationOrigin(req.headers, req.nextUrl.origin)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const session = await verifySessionCookie(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const next = safeRedirectPath(`${pathname}${req.nextUrl.search}`);
  if (next !== "/") loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/api/cron/poll") return true;
  if (pathname === "/api/wp/callback") return true;
  if (pathname === "/api/mcp") return true;
  if (pathname.startsWith("/_next/")) return true;
  if (PUBLIC_PATHS.has(pathname)) return true;
  return /\.[^/]+$/.test(pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
