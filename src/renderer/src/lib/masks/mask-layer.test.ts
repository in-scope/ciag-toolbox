import { describe, expect, it } from "vitest";

import {
  addCategoryToLayer,
  canAddCategoryToLayer,
  canDeleteCategoryFromLayer,
  createMaskLayer,
  DEFAULT_MASK_CATEGORY_COLORS,
  DEFAULT_MASK_LAYER_OPACITY_PERCENT,
  deleteCategoryFromLayer,
  doesMaskLayerCoverDimensions,
  MAX_MASK_CATEGORY_COUNT,
  recolorCategoryInLayer,
  renameCategoryInLayer,
  setMaskLayerOpacityPercent,
  type MaskLayer,
} from "./mask-layer";

function buildLayer(): MaskLayer {
  return createMaskLayer("mask-1", "Mask 1", 4, 3);
}

function addCategoriesUntilFull(layer: MaskLayer): MaskLayer {
  let filled = layer;
  while (canAddCategoryToLayer(filled)) filled = addCategoryToLayer(filled);
  return filled;
}

describe("mask layer defaults", () => {
  it("covers the stack's spatial grid with unlabeled pixels", () => {
    const layer = buildLayer();
    expect(layer.values).toHaveLength(12);
    expect([...layer.values].every((value) => value === 0)).toBe(true);
    expect(doesMaskLayerCoverDimensions(layer, 4, 3)).toBe(true);
    expect(doesMaskLayerCoverDimensions(layer, 3, 4)).toBe(false);
  });

  it("starts with Foreground and Background in the default colors", () => {
    const layer = buildLayer();
    expect(layer.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "Background",
    ]);
    expect(layer.categories.map((category) => category.color)).toEqual([
      DEFAULT_MASK_CATEGORY_COLORS[0],
      DEFAULT_MASK_CATEGORY_COLORS[1],
    ]);
  });

  it("starts at 50% opacity", () => {
    expect(buildLayer().opacityPercent).toBe(DEFAULT_MASK_LAYER_OPACITY_PERCENT);
    expect(DEFAULT_MASK_LAYER_OPACITY_PERCENT).toBe(50);
  });
});

describe("mask categories", () => {
  it("adds categories in default color order up to the cap of five", () => {
    const filled = addCategoriesUntilFull(buildLayer());
    expect(filled.categories).toHaveLength(MAX_MASK_CATEGORY_COUNT);
    expect(filled.categories.map((category) => category.color)).toEqual([
      ...DEFAULT_MASK_CATEGORY_COLORS,
    ]);
    expect(canAddCategoryToLayer(filled)).toBe(false);
  });

  it("leaves the layer unchanged when adding past the cap", () => {
    const filled = addCategoriesUntilFull(buildLayer());
    expect(addCategoryToLayer(filled)).toBe(filled);
  });

  it("never reuses a category id after a delete", () => {
    const layer = buildLayer();
    const afterDelete = deleteCategoryFromLayer(layer, layer.categories[0]!.id);
    const readded = addCategoryToLayer(afterDelete);
    const ids = readded.categories.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renames and recolors one category without touching the others", () => {
    const layer = buildLayer();
    const renamed = renameCategoryInLayer(layer, layer.categories[0]!.id, "Ink");
    const recolored = recolorCategoryInLayer(renamed, renamed.categories[1]!.id, "#123456");
    expect(recolored.categories[0]).toEqual({ ...layer.categories[0]!, name: "Ink" });
    expect(recolored.categories[1]).toEqual({ ...layer.categories[1]!, color: "#123456" });
  });

  it("refuses to delete the last remaining category", () => {
    const layer = buildLayer();
    const single = deleteCategoryFromLayer(layer, layer.categories[1]!.id);
    expect(canDeleteCategoryFromLayer(single)).toBe(false);
    expect(deleteCategoryFromLayer(single, single.categories[0]!.id)).toBe(single);
  });

  it("unlabels the deleted category's pixels and shifts the higher ones down", () => {
    const layer = addCategoryToLayer(buildLayer());
    layer.values.set([0, 1, 2, 3], 0);
    const remaining = deleteCategoryFromLayer(layer, layer.categories[1]!.id);
    expect([...remaining.values].slice(0, 4)).toEqual([0, 1, 0, 2]);
    expect(remaining.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "Category 3",
    ]);
  });
});

describe("mask layer opacity", () => {
  it("clamps and rounds the requested percentage", () => {
    const layer = buildLayer();
    expect(setMaskLayerOpacityPercent(layer, 12.4).opacityPercent).toBe(12);
    expect(setMaskLayerOpacityPercent(layer, -5).opacityPercent).toBe(0);
    expect(setMaskLayerOpacityPercent(layer, 140).opacityPercent).toBe(100);
    expect(setMaskLayerOpacityPercent(layer, Number.NaN).opacityPercent).toBe(
      DEFAULT_MASK_LAYER_OPACITY_PERCENT,
    );
  });
});
