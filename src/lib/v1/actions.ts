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
  publishToWordPress,
} from "../wordpress";
import {
  stageOutlet,
  commitOutletCredentials,
  recordOutletError,
  disconnectOutlet,
  setDefaultOutlet,
  getOutlet,
  getOutletCredentials,
  setSourceOutlets,
  getDefaultOutlet,
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

/**
 * Replace a source's outlet assignment. Form fields:
 *   sourceId
 *   outletIds (multiple values allowed via repeated `outletIds` field)
 *
 * Empty assignment = "All outlets (default)" — meaning the source will be
 * read by any outlet whose own assignment list is empty.
 */
export async function assignSourceOutletsAction(formData: FormData) {
  await ensureSchema();
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) throw new Error("sourceId required.");
  const outletIds = formData
    .getAll("outletIds")
    .map((v) => String(v))
    .filter((v) => v.length > 0);
  await setSourceOutlets(sourceId, outletIds);
  revalidatePath("/sources");
  revalidatePath(`/sources/${sourceId}`);
}

/**
 * Add a term to either the banned or signature list. Form fields:
 *   outletId, list ("banned" | "signature"), term
 * Idempotent — adding an existing term is a no-op.
 */
export async function addVoiceTermAction(formData: FormData) {
  await ensureSchema();
  const outletId = String(formData.get("outletId") ?? "");
  const list = String(formData.get("list") ?? "");
  const term = String(formData.get("term") ?? "").trim();
  if (!outletId) throw new Error("outletId required.");
  if (list !== "banned" && list !== "signature") {
    throw new Error("list must be 'banned' or 'signature'.");
  }
  if (!term) {
    revalidatePath(`/voice/${outletId}`);
    return;
  }
  const column = list === "banned" ? "banned_terms" : "signature_terms";
  const r = await db.execute({
    sql: `SELECT ${column} AS terms FROM voice_profiles WHERE outlet_id = ?`,
    args: [outletId],
  });
  if (r.rows.length === 0) throw new Error("Build the voice profile first.");
  const existing: string[] = JSON.parse(String(r.rows[0]!.terms ?? "[]"));
  if (existing.some((t) => t.toLowerCase() === term.toLowerCase())) {
    revalidatePath(`/voice/${outletId}`);
    return;
  }
  const next = [...existing, term];
  await db.execute({
    sql: `UPDATE voice_profiles SET ${column} = ? WHERE outlet_id = ?`,
    args: [JSON.stringify(next), outletId],
  });
  revalidatePath(`/voice/${outletId}`);
}

/**
 * Remove a term from either list. Form fields: outletId, list, term.
 */
export async function removeVoiceTermAction(formData: FormData) {
  await ensureSchema();
  const outletId = String(formData.get("outletId") ?? "");
  const list = String(formData.get("list") ?? "");
  const term = String(formData.get("term") ?? "").trim();
  if (!outletId) throw new Error("outletId required.");
  if (list !== "banned" && list !== "signature") {
    throw new Error("list must be 'banned' or 'signature'.");
  }
  const column = list === "banned" ? "banned_terms" : "signature_terms";
  const r = await db.execute({
    sql: `SELECT ${column} AS terms FROM voice_profiles WHERE outlet_id = ?`,
    args: [outletId],
  });
  if (r.rows.length === 0) return;
  const existing: string[] = JSON.parse(String(r.rows[0]!.terms ?? "[]"));
  const next = existing.filter((t) => t.toLowerCase() !== term.toLowerCase());
  await db.execute({
    sql: `UPDATE voice_profiles SET ${column} = ? WHERE outlet_id = ?`,
    args: [JSON.stringify(next), outletId],
  });
  revalidatePath(`/voice/${outletId}`);
}

export async function generateDraftAction(formData: FormData) {
  await ensureSchema();
  await ensureRegisteredCapabilities();
  const clusterId = String(formData.get("clusterId") ?? "");
  if (!clusterId) throw new Error("clusterId required.");

  // Pick outlet: explicit > default > error.
  const explicitOutlet = String(formData.get("outletId") ?? "");
  const outletId =
    explicitOutlet ||
    (await getDefaultOutlet(SINGLE_USER_ID))?.id ||
    "";
  if (!outletId) {
    throw new Error(
      "No outlet connected. Connect a WordPress site on /voice first.",
    );
  }

  // Reuse: if a draft already exists for this cluster + outlet, jump to it.
  // Generation costs an Anthropic call; we don't pay it twice for the same
  // cluster unless the user explicitly asks to regenerate (force=1).
  const force = String(formData.get("force") ?? "") === "1";
  if (!force) {
    const existing = await db.execute({
      sql: `SELECT id FROM drafts
            WHERE cluster_id = ? AND outlet_id = ? AND user_id = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [clusterId, outletId, SINGLE_USER_ID],
    });
    if (existing.rows.length > 0) {
      redirect(`/editor/${String(existing.rows[0]!.id)}`);
    }
  }

  const draft = await generateDraft({
    clusterId,
    userId: SINGLE_USER_ID,
    outletId,
  });
  redirect(`/editor/${draft.draftId}`);
}

/**
 * Push the rendered draft to the connected outlet as a WordPress post.
 * Default status is "draft" — the user lands on the WP edit screen, reads
 * the post in WordPress's own UI, and decides to publish there. We do NOT
 * publish=publish unless the form explicitly says so. This matches the
 * "preview in WP, edit in WP, ship in WP" mental model from the PRD.
 *
 * Form fields:
 *   draftId (required)
 *   status — "draft" (default) | "publish" | "future"
 *   scheduleAt — epoch ms when status=future
 *
 * Persists wp_post_id and wp_edit_link on the drafts row so the editor
 * can show "Open in WordPress" instead of "Publish" on subsequent visits.
 */
export async function publishDraftToWPAction(formData: FormData) {
  await ensureSchema();
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) throw new Error("draftId required.");

  const status = (() => {
    const s = String(formData.get("status") ?? "draft");
    return s === "publish" || s === "future" ? s : "draft";
  })() as "draft" | "publish" | "future";
  const scheduleAtRaw = formData.get("scheduleAt");
  const scheduleAt = scheduleAtRaw ? Number(scheduleAtRaw) : undefined;

  const r = await db.execute({
    sql: `SELECT id, outlet_id, headline, body, state, wp_post_id
          FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, SINGLE_USER_ID],
  });
  if (r.rows.length === 0) throw new Error("Draft not found.");
  const row = r.rows[0]!;

  if (row.wp_post_id) {
    // Already pushed once; return to the editor — the user can open in WP.
    revalidatePath(`/editor/${draftId}`);
    return;
  }

  const outletId = String(row.outlet_id ?? "");
  if (!outletId) throw new Error("Draft is not bound to an outlet.");
  const creds = await getOutletCredentials(outletId);
  if (!creds) {
    throw new Error(
      "Outlet has no stored credentials. Reconnect the outlet on /voice and try again.",
    );
  }

  const result = await publishToWordPress({
    creds,
    title: String(row.headline ?? ""),
    contentHtml: String(row.body ?? ""),
    status,
    scheduleAt,
  });

  await db.execute({
    sql: `UPDATE drafts
          SET wp_post_id = ?, wp_edit_link = ?,
              state = ?, edited_at = ?
          WHERE id = ? AND user_id = ?`,
    args: [
      result.wpPostId,
      result.editLink,
      status === "publish" ? "published" : "in-wordpress",
      Date.now(),
      draftId,
      SINGLE_USER_ID,
    ],
  });

  revalidatePath(`/editor/${draftId}`);
  redirect(result.editLink);
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
