import { describe, expect, it } from "vitest";

import {
  addNewMaskLayerToPanel,
  deleteMaskLayerFromPanel,
  EMPTY_MASK_PANEL_STATE,
  findSelectedMaskLayerOrNull,
  panelHasMaskLayers,
  renameMaskLayerInPanel,
  replaceMaskLayerInPanel,
  selectMaskLayerInPanel,
  type MaskPanelState,
} from "./mask-panel";
import { setMaskLayerOpacityPercent } from "./mask-layer";

function buildPanelWithLayers(count: number): MaskPanelState {
  let panel = EMPTY_MASK_PANEL_STATE;
  for (let added = 0; added < count; added += 1) panel = addNewMaskLayerToPanel(panel, 4, 3);
  return panel;
}

describe("mask panel layers", () => {
  it("starts empty", () => {
    expect(panelHasMaskLayers(EMPTY_MASK_PANEL_STATE)).toBe(false);
    expect(findSelectedMaskLayerOrNull(EMPTY_MASK_PANEL_STATE)).toBeNull();
  });

  it("names and selects each new layer, with no cap on the count", () => {
    const panel = buildPanelWithLayers(7);
    expect(panel.layers.map((layer) => layer.name)).toEqual([
      "Mask 1",
      "Mask 2",
      "Mask 3",
      "Mask 4",
      "Mask 5",
      "Mask 6",
      "Mask 7",
    ]);
    expect(findSelectedMaskLayerOrNull(panel)?.name).toBe("Mask 7");
  });

  it("keeps exactly one layer selected", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(3), "mask-1");
    expect(panel.selectedLayerId).toBe("mask-1");
    expect(selectMaskLayerInPanel(panel, "mask-404")).toBe(panel);
  });

  it("renames one layer and replaces one layer in place", () => {
    const panel = buildPanelWithLayers(2);
    const renamed = renameMaskLayerInPanel(panel, "mask-1", "Sample area");
    const dimmed = replaceMaskLayerInPanel(renamed, "mask-2", (layer) =>
      setMaskLayerOpacityPercent(layer, 20),
    );
    expect(dimmed.layers.map((layer) => layer.name)).toEqual(["Sample area", "Mask 2"]);
    expect(dimmed.layers.map((layer) => layer.opacityPercent)).toEqual([50, 20]);
  });

  it("moves the selection to the layer that took the deleted one's place", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(3), "mask-2");
    expect(deleteMaskLayerFromPanel(panel, "mask-2").selectedLayerId).toBe("mask-3");
  });

  it("keeps the selection when another layer is deleted", () => {
    const panel = selectMaskLayerInPanel(buildPanelWithLayers(3), "mask-2");
    expect(deleteMaskLayerFromPanel(panel, "mask-1").selectedLayerId).toBe("mask-2");
  });

  it("clears the selection when the last layer is deleted", () => {
    const panel = deleteMaskLayerFromPanel(buildPanelWithLayers(1), "mask-1");
    expect(panel).toEqual(EMPTY_MASK_PANEL_STATE);
  });

  it("never reuses a layer id after a delete", () => {
    const afterDelete = deleteMaskLayerFromPanel(buildPanelWithLayers(2), "mask-1");
    const readded = addNewMaskLayerToPanel(afterDelete, 4, 3);
    expect(readded.layers.map((layer) => layer.id)).toEqual(["mask-2", "mask-3"]);
  });
});
