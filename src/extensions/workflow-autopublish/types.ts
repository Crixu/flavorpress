export const WORKFLOW_AUTOPUBLISH_ID = "workflow-autopublish";
export const WORKFLOW_AUTOPUBLISH_LABEL = "Workflow autopublish";
export const WORKFLOW_AUTOPUBLISH_DESCRIPTION =
  "Runs an opt-in Workflow that drafts from fresh fired clusters and publishes to WordPress on a configured cadence.";

export const WORKFLOW_INTERVAL_OPTIONS = [6, 12, 24] as const;
export const WORKFLOW_FRESHNESS_OPTIONS = [12, 24, 48] as const;

export type WorkflowAutopublishStatus = "published" | "skipped" | "failed";

export interface WorkflowAutopublishConfig {
  id: string;
  userId: string;
  outletId: string;
  enabled: boolean;
  intervalHours: number;
  autoUpdate: boolean;
  freshSourceWindowHours: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastDraftId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowAutopublishLogEntry {
  id: string;
  outletId: string;
  outletLabel: string;
  draftId: string | null;
  clusterId: string | null;
  status: WorkflowAutopublishStatus;
  message: string;
  createdAt: number;
}
