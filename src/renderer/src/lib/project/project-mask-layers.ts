import { buildMaskCategoryAtIndex, type MaskLayer, type MaskLayerContent } from "@/lib/masks/mask-layer";
import {
  addImportedMaskLayerToPanel,
  EMPTY_MASK_PANEL_STATE,
  selectMaskLayerInPanel,
  type MaskPanelState,
} from "@/lib/masks/mask-panel";

import type { ProjectMaskCategory, ProjectMaskLayer } from "./project-schema";

// CT-306: translates between a panel's live mask state and the manifest shape a
// bundle stores. Pixel data is deliberately absent from both directions here -
// the manifest only names and colours a layer, while its category indexes ride
// in the PNG asset the bundle writer places at the layer's relativePath.

// Everything a saved mask layer records apart from its asset path, which the
// bundle writer assigns from the viewport index and the layer's position.
export type MaskLayerManifestFields = Omit<ProjectMaskLayer, "relativePath">;

export function describeMaskLayerForManifest(layer: MaskLayer): MaskLayerManifestFields {
  return {
    name: layer.name,
    width: layer.width,
    height: layer.height,
    categories: layer.categories.map(describeMaskCategoryForManifest),
    opacityPercent: layer.opacityPercent,
  };
}

function describeMaskCategoryForManifest(category: {
  name: string;
  color: string;
}): ProjectMaskCategory {
  return { name: category.name, color: category.color };
}

export function findSelectedMaskLayerPositionOrNull(panel: MaskPanelState): number | null {
  const position = panel.layers.findIndex((layer) => layer.id === panel.selectedLayerId);
  return position < 0 ? null : position;
}

export interface RestorableMaskLayer {
  readonly manifest: ProjectMaskLayer;
  readonly values: Uint8Array;
}

export function buildMaskPanelStateFromRestoredLayers(
  restored: ReadonlyArray<RestorableMaskLayer>,
  selectedMaskIndex: number | null,
): MaskPanelState {
  const panel = restored.reduce(appendRestoredLayerToPanel, EMPTY_MASK_PANEL_STATE);
  return selectRestoredLayerAtPositionOrKeepLast(panel, selectedMaskIndex);
}

function appendRestoredLayerToPanel(
  panel: MaskPanelState,
  layer: RestorableMaskLayer,
): MaskPanelState {
  return addImportedMaskLayerToPanel(panel, buildMaskLayerContentFromManifest(layer));
}

function buildMaskLayerContentFromManifest(layer: RestorableMaskLayer): MaskLayerContent {
  return {
    name: layer.manifest.name,
    width: layer.manifest.width,
    height: layer.manifest.height,
    values: layer.values,
    categories: layer.manifest.categories.map(buildRestoredCategoryAtPosition),
    opacityPercent: layer.manifest.opacityPercent,
  };
}

function buildRestoredCategoryAtPosition(category: ProjectMaskCategory, position: number) {
  return buildMaskCategoryAtIndex(position, category.name, category.color);
}

// Appending selects each layer in turn, so the last one is selected by default;
// a recorded selection moves it back to the layer the user was working on.
function selectRestoredLayerAtPositionOrKeepLast(
  panel: MaskPanelState,
  selectedMaskIndex: number | null,
): MaskPanelState {
  const selectedLayerId = selectedMaskIndex === null ? null : panel.layers[selectedMaskIndex]?.id;
  if (!selectedLayerId) return panel;
  return selectMaskLayerInPanel(panel, selectedLayerId);
}
