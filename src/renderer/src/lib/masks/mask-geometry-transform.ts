import {
  didStackGeometryChange,
  type StackGeometryComparison,
} from "@/lib/masks/mask-geometry-change";
import type { MaskLayer } from "@/lib/masks/mask-layer";
import { EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "@/lib/masks/mask-panel";

// Masks follow the pixels they annotate: an in-place crop, rotate, or flip
// moves every mask layer through the SAME spatial mapping as the stack, so the
// labels stay on the pixels the user painted them on. Only a geometry change
// with no known mapping (a user script that resizes the cube) still drops the
// panel's masks, with the info toast.

export interface MaskPlane {
  readonly values: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export type MaskPlaneTransform = (plane: MaskPlane) => MaskPlane;

export function carryMasksAcrossStackGeometryChange(
  panel: MaskPanelState,
  comparison: StackGeometryComparison,
  transform: MaskPlaneTransform | null,
): MaskPanelState {
  if (!didStackGeometryChange(comparison)) return panel;
  if (panel.layers.length === 0) return panel;
  if (!transform) return EMPTY_MASK_PANEL_STATE;
  const transformed = transformEveryMaskLayer(panel, transform);
  if (!everyLayerCoversDimensions(transformed, comparison)) return EMPTY_MASK_PANEL_STATE;
  return transformed;
}

function transformEveryMaskLayer(
  panel: MaskPanelState,
  transform: MaskPlaneTransform,
): MaskPanelState {
  return { ...panel, layers: panel.layers.map((layer) => transformMaskLayer(layer, transform)) };
}

function transformMaskLayer(layer: MaskLayer, transform: MaskPlaneTransform): MaskLayer {
  const plane = transform({ values: layer.values, width: layer.width, height: layer.height });
  return { ...layer, values: plane.values, width: plane.width, height: plane.height };
}

// The safety net for a transform that disagrees with the stack's actual result
// dimensions: a mask that no longer covers the stack must never survive.
function everyLayerCoversDimensions(
  panel: MaskPanelState,
  comparison: StackGeometryComparison,
): boolean {
  return panel.layers.every(
    (layer) => layer.width === comparison.nextWidth && layer.height === comparison.nextHeight,
  );
}
