export const COMMENT_COURTROOM_ID = "comment-courtroom";
export const COMMENT_COURTROOM_LABEL = "Simulate comments";
export const COMMENT_COURTROOM_DESCRIPTION =
  "Simulates a comment thread from a fixed jury of reader personas, so the writer can feel the room before publishing.";

export const PERSONA_KEYS = ["enthusiast", "skeptic", "nitpicker", "contrarian", "lurker"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export interface PersonaInfo {
  key: PersonaKey;
  label: string;
  description: string;
}

export const PERSONAS: Record<PersonaKey, PersonaInfo> = {
  enthusiast: {
    key: "enthusiast",
    label: "The Enthusiast",
    description: "Loves it; says so loudly. Picks a specific line that landed and quotes it back.",
  },
  skeptic: {
    key: "skeptic",
    label: "The Skeptic",
    description:
      "Politely unconvinced. Names the strongest counter-argument or the missing evidence.",
  },
  nitpicker: {
    key: "nitpicker",
    label: "The Nitpicker",
    description:
      "One small thing. Catches a specific factual, grammatical, or formatting issue and only that.",
  },
  contrarian: {
    key: "contrarian",
    label: "The Contrarian",
    description: "Disagrees with the framing itself. Offers an alternative reading.",
  },
  lurker: {
    key: "lurker",
    label: "The Lurker",
    description: "Rarely comments. Drops one short, unexpected line that reframes the thread.",
  },
};

/** Hard caps applied server-side so the model can't blow out a draft's right rail. */
export const MAX_TOP_LEVEL = 5;
export const MIN_TOP_LEVEL = 3;
export const MAX_DEPTH = 2;

/** Internal row shape for a single persisted comment. */
export interface CourtroomComment {
  id: string;
  draftId: string;
  parentId: string | null;
  personaKey: PersonaKey;
  depth: number;
  sortOrder: number;
  body: string;
  createdAt: number;
}
