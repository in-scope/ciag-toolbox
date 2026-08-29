import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { MaskPanelState } from "@/lib/masks/mask-panel";

import {
  doesMaskLayerQualifyForNpc,
  listMaskLayersQualifyingForNpc,
} from "./npc-qualification";

// CT-320: CNR contrasts a text category against a background category, so it
// needs exactly what NPC needs - a mask layer with at least two categories that
// carry painted pixels - and delegates the predicates to npc-qualification
// rather than re-deriving them. Only the sentences differ: they name CNR, and
// they speak the locked vocabulary (stack, panel, mask layer, category).

export const CNR_NEEDS_A_SELECTED_STACK =
  "Select a panel with a loaded stack to compute a CNR score.";
export const CNR_NEEDS_A_MASK_LAYER =
  "This stack has no mask layers. Add one with the Masks tool and paint at least two categories.";
export const CNR_NEEDS_TWO_PAINTED_CATEGORIES =
  "CNR needs a mask layer with at least two categories that have painted pixels.";

export function doesMaskLayerQualifyForCnr(layer: MaskLayer): boolean {
  return doesMaskLayerQualifyForNpc(layer);
}

export function listMaskLayersQualifyingForCnr(
  panel: MaskPanelState,
): ReadonlyArray<MaskLayer> {
  return listMaskLayersQualifyingForNpc(panel);
}

// null means the panel is ready to compute; a string is the one thing the user
// has to do first.
export function describeCnrQualificationProblemOrNull(
  panel: MaskPanelState | null,
): string | null {
  if (panel === null) return CNR_NEEDS_A_SELECTED_STACK;
  if (panel.layers.length === 0) return CNR_NEEDS_A_MASK_LAYER;
  if (listMaskLayersQualifyingForCnr(panel).length === 0) {
    return CNR_NEEDS_TWO_PAINTED_CATEGORIES;
  }
  return null;
}
