import { redirect } from "next/navigation";
import {
  WORKFLOW_AUTOPUBLISH_ID,
  WORKFLOW_DEFAULT_INTERVAL_HOURS,
  WORKFLOW_FRESHNESS_OPTIONS,
  WORKFLOW_INTERVAL_MAX_HOURS,
  WORKFLOW_INTERVAL_MIN_HOURS,
} from "@/extensions/workflow-autopublish/types";
import { saveWorkflowAutopublishAction } from "@/extensions/workflow-autopublish/actions";
import { loadWorkflowAutopublishState } from "@/extensions/workflow-autopublish/server";
import { ensureSchema } from "@/lib/db";
import { AuthRequiredError, canAccessSettings, requireSession } from "@/lib/session";
import { getEffectiveDisabledExtensionIds } from "@/lib/v1/settings";
import { PendingMessage, SubmitButton } from "../_components/SubmitButton";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    saved?: string;
    error?: string;
  }>;
}

export default async function WorkflowsPage({ searchParams }: PageProps) {
  await ensureSchema();
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  if (!canAccessSettings(session)) redirect("/");
  const disabled = await getEffectiveDisabledExtensionIds(session.userId);
  if (disabled.has(WORKFLOW_AUTOPUBLISH_ID)) redirect("/settings?section=extensions");

  const [sp, state] = await Promise.all([
    searchParams,
    loadWorkflowAutopublishState(session.userId),
  ]);
  const enabledCount = state.workflows.filter((workflow) => workflow.config.enabled).length;
  const nextRunAt = state.workflows
    .map((workflow) => workflow.config.nextRunAt)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {sp.saved === "workflow_autopublish" ? <Banner kind="success">Saved Workflow.</Banner> : null}
      {sp.error === "extension_locked_by_admin" ? (
        <Banner kind="error">That extension is disabled by your admin.</Banner>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
          Scheduled publishing by Voice and Folder.
        </p>
      </div>

      {state.outlets.length === 0 ? (
        <section className="fp-card p-5">
          <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
            Connect a WordPress outlet on Voice before enabling a Workflow.
          </p>
        </section>
      ) : (
        <>
          <section
            className="grid gap-3 rounded-lg border p-3 text-[12.5px] sm:grid-cols-3"
            style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}
          >
            <WorkflowField
              label="Workflows"
              value={`${enabledCount}/${state.workflows.length} enabled`}
            />
            <WorkflowField
              label="Next due run"
              value={nextRunAt ? formatDateTime(nextRunAt) : "None scheduled"}
            />
            <WorkflowField label="Recent runs" value={`${state.logs.length} shown`} />
          </section>

          <WorkflowForm
            title="New Workflow"
            outlets={state.outlets}
            folderOptions={state.folderOptions}
          />

          {state.workflows.length > 0 ? (
            <section className="space-y-3">
              {state.workflows.map((workflow) => (
                <WorkflowForm
                  key={workflow.id}
                  title={`${workflow.outletLabel} · ${workflow.folderLabel}`}
                  outlets={state.outlets}
                  folderOptions={state.folderOptions}
                  workflow={workflow}
                />
              ))}
            </section>
          ) : null}
        </>
      )}

      {state.logs.length > 0 ? (
        <section className="fp-card p-5">
          <h2 className="text-sm font-semibold" style={{ color: "var(--fg-muted)" }}>
            Activity
          </h2>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--border)" }}>
            {state.logs.map((entry) => (
              <li key={entry.id} className="py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      entry.status === "published"
                        ? "fp-chip fp-chip-emerald"
                        : entry.status === "failed"
                          ? "fp-chip fp-chip-rose"
                          : "fp-chip"
                    }
                  >
                    {entry.status}
                  </span>
                  <span style={{ color: "var(--fg-muted)" }}>
                    {entry.outletLabel} · {entry.folderLabel} · {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                <p className="mt-1" style={{ color: "var(--fg-muted)" }}>
                  {entry.message}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function WorkflowForm({
  title,
  outlets,
  folderOptions,
  workflow,
}: {
  title: string;
  outlets: Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["outlets"];
  folderOptions: Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["folderOptions"];
  workflow?: Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["workflows"][number];
}) {
  const config = workflow?.config;
  const connected = workflow ? workflow.connected : outlets.some((outlet) => outlet.connected);
  const outletOptions = workflow ? outlets : connectedOutletsFirst(outlets);
  const folderOptionsForForm =
    workflow && config && !folderOptions.some((folder) => folder.scope === config.folderScope)
      ? [{ scope: config.folderScope, label: workflow.folderLabel }, ...folderOptions]
      : folderOptions;
  return (
    <form
      action={saveWorkflowAutopublishAction}
      className="rounded-lg border p-4 space-y-4"
      style={{ borderColor: "var(--border)", background: "var(--bg)" }}
    >
      {workflow ? (
        <>
          <input type="hidden" name="outletId" value={workflow.outletId} />
          <input type="hidden" name="previousFolderScope" value={workflow.folderScope} />
        </>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {workflow ? (
              <span className={workflowStateChip(workflow).className}>
                {workflowStateChip(workflow).label}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px]" style={{ color: "var(--fg-muted)" }}>
            {workflow ? workflowStateLine(workflow) : "Create one scheduled lane."}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            name="enabled"
            value="1"
            defaultChecked={config?.enabled ?? true}
            disabled={!connected}
          />
          Enabled
        </label>
      </div>

      {workflow ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <WorkflowField
            label="Next run"
            value={config?.nextRunAt ? formatDateTime(config.nextRunAt) : "Not scheduled"}
          />
          <WorkflowField
            label="Last result"
            value={
              workflow.lastLog
                ? `${workflow.lastLog.status} at ${formatDateTime(workflow.lastLog.createdAt)}`
                : "No run yet"
            }
            tone={workflow.lastLog?.status}
          />
          <WorkflowField
            label="Last message"
            value={workflow.lastLog?.message ?? "No activity recorded"}
          />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        {workflow ? (
          <WorkflowField label="Voice" value={workflow.outletLabel} />
        ) : (
          <label className="space-y-1 text-[12px] font-medium">
            <span>Voice</span>
            <select name="outletId" className="fp-input w-full text-[13px]" disabled={!connected}>
              {outletOptions.map((outlet) => (
                <option key={outlet.id} value={outlet.id} disabled={!outlet.connected}>
                  {outlet.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1 text-[12px] font-medium">
          <span>Folder</span>
          <select
            name="folderScope"
            defaultValue={config?.folderScope ?? "all"}
            className="fp-input w-full text-[13px]"
            disabled={!connected}
          >
            {folderOptionsForForm.map((folder) => (
              <option key={folder.scope} value={folder.scope}>
                {folder.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[12px] font-medium">
          <span>Cadence</span>
          <input
            type="number"
            name="intervalHours"
            min={WORKFLOW_INTERVAL_MIN_HOURS}
            max={WORKFLOW_INTERVAL_MAX_HOURS}
            step={1}
            inputMode="numeric"
            defaultValue={config?.intervalHours ?? WORKFLOW_DEFAULT_INTERVAL_HOURS}
            className="fp-input w-full text-[13px]"
            disabled={!connected}
          />
        </label>
        <label className="space-y-1 text-[12px] font-medium">
          <span>Freshness</span>
          <select
            name="freshSourceWindowHours"
            defaultValue={config?.freshSourceWindowHours ?? 24}
            className="fp-input w-full text-[13px]"
            disabled={!connected}
          >
            {WORKFLOW_FRESHNESS_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                Last {hours} hours
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            name="autoUpdate"
            value="1"
            defaultChecked={config?.autoUpdate ?? true}
            disabled={!connected}
          />
          Auto update before publish
        </label>
        <SubmitButton className="fp-btn fp-btn-primary" pendingLabel="Saving" disabled={!connected}>
          Save Workflow
        </SubmitButton>
        <PendingMessage>Writing Workflow settings.</PendingMessage>
      </div>
    </form>
  );
}

function connectedOutletsFirst(
  outlets: Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["outlets"],
): Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["outlets"] {
  return [...outlets].sort((a, b) => Number(b.connected) - Number(a.connected));
}

function WorkflowField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "published" | "skipped" | "failed";
}) {
  const color =
    tone === "published"
      ? "var(--emerald)"
      : tone === "failed"
        ? "var(--rose)"
        : tone === "skipped"
          ? "var(--amber)"
          : "var(--fg)";
  return (
    <div className="min-w-0">
      <div
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </div>
      <div className="mt-1 truncate text-[13px] font-medium" style={{ color }} title={value}>
        {value}
      </div>
    </div>
  );
}

function workflowStateChip(
  workflow: Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["workflows"][number],
): { label: string; className: string } {
  if (!workflow.connected) return { label: "Disconnected", className: "fp-chip fp-chip-rose" };
  if (!workflow.config.enabled) return { label: "Off", className: "fp-chip" };
  if (!workflow.config.nextRunAt) return { label: "On", className: "fp-chip fp-chip-emerald" };
  if (workflow.config.nextRunAt <= Date.now()) {
    return { label: "Due", className: "fp-chip fp-chip-amber" };
  }
  return { label: "Scheduled", className: "fp-chip fp-chip-emerald" };
}

function workflowStateLine(
  workflow: Awaited<ReturnType<typeof loadWorkflowAutopublishState>>["workflows"][number],
): string {
  if (!workflow.connected) return "Reconnect this Voice before autopublish can run.";
  if (!workflow.config.enabled) return "This Workflow has no scheduled run.";
  if (!workflow.config.nextRunAt) return "Enabled, waiting for cron to schedule the next run.";
  return `Publishes at most one fresh fired cluster ${formatCadence(workflow.config.intervalHours)}.`;
}

function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatCadence(hours: number): string {
  return hours === 1 ? "every hour" : `every ${hours} hours`;
}

function Banner({ kind, children }: { kind: "success" | "error"; children: React.ReactNode }) {
  const palette =
    kind === "success"
      ? {
          bg: "var(--emerald-tint)",
          fg: "var(--emerald)",
          border: "color-mix(in srgb, var(--emerald) 25%, var(--border))",
        }
      : {
          bg: "var(--rose-tint)",
          fg: "var(--rose)",
          border: "color-mix(in srgb, var(--rose) 25%, var(--border))",
        };
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </div>
  );
}
