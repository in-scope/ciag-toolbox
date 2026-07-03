import { BAND_WEIGHTING_ACTION_ID } from "./band-weighting-action";

// CT-209: like the threshold editor (CT-200), the per-band weight editor lives
// ONLY inside the Band Weighting operation panel, and only when the active source
// is a raster whose bands can be weighted.

export interface BandWeightingEditorPlacementInput {
  readonly activeActionId: string | null;
  readonly sourceKind: string | null;
}

export function shouldEmbedBandWeightingEditorInOperationPanel(
  input: BandWeightingEditorPlacementInput,
): boolean {
  return input.activeActionId === BAND_WEIGHTING_ACTION_ID && input.sourceKind === "raster";
}
