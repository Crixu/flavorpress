export const VOICE_GUARD_ID = "voice-guard";
export const VOICE_GUARD_LABEL = "Voice guard";
export const VOICE_GUARD_DESCRIPTION =
  "Flags off-voice phrasing, banned terms, and generic AI texture against the outlet voice profile.";
export const MAX_VOICE_GUARD_NOTES = 8;

export type VoiceGuardSeverity = "good" | "watch" | "fix";
export type VoiceGuardNoteKind =
  | "score"
  | "banned_term"
  | "ai_phrase"
  | "sentence_length"
  | "em_dash"
  | "hedge"
  | "voice_profile";

export interface VoiceGuardNote {
  id: string;
  draftId: string;
  noteIndex: number;
  kind: VoiceGuardNoteKind;
  severity: VoiceGuardSeverity;
  spanText: string;
  note: string;
  suggestion: string;
  createdAt: number;
}
