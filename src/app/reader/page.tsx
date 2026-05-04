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
import {
  listReaderFolderOptions,
  loadReaderQueue,
  READER_CLUSTER_THRESHOLD,
  type ReaderFolderOption,
} from "@/lib/v1/reader";
import { SwipeDeck } from "./_components/SwipeDeck";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ folder?: string }>;
}

export default async function ReaderPage({ searchParams }: PageProps) {
  await ensureSchema();
  await ensureSingleUser();
  await ensureRegisteredCapabilities();

  const sp = await searchParams;
  const { folders, totalCount } = await listReaderFolderOptions(SINGLE_USER_ID);
  const requestedFolder = sp.folder ?? null;
  // If the requested folder no longer exists (renamed, deleted, has no
  // sources), fall back to All rather than 404'ing the page.
  const activeFolder = requestedFolder
    ? (folders.find((f) => f.id === requestedFolder)?.id ?? null)
    : null;

  const queue = await loadReaderQueue(SINGLE_USER_ID, activeFolder);

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

      {folders.length > 0 ? (
        <FolderChips folders={folders} totalCount={totalCount} activeFolder={activeFolder} />
      ) : null}

      {queue.items.length === 0 ? (
        <EmptyDeck markedCount={queue.markedCount} activeFolder={activeFolder} />
      ) : (
        <SwipeDeck
          key={activeFolder ?? "all"}
          initialItems={queue.items}
          initialMarkedCount={queue.markedCount}
          threshold={READER_CLUSTER_THRESHOLD}
        />
      )}
    </div>
  );
}

function FolderChips({
  folders,
  totalCount,
  activeFolder,
}: {
  folders: ReaderFolderOption[];
  totalCount: number;
  activeFolder: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
        Folder
      </span>
      <Link
        href="/reader"
        className={`fp-chip ${!activeFolder ? "fp-chip-indigo" : ""} transition`}
      >
        All · {totalCount}
      </Link>
      {folders.map((f) => {
        const active = activeFolder === f.id;
        return (
          <Link
            key={f.id}
            href={`/reader?folder=${encodeURIComponent(f.id)}`}
            className={`fp-chip ${active ? "fp-chip-indigo" : ""} transition`}
          >
            {f.name} · {f.queueCount}
          </Link>
        );
      })}
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
