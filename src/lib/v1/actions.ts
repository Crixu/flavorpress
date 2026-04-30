"use server";

/**
 * Server actions for the v1 routes.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, ensureSchema, ensureSingleUser, SINGLE_USER_ID } from "../db";
import { ensureRegisteredCapabilities } from "./bootstrap";
import { generateDraft } from "./draft-generator";
import { getRegistry } from "./capability-registry";
import { extractStyleSheet } from "./style-sheet";
import {
  encodePreflight,
  listRecentPosts,
  preflightWordPress,
  probeWordPress,
} from "../wordpress";
import {
  stageOutlet,
  commitOutletCredentials,
  recordOutletError,
  disconnectOutlet,
  setDefaultOutlet,
  getOutlet,
  getOutletCredentials,
} from "./outlets";

function getOrigin(): string {
  return process.env.FLAVORPRESS_ORIGIN ?? "http://localhost:3000";
}

/**
 * Run the preflight only. Stages the outlet (so we have a row to attach
 * findings to) and stores the result on `last_error` for the UI to read.
 */
export async function preflightOutletAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const baseUrl = String(formData.get("baseUrl") ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!baseUrl) throw new Error("Site URL required.");

  const outletId = await stageOutlet(SINGLE_USER_ID, baseUrl);
  const result = await preflightWordPress(baseUrl, getOrigin());
  await recordOutletError(outletId, encodePreflight(result));
  revalidatePath("/voice");
  redirect(`/voice?check=${outletId}`);
}

/**
 * Manual fallback: paste username + password in case the one-click
 * authorize flow is not available (localhost http callback rejection,
 * Jetpack-managed site, etc.).
 */
export async function connectOutletManualAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/$/, "");
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();
  if (!baseUrl || !username || !appPassword) {
    throw new Error("All fields required.");
  }

  const outletId = await stageOutlet(SINGLE_USER_ID, baseUrl);
  const probe = await probeWordPress({ baseUrl, username, appPassword });
  if (!probe.ok) {
    await recordOutletError(outletId, probe.message, probe.kind);
    revalidatePath("/voice");
    throw new Error(probe.message);
  }

  await commitOutletCredentials(outletId, username, appPassword, probe.kind);
  revalidatePath("/voice");
  revalidatePath("/");
}

/**
 * Kick off the WordPress Application Password authorize flow for a new
 * (or existing-but-disconnected) outlet. Redirects the user to
 * /wp-admin/authorize-application.php on their site.
 *
 * Reference: https://developer.wordpress.org/rest-api/reference/application-passwords/
 */
export async function startWPAuthorizeAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("Site URL required.");
  const skipPreflight = formData.get("skipPreflight") === "1";

  const outletId = await stageOutlet(SINGLE_USER_ID, baseUrl);

  // Preflight: verify reachability + Application Passwords + callback scheme
  // before sending the user out of the app. If anything fails, redirect back
  // to /voice with the structured findings rendered as a check card.
  if (!skipPreflight) {
    const result = await preflightWordPress(baseUrl, getOrigin());
    if (!result.ok) {
      await recordOutletError(outletId, encodePreflight(result));
      revalidatePath("/voice");
      redirect(`/voice?check=${outletId}`);
    }
    // Pass: clear any prior error so the outlet card shows clean.
    await recordOutletError(outletId, "");
  }

  const successUrl = `${getOrigin()}/api/wp/callback?outlet_id=${outletId}`;
  const rejectUrl = `${getOrigin()}/voice?wp_rejected=${outletId}`;
  const params = new URLSearchParams({
    app_name: "FlavorPress",
    success_url: successUrl,
    reject_url: rejectUrl,
  });
  const authorizeUrl = `${baseUrl}/wp-admin/authorize-application.php?${params.toString()}`;

  redirect(authorizeUrl);
}

