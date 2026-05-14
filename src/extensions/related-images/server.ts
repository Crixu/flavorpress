import "server-only";

/**
 * Related-images extension - server half. Searches Openverse for
 * licensed photographs/illustrations the writer can attach to a draft,
 * filtered by the license codes they have opted into.
 *
 * Openverse is used because (a) it indexes Wikimedia, Flickr CC, museums
 * and many other openly-licensed catalogs through a single API and
 * (b) every result carries the license code, version and a link to the
 * canonical license text, so the panel can render the attribution the
 * writer is required to publish alongside the image.
 *
 * The extension intentionally does not annotate text spans. The article
 * overlay's annotation pipeline only fits comments anchored to verbatim
 * draft substrings; image suggestions live in the right rail and use a
 * bespoke Panel state instead. `loadAnnotations` therefore returns an
 * empty payload, while the Panel hydrates via its own server action.
 */

import { db, ensureSchema } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getSetting, setSetting, SETTING_KEYS } from "@/lib/v1/settings";
import type { ServerExtensionEntry } from "../types";
import {
  DEFAULT_LICENSE_FILTER,
  LICENSE_CODES,
  MAX_RESULTS,
  RELATED_IMAGES_ID,
  type LicenseCode,
  type RelatedImageResult,
} from "./types";

const OPENVERSE_ENDPOINT = "https://api.openverse.org/v1/images/";

interface OpenverseHit {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  thumbnail?: unknown;
  foreign_landing_url?: unknown;
  creator?: unknown;
  creator_url?: unknown;
  license?: unknown;
  license_version?: unknown;
  license_url?: unknown;
  source?: unknown;
  width?: unknown;
  height?: unknown;
}

interface OpenverseResponse {
  results?: OpenverseHit[];
}

function licenseFilterSettingKey(userId: string): string {
  return `${SETTING_KEYS.relatedImagesLicenseFilter}:${userId}`;
}

export async function getLicenseFilter(userId: string): Promise<LicenseCode[]> {
  const raw =
    (await getSetting(licenseFilterSettingKey(userId))) ??
    (await getSetting(SETTING_KEYS.relatedImagesLicenseFilter));
  if (!raw) return [...DEFAULT_LICENSE_FILTER];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_LICENSE_FILTER];
    const valid = parsed.filter(
      (x): x is LicenseCode =>
        typeof x === "string" && (LICENSE_CODES as readonly string[]).includes(x),
    );
    return valid.length > 0 ? valid : [...DEFAULT_LICENSE_FILTER];
  } catch {
    return [...DEFAULT_LICENSE_FILTER];
  }
}

