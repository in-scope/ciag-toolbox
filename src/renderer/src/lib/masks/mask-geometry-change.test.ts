import { describe, expect, it } from "vitest";

import {
  didStackGeometryChange,
  wereMasksDroppedByGeometryChange,
  type StackGeometryComparison,
} from "./mask-geometry-change";
import { addNewMaskLayerToPanel, EMPTY_MASK_PANEL_STATE } from "./mask-panel";

function buildComparison(
  overrides: Partial<StackGeometryComparison> = {},
): StackGeometryComparison {
  return {
    actionChangesStackGeometry: false,
    previousWidth: 4,
    previousHeight: 4,
    nextWidth: 4,
    nextHeight: 4,
    ...overrides,
  };
}

const PANEL_WITH_ONE_LAYER = addNewMaskLayerToPanel(EMPTY_MASK_PANEL_STATE, 4, 4);

describe("stack geometry change detection", () => {
  it("treats a value operation on unchanged dimensions as no change", () => {
    expect(didStackGeometryChange(buildComparison())).toBe(false);
  });

  it("treats a resized result as a change", () => {
    expect(didStackGeometryChange(buildComparison({ nextWidth: 2 }))).toBe(true);
    expect(didStackGeometryChange(buildComparison({ nextHeight: 9 }))).toBe(true);
  });

  // A flip, and a rotation of a square stack, keep width and height while
  // moving every pixel, so the action's own declaration is what catches them.
  it("treats a geometry-declaring action as a change even at identical dimensions", () => {
    expect(didStackGeometryChange(buildComparison({ actionChangesStackGeometry: true }))).toBe(
      true,
    );
  });
});

describe("reporting a mask drop", () => {
  it("reports a drop when a populated panel became empty", () => {
    expect(wereMasksDroppedByGeometryChange(PANEL_WITH_ONE_LAYER, EMPTY_MASK_PANEL_STATE)).toBe(
      true,
    );
  });

  it("reports no drop when the layers survived", () => {
    expect(wereMasksDroppedByGeometryChange(PANEL_WITH_ONE_LAYER, PANEL_WITH_ONE_LAYER)).toBe(
      false,
    );
  });

  it("reports no drop when the panel had no masks to begin with", () => {
    expect(
      wereMasksDroppedByGeometryChange(EMPTY_MASK_PANEL_STATE, EMPTY_MASK_PANEL_STATE),
    ).toBe(false);
  });
});
