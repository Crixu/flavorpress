"use server";

import { ensureSchema, ensureSingleUser, SINGLE_USER_ID } from "@/lib/db";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { topicSearch, type TopicSearchOutcome } from "@/lib/v1/topic-search";

export interface TopicSearchActionResult {
  ok: boolean;
  outcome?: TopicSearchOutcome;
  error?: string;
}

export async function runTopicSearchAction(topic: string): Promise<TopicSearchActionResult> {
  await ensureSchema();
  await ensureSingleUser();
  await ensureRegisteredCapabilities();

  try {
    const outcome = await topicSearch(SINGLE_USER_ID, topic);
    return { ok: true, outcome };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
