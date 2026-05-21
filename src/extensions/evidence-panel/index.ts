import type { ClientExtensionEntry } from "../types";
import { EvidencePanel } from "./Panel";
import { EVIDENCE_PANEL_ID, EVIDENCE_PANEL_LABEL } from "./types";

export const evidencePanelClientEntry: ClientExtensionEntry = {
  id: EVIDENCE_PANEL_ID,
  label: EVIDENCE_PANEL_LABEL,
  Panel: EvidencePanel,
};
