export const EVIDENCE_PANEL_ID = "evidence-panel";
export const EVIDENCE_PANEL_LABEL = "Evidence panel";
export const EVIDENCE_PANEL_DESCRIPTION =
  "Checks whether draft claims are backed by the attached sources before the post goes to WordPress.";
export const MAX_EVIDENCE_ITEMS = 7;

export type EvidenceStatus = "strong" | "thin" | "missing";

export interface EvidenceItem {
  id: string;
  draftId: string;
  itemIndex: number;
  claimText: string;
  status: EvidenceStatus;
  note: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  quoteText: string | null;
  createdAt: number;
}
