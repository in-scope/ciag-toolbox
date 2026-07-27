import { CUSTOM_TRANSFORM_ACTION_ID } from "./custom-transform-action";

// CT-216: like the band-selection editor (CT-210), the custom-transform controls
// (formula field, import button, status line) live ONLY inside the Custom
// Transform operation panel, and only when the active source is a raster.

export interface CustomTransformEditorPlacementInput {
  readonly activeActionId: string | null;
  readonly sourceKind: string | null;
}

export function shouldEmbedCustomTransformEditorInOperationPanel(
  input: CustomTransformEditorPlacementInput,
): boolean {
  return input.activeActionId === CUSTOM_TRANSFORM_ACTION_ID && input.sourceKind === "raster";
}
