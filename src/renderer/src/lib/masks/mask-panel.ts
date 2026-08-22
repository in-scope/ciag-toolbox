import { buildNextPrefixedIdentifier, findNextFreeNumberForPrefix } from "@/lib/masks/mask-identifiers";
import { createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";

// CT-302: a panel holds any number of mask layers (no fixed cap; the renderer's
// memory budget governs) and exactly one of them is selected at a time. Only
// the selected layer renders as an overlay.

export interface MaskPanelState {
  readonly layers: ReadonlyArray<MaskLayer>;
  readonly selectedLayerId: string | null;
}

export const EMPTY_MASK_PANEL_STATE: MaskPanelState = Object.freeze({
  layers: Object.freeze([]),
  selectedLayerId: null,
});

const MASK_LAYER_ID_PREFIX = "mask";

export function panelHasMaskLayers(panel: MaskPanelState): boolean {
  return panel.layers.length > 0;
}

export function findSelectedMaskLayerOrNull(panel: MaskPanelState): MaskLayer | null {
  return panel.layers.find((layer) => layer.id === panel.selectedLayerId) ?? null;
}

export function addNewMaskLayerToPanel(
  panel: MaskPanelState,
  width: number,
  height: number,
): MaskPanelState {
  const added = buildNextMaskLayerForPanel(panel, width, height);
  return { layers: [...panel.layers, added], selectedLayerId: added.id };
}

function buildNextMaskLayerForPanel(
  panel: MaskPanelState,
  width: number,
  height: number,
): MaskLayer {
  const existingIds = panel.layers.map((layer) => layer.id);
  const id = buildNextPrefixedIdentifier(MASK_LAYER_ID_PREFIX, existingIds);
  const name = `Mask ${findNextFreeNumberForPrefix(MASK_LAYER_ID_PREFIX, existingIds)}`;
  return createMaskLayer(id, name, width, height);
}

export function selectMaskLayerInPanel(panel: MaskPanelState, layerId: string): MaskPanelState {
  if (!panel.layers.some((layer) => layer.id === layerId)) return panel;
  return { ...panel, selectedLayerId: layerId };
}

export function renameMaskLayerInPanel(
  panel: MaskPanelState,
  layerId: string,
  name: string,
): MaskPanelState {
  return replaceMaskLayerInPanel(panel, layerId, (layer) => ({ ...layer, name }));
}

export function replaceMaskLayerInPanel(
  panel: MaskPanelState,
  layerId: string,
  replace: (layer: MaskLayer) => MaskLayer,
): MaskPanelState {
  const layers = panel.layers.map((layer) => (layer.id === layerId ? replace(layer) : layer));
  return { ...panel, layers };
}

export function deleteMaskLayerFromPanel(
  panel: MaskPanelState,
  layerId: string,
): MaskPanelState {
  const position = panel.layers.findIndex((layer) => layer.id === layerId);
  if (position < 0) return panel;
  const layers = panel.layers.filter((layer) => layer.id !== layerId);
  return { layers, selectedLayerId: pickSelectionAfterDelete(panel, layers, position) };
}

// The selection lands on the layer that took the deleted one's place, or on the
// new last layer when the deleted one was last.
function pickSelectionAfterDelete(
  panel: MaskPanelState,
  layers: ReadonlyArray<MaskLayer>,
  deletedPosition: number,
): string | null {
  if (panel.selectedLayerId !== panel.layers[deletedPosition]?.id) return panel.selectedLayerId;
  const nextPosition = Math.min(deletedPosition, layers.length - 1);
  return layers[nextPosition]?.id ?? null;
}
