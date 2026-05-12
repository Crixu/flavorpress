import { NextResponse } from "next/server";
import { gravatarUrl } from "@/lib/gravatar";
import { AuthRequiredError, requireSession, shouldShowAdminControls } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({
      email: session.email,
      avatarUrl: gravatarUrl(session.email, 80, "404"),
      isAdmin: session.isAdmin,
      showAdmin: shouldShowAdminControls(session),
    });
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }
}
