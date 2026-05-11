"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  clusterMarkedItems,
  dismissItem,
  markItem,
  unmarkItem,
  countMarked,
  READER_CLUSTER_THRESHOLD,
  type FormedCluster,
} from "@/lib/v1/reader";

export interface SwipeResult {
  ok: true;
  markedCount: number;
  thresholdReached: boolean;
  formed?: FormedCluster[];
}

/**
 * Mark a story as great-to-follow-up. If the marked pile crosses the
 * threshold, we form clusters in the same call so the user gets the
 * payoff immediately. The client also still gets a manual "form
 * clusters now" button for the (b) escape hatch.
 */
export async function markItemAction(itemId: string): Promise<SwipeResult> {
  const session = await requireSession();
  await markItem(itemId, session.userId);
  const count = await countMarked(session.userId);
  let formed: FormedCluster[] | undefined;
  if (count >= READER_CLUSTER_THRESHOLD) {
    formed = await clusterMarkedItems(session.userId);
    revalidatePath("/");
    revalidatePath("/reader");
  }
  return {
    ok: true,
    markedCount: formed ? 0 : count,
    thresholdReached: count >= READER_CLUSTER_THRESHOLD && !formed,
    formed,
  };
}

export async function dismissItemAction(itemId: string): Promise<SwipeResult> {
  const session = await requireSession();
  await dismissItem(itemId, session.userId);
  const count = await countMarked(session.userId);
  return {
    ok: true,
    markedCount: count,
    thresholdReached: count >= READER_CLUSTER_THRESHOLD,
  };
}

export async function unmarkItemAction(itemId: string): Promise<SwipeResult> {
  const session = await requireSession();
  await unmarkItem(itemId, session.userId);
  const count = await countMarked(session.userId);
  return {
    ok: true,
    markedCount: count,
    thresholdReached: count >= READER_CLUSTER_THRESHOLD,
  };
}

export async function clusterMarkedAction(): Promise<{
  ok: true;
  formed: FormedCluster[];
}> {
  const session = await requireSession();
  const formed = await clusterMarkedItems(session.userId);
  revalidatePath("/");
  revalidatePath("/reader");
  return { ok: true, formed };
}
