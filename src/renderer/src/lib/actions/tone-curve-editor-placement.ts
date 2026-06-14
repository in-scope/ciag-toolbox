export const TONE_CURVE_ACTION_ID = "tone-curve";

export interface ToneCurveEditorPlacementInput {
  readonly activeActionId: string | null;
  readonly sourceKind: string | null;
}

export function shouldEmbedToneCurveEditorInOperationPanel(
  input: ToneCurveEditorPlacementInput,
): boolean {
  return input.activeActionId === TONE_CURVE_ACTION_ID && input.sourceKind === "raster";
}
