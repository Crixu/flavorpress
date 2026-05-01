export const RELATED_IMAGES_ID = "related-images";
export const RELATED_IMAGES_LABEL = "Related images";
export const MAX_RESULTS = 12;

/**
 * Openverse license codes. Order matches the panel chip order.
 *
 * Commercial-OK set (default filter) is the top half: cc0, pdm, by, by-sa.
 * The non-commercial variants are kept selectable so a user with a
 * non-commercial blog can opt into them explicitly.
 */
export const LICENSE_CODES = [
  "cc0",
  "pdm",
  "by",
  "by-sa",
  "by-nd",
  "by-nc",
  "by-nc-sa",
  "by-nc-nd",
] as const;
export type LicenseCode = (typeof LICENSE_CODES)[number];

export const LICENSE_LABELS: Record<LicenseCode, string> = {
  cc0: "CC0",
  pdm: "Public Domain",
  by: "CC BY",
  "by-sa": "CC BY-SA",
  "by-nd": "CC BY-ND",
  "by-nc": "CC BY-NC",
  "by-nc-sa": "CC BY-NC-SA",
  "by-nc-nd": "CC BY-NC-ND",
};

export const LICENSE_DESCRIPTIONS: Record<LicenseCode, string> = {
  cc0: "No rights reserved",
  pdm: "Public-domain mark",
  by: "Attribution",
  "by-sa": "Attribution, share-alike",
  "by-nd": "Attribution, no derivatives",
  "by-nc": "Attribution, non-commercial",
  "by-nc-sa": "Non-commercial, share-alike",
  "by-nc-nd": "Non-commercial, no derivatives",
};

export const DEFAULT_LICENSE_FILTER: readonly LicenseCode[] = [
  "cc0",
  "pdm",
  "by",
  "by-sa",
];

export interface RelatedImageResult {
  id: string;
  draftId: string;
  resultIndex: number;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  sourceProvider: string | null;
  title: string | null;
  creator: string | null;
  creatorUrl: string | null;
  licenseCode: LicenseCode;
  licenseVersion: string | null;
  licenseUrl: string | null;
  width: number | null;
  height: number | null;
  searchedAt: number;
}
