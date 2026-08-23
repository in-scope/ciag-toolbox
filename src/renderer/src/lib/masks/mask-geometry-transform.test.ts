import { describe, expect, it } from "vitest";

import { applyGeometricTransformToPlane } from "@/lib/image/apply-geometric-transform";
import { cropPlaneToRoi } from "@/lib/image/apply-crop-to-roi";
import type { StackGeometryComparison } from "./mask-geometry-change";
import {
  carryMasksAcrossStackGeometryChange,
  type MaskPlaneTransform,
} from "./mask-geometry-transform";
import { addNewMaskLayerToPanel, EMPTY_MASK_PANEL_STATE, type MaskPanelState } from "./mask-panel";

function buildComparison(
  overrides: Partial<StackGeometryComparison> = {},
): StackGeometryComparison {
  return {
    actionChangesStackGeometry: true,
    previousWidth: 3,
    previousHeight: 2,
    nextWidth: 3,
    nextHeight: 2,
    ...overrides,
  };
}

// A 3x2 painted layer whose values make every spatial move observable:
//   1 0 2
//   0 3 0
function buildPanelWithPaintedThreeByTwoLayer(): MaskPanelState {
  const panel = addNewMaskLayerToPanel(EMPTY_MASK_PANEL_STATE, 3, 2);
  const layer = panel.layers[0]!;
  return {
    ...panel,
    layers: [{ ...layer, values: Uint8Array.from([1, 0, 2, 0, 3, 0]) }],
  };
}

const ROTATE_90: MaskPlaneTransform = (plane) =>
  applyGeometricTransformToPlane(plane.values, plane.width, plane.height, "rotate-90-cw");

const FLIP_HORIZONTAL: MaskPlaneTransform = (plane) =>
  applyGeometricTransformToPlane(plane.values, plane.width, plane.height, "flip-horizontal");

describe("carrying masks across a stack geometry change", () => {
  it("returns the panel untouched when the geometry did not change", () => {
    const panel = buildPanelWithPaintedThreeByTwoLayer();
    const unchanged = buildComparison({ actionChangesStackGeometry: false });
    expect(carryMasksAcrossStackGeometryChange(panel, unchanged, ROTATE_90)).toBe(panel);
  });

  it("returns an empty panel untouched even with no transform", () => {
    expect(
      carryMasksAcrossStackGeometryChange(EMPTY_MASK_PANEL_STATE, buildComparison(), null),
    ).toBe(EMPTY_MASK_PANEL_STATE);
  });

  it("drops every layer when the geometry changed with no known mapping", () => {
    const panel = buildPanelWithPaintedThreeByTwoLayer();
    expect(carryMasksAcrossStackGeometryChange(panel, buildComparison(), null)).toEqual(
      EMPTY_MASK_PANEL_STATE,
    );
  });

  it("rotates every layer with the stack, swapping the layer's dimensions", () => {
    const panel = buildPanelWithPaintedThreeByTwoLayer();
    const rotated = carryMasksAcrossStackGeometryChange(
      panel,
      buildComparison({ nextWidth: 2, nextHeight: 3 }),
      ROTATE_90,
    );
    const layer = rotated.layers[0]!;
    expect(layer.width).toBe(2);
    expect(layer.height).toBe(3);
    expect(Array.from(layer.values)).toEqual([0, 1, 3, 0, 0, 2]);
    expect(layer.name).toBe(panel.layers[0]!.name);
    expect(layer.categories).toBe(panel.layers[0]!.categories);
    expect(rotated.selectedLayerId).toBe(panel.selectedLayerId);
  });

  it("flips every layer in place at unchanged dimensions", () => {
    const panel = buildPanelWithPaintedThreeByTwoLayer();
    const flipped = carryMasksAcrossStackGeometryChange(panel, buildComparison(), FLIP_HORIZONTAL);
    expect(Array.from(flipped.layers[0]!.values)).toEqual([2, 0, 1, 0, 3, 0]);
  });

  it("crops every layer to the same rectangle as the stack", () => {
    const panel = buildPanelWithPaintedThreeByTwoLayer();
    const cropToLeftTwoColumns: MaskPlaneTransform = (plane) =>
      cropPlaneToRoi(plane.values, plane.width, plane.height, {
        imagePixelX0: 0,
        imagePixelY0: 0,
        imagePixelX1: 1,
        imagePixelY1: 1,
      });
    const cropped = carryMasksAcrossStackGeometryChange(
      panel,
      buildComparison({ nextWidth: 2, nextHeight: 2 }),
      cropToLeftTwoColumns,
    );
    const layer = cropped.layers[0]!;
    expect([layer.width, layer.height]).toEqual([2, 2]);
    expect(Array.from(layer.values)).toEqual([1, 0, 0, 3]);
  });

  it("drops the masks when a transform disagrees with the stack's result dimensions", () => {
    const panel = buildPanelWithPaintedThreeByTwoLayer();
    const dropped = carryMasksAcrossStackGeometryChange(
      panel,
      buildComparison({ nextWidth: 5, nextHeight: 5 }),
      FLIP_HORIZONTAL,
    );
    expect(dropped).toEqual(EMPTY_MASK_PANEL_STATE);
  });
});
