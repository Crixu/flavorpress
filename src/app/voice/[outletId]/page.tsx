/**
 * Per-outlet voice profile detail - master-detail layout.
 *
 * The sidebar shows all outlets; this route pre-selects outletId.
 * The right pane renders the full voice editor for the selected outlet.
 */

import { notFound, redirect } from "next/navigation";
import { ensureSchema, db } from "@/lib/db";
import { getUserPlan } from "@/lib/plans";
import { AuthRequiredError, requireSession } from "@/lib/session";
import { getOutlet, getOutletCredentials, listOutlets } from "@/lib/v1/outlets";
import { listOutletFormats } from "@/lib/v1/outlet-formats";
import { getOutletPostCount, MIN_VOICE_TRAIN_POSTS } from "@/lib/wordpress";
import { canUseAuthorizeFlow } from "@/lib/v1/origin";
import { isWpcomOAuthConfigured } from "@/lib/wpcom-oauth";
import { Notice } from "@/components/wpds";
import { VoiceShell } from "../_components/VoiceShell";
import { OutletDetail } from "../_components/OutletDetail";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ outletId: string }>;
  searchParams: Promise<{ thin?: string; wp_connected?: string }>;
}

export default async function VoiceDetailPage({ params, searchParams }: PageProps) {
  await ensureSchema();
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    throw err;
  }
  const { outletId } = await params;
  const sp = await searchParams;

  const [outlet, outlets, authorizeAvailable, plan] = await Promise.all([
    getOutlet(outletId, session.userId),
    listOutlets(session.userId),
    canUseAuthorizeFlow(),
    getUserPlan(session.userId),
  ]);
  const wpcomAvailable = isWpcomOAuthConfigured();
  const outletLimit = plan.limits.outlets;
  const outletCount = outlets.length;
  const canCreateOutlet = outletCount < outletLimit;
  const currentPlanLabel = planLabel(plan);

  if (!outlet || outlet.userId !== session.userId) notFound();

  const [r, formats] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM voice_profiles WHERE outlet_id = ?`,
      args: [outletId],
    }),
    listOutletFormats(outletId, session.userId),
  ]);
  const row = r.rows[0] ?? null;

  let profileData = null;
  if (row) {
    const banned: string[] = JSON.parse(String(row.banned_terms ?? "[]")) as string[];
    const signature: string[] = JSON.parse(String(row.signature_terms ?? "[]")) as string[];

    profileData = {
      archiveSize: Number(row.archive_index_size ?? 0),
      sentenceMean: Number(row.sentence_length_mean ?? 0),
      sentenceVar: Number(row.sentence_length_variance ?? 0),
      emDash: Number(row.em_dash_density ?? 0),
      hedge: Number(row.hedge_frequency ?? 0),
      quoteDensity: Number(row.quote_density ?? 0),
      lastBuilt: Number(row.last_rebuilt_at ?? 0),
      seedLabel: formatSeedMethod((row as Record<string, unknown>).seed_method),
      hasFingerprint: (row.function_word_distribution as unknown) !== null,
      banned,
      signature,
      description: String((row as Record<string, unknown>).description ?? ""),
    };
  }

  // Cold-start probe for thin/empty archives.
  const thinOverride = sp.thin !== undefined ? Number.parseInt(sp.thin, 10) : NaN;
  let archivePostCount: number | null =
    Number.isFinite(thinOverride) && thinOverride >= 0 ? thinOverride : null;

  if (!row && outlet.connected && archivePostCount === null) {
    const creds = await getOutletCredentials(outletId);
    if (creds) {
      try {
        archivePostCount = await getOutletPostCount(creds);
      } catch {
        archivePostCount = null;
      }
    }
  }

  const isThinArchive = archivePostCount !== null && archivePostCount < MIN_VOICE_TRAIN_POSTS;

  return (
    <VoiceShell
      outlets={outlets}
      selectedId={outletId}
      authorizeAvailable={authorizeAvailable}
      wpcomAvailable={wpcomAvailable}
      canCreateOutlet={canCreateOutlet}
      outletLimit={outletLimit}
      outletCount={outletCount}
      planLabel={currentPlanLabel}
    >
      <div className="space-y-4">
        {sp.wp_connected ? (
          <Notice tone="success">WordPress connected. Build the voice profile next.</Notice>
        ) : null}
        <OutletDetail
          outlet={outlet}
          profile={profileData}
          formats={formats}
          isThinArchive={isThinArchive}
          archivePostCount={archivePostCount}
          authorizeAvailable={authorizeAvailable}
          wpcomAvailable={wpcomAvailable}
        />
      </div>
    </VoiceShell>
  );
}

function formatSeedMethod(value: unknown): string {
  switch (String(value ?? "")) {
    case "archive":
      return "archive";
    case "paste":
      return "pasted samples";
    case "freewrite":
      return "free-write";
    case "interview":
      return "interview";
    default:
      return "not recorded";
  }
}

function planLabel(plan: { plan: string; source: string }): string {
  if (plan.source === "local") return "Local unlimited plan";
  if (plan.plan === "pro") return "Pro";
  if (plan.plan === "custom") return "Custom";
  return "Trial";
}
