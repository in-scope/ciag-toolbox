import type { ParameterValuesById } from "./parameter-schema";
import {
  OTSU_THRESHOLD_METHOD,
  readThresholdMethodChoice,
  THRESHOLD_ACTION_ID,
} from "./threshold-action";

// CT-200: like the tone-curve editor (CT-104), the interactive threshold
// bounds editor lives ONLY inside the Threshold operation panel, and only when
// the active source is a raster the histogram can bin. CT-282: the bounds are
// the MANUAL method's controls, so picking the Otsu method hides the editor
// (Otsu has no bounds fields; its cutoffs are derived at Apply).

export interface ThresholdEditorPlacementInput {
  readonly activeActionId: string | null;
  readonly sourceKind: string | null;
  readonly activeParameterValues: ParameterValuesById;
}

export function shouldEmbedThresholdEditorInOperationPanel(
  input: ThresholdEditorPlacementInput,
): boolean {
  if (input.activeActionId !== THRESHOLD_ACTION_ID || input.sourceKind !== "raster") return false;
  return readThresholdMethodChoice(input.activeParameterValues) !== OTSU_THRESHOLD_METHOD;
}
