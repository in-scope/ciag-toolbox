import type { MaskPanelState } from "@/lib/masks/mask-panel";

// CT-302: masks are pinned to the stack's spatial grid, so an in-place apply
// that changes the stack's geometry has to reconcile the panel's layers.
// Actions with a known spatial mapping (crop, rotate, flip) carry the masks
// through it (mask-geometry-transform.ts); a change with no mapping drops
// them, with the info toast below.
//
// "Geometry change" is BOTH declared and measured: crop, rotate, and flip
// declare it through the action flag (a flip, and a rotation of a square stack,
// keep the same width and height while moving every pixel), and any other
// transform that resizes the stack is caught by comparing dimensions.

export const MASKS_REMOVED_BY_GEOMETRY_CHANGE_MESSAGE =
  "Masks were removed because the stack's geometry changed";

export interface StackGeometryComparison {
  readonly actionChangesStackGeometry: boolean;
  readonly previousWidth: number;
  readonly previousHeight: number;
  readonly nextWidth: number;
  readonly nextHeight: number;
}

export function didStackGeometryChange(comparison: StackGeometryComparison): boolean {
  if (comparison.actionChangesStackGeometry) return true;
  return (
    comparison.previousWidth !== comparison.nextWidth ||
    comparison.previousHeight !== comparison.nextHeight
  );
}

export function wereMasksDroppedByGeometryChange(
  previous: MaskPanelState,
  next: MaskPanelState,
): boolean {
  return previous.layers.length > 0 && next.layers.length === 0;
}
