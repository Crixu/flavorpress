import { NextResponse } from "next/server";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { getTodayCachedViewState } from "@/lib/v1/today-view";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const state = await getTodayCachedViewState(session.userId);
    return NextResponse.json({
      status: state.status,
      computedAt: state.computedAt,
      refreshStartedAt: state.refreshStartedAt,
      error: state.error,
      hasPayload: Boolean(state.payload),
    });
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw err;
  }
}
