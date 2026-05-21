import type { ClientExtensionEntry } from "../types";
import { VoiceGuardPanel } from "./Panel";
import { VOICE_GUARD_ID, VOICE_GUARD_LABEL } from "./types";

export const voiceGuardClientEntry: ClientExtensionEntry = {
  id: VOICE_GUARD_ID,
  label: VOICE_GUARD_LABEL,
  Panel: VoiceGuardPanel,
};
