/**
 * Notes mode editor view. The user writes their own post in their own
 * surface (WordPress, an editor, paper); we show grounded material they
 * can mine. The research board is client-side arrangement over the
 * server-loaded notes and sources. Original source rows stay preserved
 * even when the user deletes scraps from the board.
 */

import { deleteDraftAction } from "@/lib/v1/actions";
import type { Notes } from "@/lib/v1/notes-generator";
import type { ResearchBoardState } from "@/lib/v1/research-board";
import { FlagMismatchButton } from "./NotesActions";
import { ResearchBoard } from "./ResearchBoard";

interface SourceRow {
  id: string;
  title: string;
  display_name: string | null;
  source_url: string;
  published_at: number;
  is_manual: boolean;
}

interface Props {
  draftId: string;
  clusterId: string;
  topic: string;
  notes: Notes;
  sources: SourceRow[];
  sourceCount: number;
  wpEditLink: string | null;
  initialBoard: ResearchBoardState | null;
  sibling?: React.ReactNode;
}

export function NotebookView({
  draftId,
  clusterId,
  topic,
  notes,
  sources,
  sourceCount,
  wpEditLink,
  initialBoard,
  sibling,
}: Props) {
  return (
    <article className="fp-notebook">
      <ResearchBoard
        draftId={draftId}
        clusterId={clusterId}
        topic={topic}
        notes={notes}
        sources={sources}
        sourceCount={sourceCount}
        wpEditLink={wpEditLink}
        initialBoard={initialBoard}
        sibling={sibling}
      />

      <div className="fp-notebook-footer">
        <p className="fp-notebook-footer-label">
          Done with these notes? Delete to keep your drafts list tidy.
        </p>
        <div className="fp-notebook-footer-actions">
          <FlagMismatchButton draftId={draftId} clusterId={clusterId} />
          <form action={deleteDraftAction}>
            <input type="hidden" name="draftId" value={draftId} />
            <input type="hidden" name="redirectTo" value="/drafts" />
            <button
              type="submit"
              className="text-[12px] hover:underline"
              style={{ color: "var(--fg-subtle)" }}
            >
              Delete notes
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}