export async function setLicenseFilter(
  codes: LicenseCode[],
  userId: string,
): Promise<LicenseCode[]> {
  const cleaned = Array.from(new Set(codes)).filter((x): x is LicenseCode =>
    (LICENSE_CODES as readonly string[]).includes(x),
  );
  // An empty filter would match nothing; treat it as "fall back to default"
  // so the user can't accidentally lock themselves out of search results.
  const effective = cleaned.length > 0 ? cleaned : [...DEFAULT_LICENSE_FILTER];
  await setSetting(licenseFilterSettingKey(userId), JSON.stringify(effective));
  // Prune the caller's cached results whose license is no longer
  // permitted. Without this, narrowing the filter would leave stale rows
  // in the panel that the chips claim are excluded; the reuse guidance
  // the panel renders would then be wrong.
  const placeholders = effective.map(() => "?").join(",");
  await db.execute({
    sql: `DELETE FROM related_image_results
          WHERE license_code NOT IN (${placeholders})
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [...effective, userId],
  });
  return effective;
}

export async function runRelatedImageSearch(
  draftId: string,
): Promise<{ results: RelatedImageResult[]; ranAt: number; licenseFilter: LicenseCode[] }> {
  const session = await requireSession();
  await ensureSchema();

  const draftRow = await db.execute({
    sql: `SELECT id, headline, body FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (draftRow.rows.length === 0) throw new Error("Draft not found.");

  const headline = String(draftRow.rows[0]!.headline ?? "");
  const bodyText = stripHtml(String(draftRow.rows[0]!.body ?? ""));
  const query = buildQuery(headline, bodyText);
  if (!query) {
    throw new Error("Draft has no headline or body to search from yet.");
  }

  const licenseFilter = await getLicenseFilter(session.userId);

  const url = new URL(OPENVERSE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("license", licenseFilter.join(","));
  url.searchParams.set("page_size", String(MAX_RESULTS));
  url.searchParams.set("mature", "false");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(
      `Openverse request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`Openverse returned ${res.status} ${res.statusText}.`);
  }
  const data = (await res.json()) as OpenverseResponse;
  const ranAt = Date.now();

  await db.execute({
    sql: `DELETE FROM related_image_results WHERE draft_id = ?
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, session.userId],
  });
  // Persist a run marker before any rows. A zero-hit search needs to be
  // distinguishable from "never searched" on reload; without this the
  // loader has no per-draft timestamp to fall back on. The license
  // filter goes on the row too so a later filter change can invalidate
  // `ranAt` instead of leaving the panel claiming a search ran under
  // the new filter.
  const runFilterKey = encodeFilterKey(licenseFilter);
  await db.execute({
    sql: `INSERT INTO related_image_runs (draft_id, searched_at, license_filter)
          VALUES (?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            searched_at = excluded.searched_at,
            license_filter = excluded.license_filter`,
    args: [draftId, ranAt, runFilterKey],
  });

  const persisted: RelatedImageResult[] = [];
  let index = 0;
  for (const hit of data.results ?? []) {
    if (persisted.length >= MAX_RESULTS) break;
    const normalized = normalizeHit(hit);
    if (!normalized) continue;
    const id = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO related_image_results
            (id, draft_id, result_index, image_url, thumbnail_url, source_url,
             source_provider, title, creator, creator_url,
             license_code, license_version, license_url,
             width, height, searched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        draftId,
        index,
        normalized.imageUrl,
        normalized.thumbnailUrl,
        normalized.sourceUrl,
        normalized.sourceProvider,
        normalized.title,
        normalized.creator,
        normalized.creatorUrl,
        normalized.licenseCode,
        normalized.licenseVersion,
        normalized.licenseUrl,
        normalized.width,
        normalized.height,
        ranAt,
      ],
    });
    persisted.push({
      id,
      draftId,
      resultIndex: index,
      searchedAt: ranAt,
      ...normalized,
    });
    index += 1;
  }

  return { results: persisted, ranAt, licenseFilter };
}

export async function loadRelatedImages(
  draftId: string,
): Promise<{ results: RelatedImageResult[]; ranAt: number | null }> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before returning any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) return { results: [], ranAt: null };

  const [r, runRow, currentFilter] = await Promise.all([
    db.execute({
      sql: `SELECT id, draft_id, result_index, image_url, thumbnail_url, source_url,
                   source_provider, title, creator, creator_url,
                   license_code, license_version, license_url,
                   width, height, searched_at
            FROM related_image_results
            WHERE draft_id = ?
            ORDER BY result_index ASC`,
      args: [draftId],
    }),
    db.execute({
      sql: `SELECT searched_at, license_filter FROM related_image_runs WHERE draft_id = ?`,
      args: [draftId],
    }),
    getLicenseFilter(session.userId),
  ]);
  const results: RelatedImageResult[] = r.rows.map((row) => ({
    id: String(row.id),
    draftId: String(row.draft_id),
    resultIndex: Number(row.result_index),
    imageUrl: String(row.image_url),
    thumbnailUrl: String(row.thumbnail_url),
    sourceUrl: String(row.source_url),
    sourceProvider: row.source_provider ? String(row.source_provider) : null,
    title: row.title ? String(row.title) : null,
    creator: row.creator ? String(row.creator) : null,
    creatorUrl: row.creator_url ? String(row.creator_url) : null,
    licenseCode: String(row.license_code) as LicenseCode,
    licenseVersion: row.license_version ? String(row.license_version) : null,
    licenseUrl: row.license_url ? String(row.license_url) : null,
    width: row.width !== null && row.width !== undefined ? Number(row.width) : null,
    height: row.height !== null && row.height !== undefined ? Number(row.height) : null,
    searchedAt: Number(row.searched_at),
  }));
  // The run row carries the license filter the search used. If the
  // user has since changed the filter, no Openverse search has run
  // under the active selection, so `ranAt` is null and the panel falls
  // back to its initial "click Find images" copy. Without this, a
  // filter narrowing that prunes every result would render a false
  // "no images found under the current filter" line, and a zero-hit
  // search reused under a broader filter would claim it had already
  // ruled out images that were never queried.
  //
  // Legacy rows from before the license_filter column was added have
  // it as NULL. Those keep the old behavior (use `searched_at` as-is)
  // so an existing zero-hit search still looks like it ran on reload.
  // Every fresh search writes the column, so the strict filter check
  // applies to all post-migration data.
  const runRowExists = runRow.rows.length > 0;
  const runFilterRaw =
    runRowExists && runRow.rows[0]!.license_filter !== null
      ? String(runRow.rows[0]!.license_filter)
      : null;
  const isLegacyRunRow = runRowExists && runFilterRaw === null;
  const filterMatches = runFilterRaw !== null && runFilterRaw === encodeFilterKey(currentFilter);
  const ranAt =
    runRowExists && (filterMatches || isLegacyRunRow) ? Number(runRow.rows[0]!.searched_at) : null;
  return { results, ranAt };
}