export async function disconnectOutletAction(formData: FormData) {
  await ensureSchema();
  const outletId = String(formData.get("outletId") ?? "");
  const purge = formData.get("purge") === "1";
  if (!outletId) throw new Error("outletId required.");
  await disconnectOutlet(outletId, { purge });
  revalidatePath("/voice");
  revalidatePath("/");
}

export async function setDefaultOutletAction(formData: FormData) {
  await ensureSchema();
  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) throw new Error("outletId required.");
  await setDefaultOutlet(outletId);
  revalidatePath("/voice");
  revalidatePath("/");
}

export async function addSourceAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const raw = String(formData.get("urls") ?? formData.get("url") ?? "").trim();
  if (!raw) throw new Error("URL required.");

  // Bulk paste support: split on newlines, commas, or spaces.
  const urls = Array.from(
    new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)),
  );

  for (const url of urls) {
    const kind = detectKind(url);
    const id = crypto.randomUUID();
    const display = (() => {
      try {
        return new URL(url).host.replace(/^www\./, "");
      } catch {
        return url;
      }
    })();
    // Podcasts and YouTube need transcription; tracked but inactive in v1
    // so we don't lose them — when v1.1 ships Whisper, we just flip active.
    const isPending = kind === "podcast" || kind === "youtube";
    try {
      await db.execute({
        sql: `INSERT INTO sources
              (id, user_id, kind, url, display_name, trust_score,
               poll_interval_seconds, active, last_error, created_at)
              VALUES (?, ?, ?, ?, ?, 0.5, ?, ?, ?, ?)`,
        args: [
          id,
          SINGLE_USER_ID,
          kind,
          url,
          display,
          isPending ? 3600 : 300,
          isPending ? 0 : 1,
          isPending
            ? "Pending v1.1 — transcription via Whisper not yet wired. Source saved; activates when v1.1 ships."
            : null,
          Date.now(),
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE")) console.warn(`addSource: ${url}: ${msg}`);
    }
  }

  revalidatePath("/sources");
  revalidatePath("/");
}

/**
 * Detect source kind. v1 actively polls RSS, Atom, and Reddit. Podcast and
 * YouTube sources are accepted and stored but not polled until v1.1 ships
 * Whisper transcription; the user can see what they've added even though
 * the cluster engine ignores them for now.
 */
function detectKind(
  url: string,
): "rss" | "reddit" | "podcast" | "youtube" {
  const u = url.toLowerCase();
  if (u.includes("youtube.com/feeds/videos.xml")) return "youtube";
  if (u.includes("youtube.com/channel/") || u.includes("youtube.com/@") || u.includes("youtu.be")) {
    return "youtube";
  }
  if (u.includes("/feed.mp3") || u.includes("anchor.fm") || u.includes("megaphone.fm") || u.includes("/rss/podcast")) {
    return "podcast";
  }
  if (u.includes("reddit.com/r/") || u.includes("reddit.com/.rss")) return "reddit";
  return "rss";
}

export async function pollSourceAction(formData: FormData) {
  await ensureSchema();
  await ensureRegisteredCapabilities();
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) throw new Error("sourceId required.");

  const registry = getRegistry();
  await registry.invoke("source-connector.rss", undefined, { sourceId }, {
    userId: SINGLE_USER_ID,
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  });

  revalidatePath("/sources");
  revalidatePath("/");
}

export async function pollAllSourcesAction() {
  await ensureSchema();
  await ensureRegisteredCapabilities();
  const sources = await db.execute({
    sql: `SELECT id FROM sources WHERE user_id = ? AND active = 1`,
    args: [SINGLE_USER_ID],
  });
  const registry = getRegistry();
  await Promise.all(
    sources.rows.map(async (row) => {
      try {
        await registry.invoke(
          "source-connector.rss",
          undefined,
          { sourceId: String(row.id) },
          {
            userId: SINGLE_USER_ID,
            requestId: crypto.randomUUID(),
            traceId: crypto.randomUUID(),
          },
        );
      } catch (err) {
        // Don't fail the batch on one bad feed; the source row records the error.
        console.warn(`pollAll source ${row.id}: ${err}`);
      }
    }),
  );
  revalidatePath("/sources");
  revalidatePath("/");
}

export async function deleteSourceAction(formData: FormData) {
  await ensureSchema();
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) throw new Error("sourceId required.");
  await db.execute({
    sql: `DELETE FROM sources WHERE id = ? AND user_id = ?`,
    args: [sourceId, SINGLE_USER_ID],
  });
  await db.execute({
    sql: `DELETE FROM items WHERE source_id = ? AND user_id = ?`,
    args: [sourceId, SINGLE_USER_ID],
  });
  revalidatePath("/sources");
}

