export const ANGLE_BUILDER_ID = "angle-builder";
export const ANGLE_BUILDER_LABEL = "Angle builder";
export const ANGLE_BUILDER_DESCRIPTION =
  "Turns the draft's source set into sharper alternate angles the writer can regenerate from.";
export const MAX_ANGLES = 4;

export type AngleBuilderKind = "archive" | "gap" | "stance" | "reader";

export interface AngleBuilderSuggestion {
  id: string;
  draftId: string;
  angleIndex: number;
  kind: AngleBuilderKind;
  label: string;
  title: string;
  thesis: string;
  why: string;
  sourceCue: string;
  createdAt: number;
}
