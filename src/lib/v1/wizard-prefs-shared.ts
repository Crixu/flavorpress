/**
 * Client-safe wizard pref constants and types. Imported by both the
 * server-side persistence layer (wizard-prefs.ts) and the client modal
 * (DraftWizardModal.tsx), so it must NOT pull in `server-only`,
 * `db`, or `settings.ts`.
 */

import { DEFAULT_DRAFT_FORMAT } from "./draft-format";

export const WIZARD_LENGTHS = [500, 1000, 1500, 2000] as const;
export type WizardLength = (typeof WIZARD_LENGTHS)[number];

export const DEFAULT_WIZARD_LENGTH: WizardLength = 1000;

export interface DraftWizardPrefs {
  format: string;
  length: WizardLength;
}

export const DEFAULT_WIZARD_PREFS: DraftWizardPrefs = {
  format: DEFAULT_DRAFT_FORMAT,
  length: DEFAULT_WIZARD_LENGTH,
};
