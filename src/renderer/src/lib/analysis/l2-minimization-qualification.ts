import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";

import { listNonEmptyCategoryValuesInMaskLayer } from "./npc-qualification";

// CT-313: L2 minimization fits a linear combination of bands that separates two
// labeled classes, so it needs the SAME qualification as NPC - a mask layer
// with at least two categories that actually carry painted pixels (an empty
// class gives the built-in script nothing to fit against). This module mirrors
// npc-qualification.ts exactly, reusing its category-painted predicate rather
// than duplicating it.

export const MIN_L2_NON_EMPTY_CATEGORY_COUNT = 2;

export const L2_NEEDS_A_SELECTED_STACK =
  "Select a panel with a loaded stack to run L2 minimization.";
export const L2_NEEDS_A_MASK_LAYER =
  "This stack has no mask layers. Add one with the Masks tool and paint at least two categories.";
export const L2_NEEDS_TWO_PAINTED_CATEGORIES =
  "L2 minimization needs a mask layer with at least two categories that have painted pixels.";

export function doesMaskLayerQualifyForL2(layer: MaskLayer): boolean {
  return (
    listNonEmptyCategoryValuesInMaskLayer(layer).length >= MIN_L2_NON_EMPTY_CATEGORY_COUNT
  );
}

export function listMaskLayersQualifyingForL2(
  panel: MaskPanelState,
): ReadonlyArray<MaskLayer> {
  return panel.layers.filter(doesMaskLayerQualifyForL2);
}

// null means the panel is ready to run; a string is the one thing the user has
// to do first, in the locked in-app vocabulary (stack, panel, mask layer,
// category).
export function describeL2QualificationProblemOrNull(
  panel: MaskPanelState | null,
): string | null {
  if (panel === null) return L2_NEEDS_A_SELECTED_STACK;
  if (panel.layers.length === 0) return L2_NEEDS_A_MASK_LAYER;
  if (listMaskLayersQualifyingForL2(panel).length === 0) {
    return L2_NEEDS_TWO_PAINTED_CATEGORIES;
  }
  return null;
}
