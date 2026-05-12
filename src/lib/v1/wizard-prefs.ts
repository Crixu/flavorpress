import "server-only";

/**
 * Last-used format and length for the guided-draft wizard.
 *
 * Stored as a single JSON blob in app_settings under "draft_wizard_prefs".
 * The wizard uses these to preselect chips on open and to power "Just go".
 * Single-user app so we don't bother keying by user_id.
 */

import { getSetting, setSetting } from "./settings";
import {
  DEFAULT_WIZARD_PREFS,
  WIZARD_LENGTHS,
  type DraftWizardPrefs,
  type WizardLength,
} from "./wizard-prefs-shared";

export {
  DEFAULT_WIZARD_LENGTH,
  DEFAULT_WIZARD_PREFS,
  WIZARD_LENGTHS,
  type DraftWizardPrefs,
  type WizardLength,
} from "./wizard-prefs-shared";

const KEY = "draft_wizard_prefs";

export async function getDraftWizardPrefs(): Promise<DraftWizardPrefs> {
  const raw = await getSetting(KEY);
  if (!raw) return DEFAULT_WIZARD_PREFS;
  try {
    const parsed = JSON.parse(raw) as { format?: unknown; length?: unknown };
    const format =
      String(parsed.format ?? "")
        .trim()
        .slice(0, 120) || DEFAULT_WIZARD_PREFS.format;
    const lengthNum = Number(parsed.length);
    const length = (WIZARD_LENGTHS as readonly number[]).includes(lengthNum)
      ? (lengthNum as WizardLength)
      : DEFAULT_WIZARD_PREFS.length;
    return { format, length };
  } catch {
    return DEFAULT_WIZARD_PREFS;
  }
}

export async function setDraftWizardPrefs(prefs: DraftWizardPrefs): Promise<void> {
  await setSetting(KEY, JSON.stringify(prefs));
}