function encodeFilterKey(codes: readonly LicenseCode[]): string {
  return [...codes].sort().join(",");
}

export async function clearRelatedImages(draftId: string): Promise<void> {
  const session = await requireSession();
  await ensureSchema();

  // Verify the draft belongs to the session user before deleting any data.
  const ownership = await db.execute({
    sql: `SELECT id FROM drafts WHERE id = ? AND user_id = ?`,
    args: [draftId, session.userId],
  });
  if (ownership.rows.length === 0) throw new Error("Draft not found.");

  await db.execute({
    sql: `DELETE FROM related_image_results WHERE draft_id = ?
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, session.userId],
  });
  await db.execute({
    sql: `DELETE FROM related_image_runs WHERE draft_id = ?
          AND draft_id IN (SELECT id FROM drafts WHERE user_id = ?)`,
    args: [draftId, session.userId],
  });
}

export const relatedImagesServerEntry: ServerExtensionEntry = {
  id: RELATED_IMAGES_ID,
  // Image suggestions are not span-anchored, so the article overlay has
  // nothing to wrap. The Panel hydrates its own state via a dedicated
  // server action; the editor surface stays unchanged.
  async loadAnnotations() {
    return { annotations: [], ranAt: null };
  },
};

function buildQuery(headline: string, bodyText: string): string {
  // Headline is the strongest signal for an editorial photo search; the
  // body's first ~600 chars supplement it with concrete entities. Stop
  // words and short tokens are dropped so the query stays specific
  // ("Bauhaus archive Weimar" not "the of in Bauhaus archive Weimar").
  const raw = `${headline} ${bodyText.slice(0, 600)}`;
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
    if (ordered.length >= 8) break;
  }
  return ordered.join(" ").trim();
}

function normalizeHit(
  hit: OpenverseHit,
): Omit<RelatedImageResult, "id" | "draftId" | "resultIndex" | "searchedAt"> | null {
  const imageUrl = typeof hit.url === "string" ? hit.url : null;
  const thumbnailUrl =
    typeof hit.thumbnail === "string" && hit.thumbnail.length > 0 ? hit.thumbnail : imageUrl;
  const sourceUrl = typeof hit.foreign_landing_url === "string" ? hit.foreign_landing_url : null;
  const licenseRaw = typeof hit.license === "string" ? hit.license.trim().toLowerCase() : "";
  if (!imageUrl || !thumbnailUrl || !sourceUrl) return null;
  if (!(LICENSE_CODES as readonly string[]).includes(licenseRaw)) return null;
  return {
    imageUrl,
    thumbnailUrl,
    sourceUrl,
    sourceProvider: typeof hit.source === "string" ? hit.source : null,
    title:
      typeof hit.title === "string" && hit.title.trim().length > 0
        ? hit.title.trim().slice(0, 240)
        : null,
    creator: typeof hit.creator === "string" ? hit.creator : null,
    creatorUrl: typeof hit.creator_url === "string" ? hit.creator_url : null,
    licenseCode: licenseRaw as LicenseCode,
    licenseVersion: typeof hit.license_version === "string" ? hit.license_version : null,
    licenseUrl: typeof hit.license_url === "string" ? hit.license_url : null,
    width: typeof hit.width === "number" ? hit.width : null,
    height: typeof hit.height === "number" ? hit.height : null,
  };
}

const STOP_WORDS = new Set<string>([
  "about",
  "after",
  "again",
  "against",
  "along",
  "also",
  "among",
  "another",
  "around",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "could",
  "during",
  "each",
  "even",
  "every",
  "from",
  "have",
  "having",
  "here",
  "into",
  "just",
  "like",
  "many",
  "more",
  "most",
  "much",
  "must",
  "never",
  "often",
  "once",
  "only",
  "other",
  "over",
  "same",
  "should",
  "since",
  "some",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/(p|h\d|li|blockquote)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