export async function buildVoiceProfileAction(formData: FormData) {
  await ensureSchema();
  await ensureSingleUser();
  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) throw new Error("outletId required.");
  const outlet = await getOutlet(outletId);
  if (!outlet) throw new Error("Outlet not found.");
  if (!outlet.connected) throw new Error("Connect this outlet first.");

  const creds = await getOutletCredentials(outletId);
  if (!creds) throw new Error("Outlet credentials missing.");

  const posts = await listRecentPosts(creds, 50);

  const styleSheet = extractStyleSheet(
    posts.map((p) => ({
      title: stripHtml(p.title.rendered),
      body: stripHtml(p.content.rendered),
      publishedAt: Date.parse(p.date),
    })),
  );

  const yaml = renderStyleYaml(styleSheet);

  await db.execute({
    sql: `INSERT OR REPLACE INTO voice_profiles
          (outlet_id, user_id, style_sheet_yaml, archive_index_size,
           function_word_distribution, sentence_length_mean, sentence_length_variance,
           hedge_frequency, em_dash_density, quote_density,
           banned_terms, signature_terms, anchored_post_ids, last_rebuilt_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      outletId,
      SINGLE_USER_ID,
      yaml,
      posts.length,
      new Uint8Array(styleSheet.functionWordDistribution.buffer),
      styleSheet.sentenceLengthMean,
      styleSheet.sentenceLengthVariance,
      styleSheet.hedgeFrequency,
      styleSheet.emDashDensity,
      styleSheet.quoteDensity,
      JSON.stringify(styleSheet.bannedTerms),
      JSON.stringify(styleSheet.signatureTerms),
      JSON.stringify([]),
      Date.now(),
    ],
  });

  revalidatePath("/voice");
}

export async function generateDraftAction(formData: FormData) {
  await ensureSchema();
  await ensureRegisteredCapabilities();
  const clusterId = String(formData.get("clusterId") ?? "");
  if (!clusterId) throw new Error("clusterId required.");
  const draft = await generateDraft({
    clusterId,
    userId: SINGLE_USER_ID,
  });
  redirect(`/editor/${draft.draftId}`);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function renderStyleYaml(s: ReturnType<typeof extractStyleSheet>): string {
  return [
    `archive_size: ${s.archiveSize}`,
    `sentence_length_mean: ${s.sentenceLengthMean.toFixed(2)}`,
    `sentence_length_variance: ${s.sentenceLengthVariance.toFixed(2)}`,
    `hedge_frequency_per_1000: ${s.hedgeFrequency.toFixed(2)}`,
    `em_dash_density_per_1000: ${s.emDashDensity.toFixed(2)}`,
    `quote_density_per_1000: ${s.quoteDensity.toFixed(2)}`,
    `signature_terms: [${s.signatureTerms.slice(0, 12).map((t) => JSON.stringify(t)).join(", ")}]`,
    `banned_terms: [${s.bannedTerms.map((t) => JSON.stringify(t)).join(", ")}]`,
    `opener_patterns: [${s.openerPatterns.slice(0, 6).map((t) => JSON.stringify(t)).join(", ")}]`,
  ].join("\n");
}
