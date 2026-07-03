import { THRESHOLD_ACTION_ID } from "./threshold-action";

// CT-200: like the tone-curve editor (CT-104), the interactive threshold
// bounds editor lives ONLY inside the Threshold operation panel, and only when
// the active source is a raster the histogram can bin.

export interface ThresholdEditorPlacementInput {
  readonly activeActionId: string | null;
  readonly sourceKind: string | null;
}

export function shouldEmbedThresholdEditorInOperationPanel(
  input: ThresholdEditorPlacementInput,
): boolean {
  return input.activeActionId === THRESHOLD_ACTION_ID && input.sourceKind === "raster";
}
