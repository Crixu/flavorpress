/**
 * Reader mode.
 *
 * Triage surface: swipe through unclustered items one at a time.
 * Right = save, left = skip. Marked items are draftable immediately.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureSchema } from "@/lib/db";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { ensureRegisteredCapabilities } from "@/lib/v1/bootstrap";
import { listReaderFolderOptions, loadReaderQueue } from "@/lib/v1/reader";
import { ReaderClient } from "./_components/ReaderClient";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ folder?: string }>;
}

export default async function ReaderPage({ searchParams }: PageProps) {
  await ensureSchema();
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  await ensureRegisteredCapabilities();

  const sp = await searchParams;
  const { folders, totalCount } = await listReaderFolderOptions(session.userId);
  const requestedFolder = sp.folder ?? null;
  // If the requested folder no longer exists (renamed, deleted, has no
  // sources), fall back to All rather than 404'ing the page.
  const activeFolder = requestedFolder
    ? (folders.find((f) => f.id === requestedFolder)?.id ?? null)
    : null;

  const queue = await loadReaderQueue(session.userId, activeFolder);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <div className="fp-eyebrow">Reader</div>
        <h1 className="fp-h1 fp-h1-serif">Triage what's worth following up.</h1>
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          Swipe right to save a story for drafting, left to skip it.
        </p>
      </header>

      {queue.items.length === 0 ? (
        <EmptyDeck markedCount={queue.markedCount} activeFolder={activeFolder} />
      ) : (
        <ReaderClient
          key={activeFolder ?? "all"}
          initialItems={queue.items}
          initialMarkedCount={queue.markedCount}
          folders={folders}
          totalCount={totalCount}
          activeFolder={activeFolder}
        />
      )}
    </div>
  );
}

function EmptyDeck({
  markedCount,
  activeFolder,
}: {
  markedCount: number;
  activeFolder: string | null;
}) {
  return (
    <div className="fp-card-feature p-10 text-center" style={{ background: "var(--surface)" }}>
      <h2 className="fp-h1-serif" style={{ fontSize: 22 }}>
        Inbox zero.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: "var(--fg-muted)" }}>
        {activeFolder
          ? "Nothing left to triage in this folder. Try All or another folder."
          : "Nothing left to triage. New items show up here as your sources poll."}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {activeFolder ? (
          <Link href="/reader" className="fp-btn">
            See all folders
          </Link>
        ) : (
          <Link href="/sources" className="fp-btn">
            Manage sources
          </Link>
        )}
        <Link href="/" className="fp-btn fp-btn-primary">
          {markedCount > 0 ? `${markedCount} marked → see clusters` : "Today"}
        </Link>
      </div>
    </div>
  );
}
