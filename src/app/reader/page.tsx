/**
 * Reader mode.
 *
 * Triage surface: swipe through unclustered items one at a time.
 * Right = great, follow up. Left = dismiss. When the marked pile
 * crosses READER_CLUSTER_THRESHOLD, the items are grouped into
 * clusters by an LLM pass and surface on Today.
 */

import Link from "next/link";
import { ensureSchema, ensureSingleUser, SINGLE_USER_ID } from "@/lib/db";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { loadReaderQueue, READER_CLUSTER_THRESHOLD } from "@/lib/v1/reader";
import { SwipeDeck } from "./_components/SwipeDeck";

export const dynamic = "force-dynamic";

export default async function ReaderPage() {
  await ensureSchema();
  await ensureSingleUser();
  await ensureRegisteredCapabilities();

  const queue = await loadReaderQueue(SINGLE_USER_ID);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">Reader</div>
        <h1 className="fp-h1 fp-h1-serif">Triage what's worth following up.</h1>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Swipe right to mark a story as great, left to skip. Once {READER_CLUSTER_THRESHOLD}{" "}
          stories are marked, they're grouped into clusters you can draft from.
        </p>
      </header>

      {queue.items.length === 0 ? (
        <EmptyDeck markedCount={queue.markedCount} />
      ) : (
        <SwipeDeck
          initialItems={queue.items}
          initialMarkedCount={queue.markedCount}
          threshold={READER_CLUSTER_THRESHOLD}
        />
      )}
    </div>
  );
}

function EmptyDeck({ markedCount }: { markedCount: number }) {
  return (
    <div className="fp-card-feature p-10 text-center" style={{ background: "var(--surface)" }}>
      <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
        Inbox zero.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
        Nothing left to triage. New items show up here as your sources poll.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Link href="/sources" className="fp-btn">
          Manage sources
        </Link>
        <Link href="/" className="fp-btn fp-btn-primary">
          {markedCount > 0 ? `${markedCount} marked → see clusters` : "Today"}
        </Link>
      </div>
    </div>
  );
}
