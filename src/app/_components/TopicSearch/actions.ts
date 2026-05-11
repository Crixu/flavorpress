"use server";

import { ensureSchema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { topicSearch, type TopicSearchOutcome } from "@/lib/v1/topic-search";

export interface TopicSearchActionResult {
  ok: boolean;
  outcome?: TopicSearchOutcome;
  error?: string;
}

export async function runTopicSearchAction(topic: string): Promise<TopicSearchActionResult> {
  await ensureSchema();
  const session = await requireSession();
  await ensureRegisteredCapabilities();

  try {
    const outcome = await topicSearch(session.userId, topic);
    return { ok: true, outcome };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
