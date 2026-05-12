/**
 * Client-safe draft format constants. The full draft generator lives in
 * `draft-generator.ts` (server-only by import chain); this file holds only
 * the format archetype list so client components like DraftWizardModal can
 * import without pulling in libSQL or node:fs.
 */

export const DRAFT_FORMATS = ["narrative", "listicle", "news-brief", "opinion", "qa"] as const;
export type DraftFormat = (typeof DRAFT_FORMATS)[number];

export const DEFAULT_DRAFT_FORMAT: DraftFormat = "narrative";

export interface DraftFormatOption {
  key: string;
  name: string;
  instructions: string;
  presetId: DraftFormat | null;
}

export const DRAFT_FORMAT_PRESETS: Record<DraftFormat, Omit<DraftFormatOption, "key">> = {
  narrative: {
    name: "Narrative essay",
    presetId: "narrative",
    instructions:
      "Flowing paragraphs with no headers and no list markup. Lead with a scene or vivid claim; build through linked paragraphs; close on a single-sentence kicker.",
  },
  listicle: {
    name: "Listicle",
    presetId: "listicle",
    instructions:
      "Numbered or named list with 3-7 items. Each item is its own <h2> or <h3> followed by 1-3 paragraphs. Open with a one-paragraph framing lede before the first item; no closing summary.",
  },
  "news-brief": {
    name: "News brief",
    presetId: "news-brief",
    instructions:
      "Lead-with-the-news inverted-pyramid. First sentence states what changed and why it matters. 2-4 short paragraphs after that, ordered by descending importance. No headers; no scene-setting; no closing reflection.",
  },
  opinion: {
    name: "Opinion",
    presetId: "opinion",
    instructions:
      "Argumentative. Open with a sharp claim in the first sentence; back it with 2-4 paragraphs of evidence drawn from the sources; close with a forward-looking line. First-person allowed where the voice profile permits it.",
  },
  qa: {
    name: "Q&A explainer",
    presetId: "qa",
    instructions:
      "Question-and-answer structure. 3-5 <h3> question headings, each followed by 1-2 paragraph answers. Open with a one-paragraph framing lede before the first question.",
  },
};

export function isDraftFormat(value: unknown): value is DraftFormat {
  return typeof value === "string" && (DRAFT_FORMATS as readonly string[]).includes(value);
}

export function presetDraftFormatOption(format: DraftFormat): DraftFormatOption {
  const preset = DRAFT_FORMAT_PRESETS[format];
  return {
    key: format,
    name: preset.name,
    instructions: preset.instructions,
    presetId: preset.presetId,
  };
}

export function defaultDraftFormatOptions(): DraftFormatOption[] {
  return DRAFT_FORMATS.map((format) => presetDraftFormatOption(format));
}
