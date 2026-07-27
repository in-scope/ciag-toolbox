import { BAND_SELECTION_ACTION_ID } from "./band-selection-action";

// CT-210: like the band-weighting editor (CT-209), the band-selection controls
// (preset picker, formula field, import button) live ONLY inside the Band
// Selection operation panel, and only when the active source is a raster.

export interface BandSelectionEditorPlacementInput {
  readonly activeActionId: string | null;
  readonly sourceKind: string | null;
}

export function shouldEmbedBandSelectionEditorInOperationPanel(
  input: BandSelectionEditorPlacementInput,
): boolean {
  return input.activeActionId === BAND_SELECTION_ACTION_ID && input.sourceKind === "raster";
}
