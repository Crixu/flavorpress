export type ResearchBoardCardKind =
  | "source"
  | "quote"
  | "lead"
  | "angle"
  | "link"
  | "image"
  | "note";

export interface ResearchBoardCard {
  id: string;
  kind: ResearchBoardCardKind;
  title: string;
  body: string;
  meta: string;
  comment?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  imageUrl?: string;
  x: number;
  y: number;
}

export interface ResearchBoardConnection {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface ResearchBoardState {
  layout?: "lanes-v1";
  cards: ResearchBoardCard[];
  connections: ResearchBoardConnection[];
  // Ids the user has ever interacted with - whether currently on the board
  // or explicitly removed. Persists deletion across sessions so reconcile
  // doesn't resurrect cards the user got rid of.
  seenIds?: string[];
}

const MAX_CARDS = 80;
const MAX_CONNECTIONS = 160;
const MAX_SEEN_IDS = 1000;
const MAX_TITLE = 500;
const MAX_BODY = 8000;
const MAX_META = 120;
const MAX_COMMENT = 1000;
const MAX_URL = 4000;
export const MAX_IMAGE_URL = 300_000;

export function parseResearchBoardState(raw: string | null | undefined): ResearchBoardState | null {
  if (!raw) return null;
  try {
    return normalizeResearchBoardState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function normalizeResearchBoardState(value: unknown): ResearchBoardState {
  const obj = isRecord(value) ? value : {};
  const cardsRaw = Array.isArray(obj.cards) ? obj.cards : [];
  const connectionsRaw = Array.isArray(obj.connections) ? obj.connections : [];
  const cards = cardsRaw
    .slice(0, MAX_CARDS)
    .map(normalizeCard)
    .filter((card) => card !== null);
  const cardIds = new Set(cards.map((card) => card.id));
  const connections = connectionsRaw
    .slice(0, MAX_CONNECTIONS)
    .map(normalizeConnection)
    .filter((connection): connection is ResearchBoardConnection => {
      return connection !== null && cardIds.has(connection.from) && cardIds.has(connection.to);
    });
  const layout = obj.layout === "lanes-v1" ? "lanes-v1" : undefined;
  const seenIdsRaw = Array.isArray(obj.seenIds) ? obj.seenIds : [];
  const seenIds = Array.from(
    new Set(
      seenIdsRaw
        .slice(0, MAX_SEEN_IDS)
        .map((value) => cleanText(value, 120))
        .filter((value): value is string => value.length > 0),
    ),
  );
  const state: ResearchBoardState = { cards, connections };
  if (layout) state.layout = layout;
  if (seenIds.length > 0) state.seenIds = seenIds;
  return state;
}

export function renderResearchBoardPrompt(board: ResearchBoardState | null | undefined): string {
  if (!board || board.cards.length === 0) return "";
  const byId = new Map(board.cards.map((card) => [card.id, card]));
  const cardLines = board.cards
    .map((card) => {
      const source = card.sourceUrl ? ` Source: ${card.sourceUrl}` : "";
      const imageNote = card.kind === "image" ? " Treat as visual reference only." : "";
      const comment = card.comment ? ` Writer comment: ${card.comment}` : "";
      return `- [${card.id}] ${card.kind.toUpperCase()}: ${card.title}. ${card.body}${source}${imageNote}${comment}`;
    })
    .join("\n");
  const connectionLines = board.connections
    .map((connection) => {
      const from = byId.get(connection.from);
      const to = byId.get(connection.to);
      if (!from || !to) return "";
      return `- ${connection.label}: [${connection.from}] ${from.title} -> [${connection.to}] ${to.title}`;
    })
    .filter(Boolean)
    .join("\n");

  return `RESEARCH BOARD (writer-arranged structure; preserve these relationships when drafting. NOTE cards and writer comments are user-authored instructions, not source facts; follow them as editorial direction but do not present them as sourced claims):
Cards:
${cardLines}
${connectionLines ? `\nConnections:\n${connectionLines}` : ""}`;
}

export function renderResearchBoardHandoffHtml(
  board: ResearchBoardState | null | undefined,
): string {
  if (!board || board.cards.length === 0) return "";
  const parts: string[] = [];
  const userCards = board.cards.filter((card) => card.kind === "note" || card.comment);
  const hasConnections = board.connections.length > 0;
  if (userCards.length === 0 && !hasConnections) return "";

  parts.push(`<p><strong>Research board</strong></p>`);
  for (const card of userCards) {
    const label = labelForKind(card.kind);
    const title = card.title ? ` ${escapeHtml(card.title)}` : "";
    const source = card.sourceUrl
      ? ` <a href="${escapeHtml(card.sourceUrl)}">${escapeHtml(
          card.sourceLabel ?? hostFromUrl(card.sourceUrl),
        )}</a>`
      : "";
    if (card.kind === "note") {
      parts.push(`<p><strong>Sticky${title ? `:${title}` : ""}</strong>${source}</p>`);
      if (card.body) parts.push(`<p>${escapeHtml(card.body)}</p>`);
    } else {
      parts.push(`<p><strong>Comment on ${label}${title ? `:${title}` : ""}</strong>${source}</p>`);
    }
    if (card.comment) parts.push(`<p><em>Comment:</em> ${escapeHtml(card.comment)}</p>`);
  }

  if (hasConnections) {
    const byId = new Map(board.cards.map((card) => [card.id, card]));
    parts.push(`<p><strong>Board connections</strong></p>`);
    for (const connection of board.connections) {
      const from = byId.get(connection.from);
      const to = byId.get(connection.to);
      if (!from || !to) continue;
      parts.push(
        `<p>${escapeHtml(connection.label)}: ${escapeHtml(from.title)} to ${escapeHtml(
          to.title,
        )}</p>`,
      );
    }
  }

  return parts.join("\n");
}

function normalizeCard(value: unknown): ResearchBoardCard | null {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 120);
  const kind = cleanKind(value.kind);
  if (!id || !kind) return null;
  const card: ResearchBoardCard = {
    id,
    kind,
    title: cleanText(value.title, MAX_TITLE) || labelForKind(kind),
    body: cleanText(value.body, MAX_BODY),
    meta: cleanText(value.meta, MAX_META),
    x: cleanCoordinate(value.x),
    y: cleanCoordinate(value.y),
  };
  const sourceUrl = cleanText(value.sourceUrl, MAX_URL);
  const sourceLabel = cleanText(value.sourceLabel, MAX_TITLE);
  const comment = cleanText(value.comment, MAX_COMMENT);
  // Oversized image data URLs are dropped rather than truncated; a sliced data
  // URL renders as a broken image and obscures whatever the card was about.
  const imageRaw = String(value.imageUrl ?? "");
  const imageUrl = imageRaw.length <= MAX_IMAGE_URL ? imageRaw.trim() : "";
  if (sourceUrl) card.sourceUrl = sourceUrl;
  if (sourceLabel) card.sourceLabel = sourceLabel;
  if (comment) card.comment = comment;
  if (imageUrl) card.imageUrl = imageUrl;
  return card;
}

function normalizeConnection(value: unknown): ResearchBoardConnection | null {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, 120);
  const from = cleanText(value.from, 120);
  const to = cleanText(value.to, 120);
  const label = cleanText(value.label, 80);
  if (!id || !from || !to || !label) return null;
  return { id, from, to, label };
}

function cleanKind(value: unknown): ResearchBoardCardKind | null {
  const kind = String(value ?? "");
  if (
    kind === "source" ||
    kind === "quote" ||
    kind === "lead" ||
    kind === "angle" ||
    kind === "link" ||
    kind === "image" ||
    kind === "note"
  ) {
    return kind;
  }
  return null;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function cleanCoordinate(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(6000, Math.round(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function labelForKind(kind: ResearchBoardCardKind): string {
  if (kind === "source") return "Source";
  if (kind === "quote") return "Quote";
  if (kind === "lead") return "Lead";
  if (kind === "angle") return "Angle";
  if (kind === "image") return "Image";
  if (kind === "link") return "Link";
  return "Note";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hostFromUrl(s: string): string {
  try {
    return new URL(s).host;
  } catch {
    return s;
  }
}
