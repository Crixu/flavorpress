import type { ClientExtensionEntry } from "../types";
import { AngleBuilderPanel } from "./Panel";
import { ANGLE_BUILDER_ID, ANGLE_BUILDER_LABEL } from "./types";

export const angleBuilderClientEntry: ClientExtensionEntry = {
  id: ANGLE_BUILDER_ID,
  label: ANGLE_BUILDER_LABEL,
  Panel: AngleBuilderPanel,
};
