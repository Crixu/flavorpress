export const WORKFLOW_AUTOPUBLISH_ID = "workflow-autopublish";
export const WORKFLOW_AUTOPUBLISH_LABEL = "Workflow autopublish";
export const WORKFLOW_AUTOPUBLISH_DESCRIPTION =
  "Runs an opt-in Workflow that drafts from fresh fired clusters and publishes to WordPress on a configured cadence.";

export const WORKFLOW_DEFAULT_INTERVAL_HOURS = 12;
export const WORKFLOW_INTERVAL_MIN_HOURS = 1;
export const WORKFLOW_INTERVAL_MAX_HOURS = 48;
export const WORKFLOW_FRESHNESS_OPTIONS = [12, 24, 48] as const;
export const WORKFLOW_FOLDER_ALL = "all";
export const WORKFLOW_FOLDER_UNGROUPED = "ungrouped";

export function normalizeWorkflowIntervalHours(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return WORKFLOW_DEFAULT_INTERVAL_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return WORKFLOW_DEFAULT_INTERVAL_HOURS;
  return Math.min(
    WORKFLOW_INTERVAL_MAX_HOURS,
    Math.max(WORKFLOW_INTERVAL_MIN_HOURS, Math.trunc(n)),
  );
}

export type WorkflowAutopublishStatus = "published" | "skipped" | "failed";

export interface WorkflowAutopublishConfig {
  id: string;
  userId: string;
  outletId: string;
  folderScope: string;
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
  folderScope: string;
  folderLabel: string;
  draftId: string | null;
  clusterId: string | null;
  status: WorkflowAutopublishStatus;
  message: string;
  createdAt: number;
}

export interface WorkflowAutopublishFolderOption {
  scope: string;
  label: string;
}
