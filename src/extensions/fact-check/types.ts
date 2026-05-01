export const VERDICTS = ["supported", "disputed", "unverified"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const FACT_CHECK_ID = "fact-check";
export const FACT_CHECK_LABEL = "Fact-check";
export const MAX_CLAIMS = 6;

/**
 * Internal row shape persisted by the fact-check extension. The editor
 * surface only sees ExtensionAnnotation; this type stays inside the
 * extension boundary.
 */
export interface FactCheckClaim {
  id: string;
  draftId: string;
  claimIndex: number;
  claimText: string;
  verdict: Verdict;
  comment: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  createdAt: number;
}
