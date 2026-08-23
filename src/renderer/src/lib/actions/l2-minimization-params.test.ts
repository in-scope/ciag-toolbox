import { afterEach, describe, expect, it } from "vitest";

import { addCategoryToLayer, createMaskLayer, type MaskLayer } from "@/lib/masks/mask-layer";
import { syncRememberedMaskLayers } from "@/lib/masks/mask-layer-reference-store";

import {
  buildL2ExecuteParams,
  buildL2MaskArraysFromLayer,
  buildL2MinimizationParameterSchemas,
  DEFAULT_L2_LOWER_VALUE,
  DEFAULT_L2_UPPER_VALUE,
  formatL2AppliedLabel,
  L2_LOWER_VALUE_PARAMETER_ID,
  L2_MASK_LAYER_PARAMETER_ID,
  L2_UPPER_VALUE_PARAMETER_ID,
  readL2MinimizationSettings,
} from "./l2-minimization-params";

// CT-313: the panel must expose every parameter
// l2_binarization_approximation.py's run() reads from params - the mask layer
// plus lowerVal/upperVal - each defaulting to the script's own default (the
// pinned parity reference ran with params: {}).

function buildLayerPaintedWith(id: string, painted: ReadonlyArray<number>): MaskLayer {
  const layer = addCategoryToLayer(createMaskLayer(id, `Layer ${id}`, 2, 2));
  return { ...layer, values: Uint8Array.from(painted) };
}

afterEach(() => {
  syncRememberedMaskLayers([]);
});

describe("buildL2MinimizationParameterSchemas", () => {
  it("offers the mask layer picker and the two target values", () => {
    const schemas = buildL2MinimizationParameterSchemas();
    expect(schemas.map((schema) => schema.id)).toEqual([
      L2_MASK_LAYER_PARAMETER_ID,
      L2_LOWER_VALUE_PARAMETER_ID,
      L2_UPPER_VALUE_PARAMETER_ID,
    ]);
    expect(schemas.map((schema) => schema.label)).toEqual([
      "Mask layer",
      "Lower value",
      "Upper value",
    ]);
  });

  it("defaults every field to the built-in script's own default", () => {
    const defaults = buildL2MinimizationParameterSchemas().map(
      (schema) => (schema as { defaultValue: unknown }).defaultValue,
    );
    expect(defaults).toEqual(["", DEFAULT_L2_LOWER_VALUE, DEFAULT_L2_UPPER_VALUE]);
  });
});

describe("readL2MinimizationSettings", () => {
  it("falls back to the script defaults when the panel has no values yet", () => {
    expect(readL2MinimizationSettings({})).toEqual({
      maskLayerId: "",
      lowerVal: DEFAULT_L2_LOWER_VALUE,
      upperVal: DEFAULT_L2_UPPER_VALUE,
    });
  });

  it("reads a chosen layer id and explicit target values", () => {
    expect(
      readL2MinimizationSettings({
        [L2_MASK_LAYER_PARAMETER_ID]: "mask-1",
        [L2_LOWER_VALUE_PARAMETER_ID]: -2.5,
        [L2_UPPER_VALUE_PARAMETER_ID]: 10,
      }),
    ).toEqual({ maskLayerId: "mask-1", lowerVal: -2.5, upperVal: 10 });
  });
});

describe("buildL2ExecuteParams", () => {
  it("sends the script's own parameter names", () => {
    expect(buildL2ExecuteParams(readL2MinimizationSettings({}))).toEqual({
      lowerVal: DEFAULT_L2_LOWER_VALUE,
      upperVal: DEFAULT_L2_UPPER_VALUE,
    });
  });
});

describe("buildL2MaskArraysFromLayer", () => {
  it("builds lowerMask/upperMask from the first two painted categories, in category order", () => {
    const layer = buildLayerPaintedWith("mask-1", [1, 2, 0, 1]);
    const [lowerMask, upperMask] = buildL2MaskArraysFromLayer(layer);
    expect(Array.from(lowerMask!)).toEqual([1, 0, 0, 1]);
    expect(Array.from(upperMask!)).toEqual([0, 1, 0, 0]);
  });

  it("ignores a third painted category", () => {
    const layer = addCategoryToLayer(buildLayerPaintedWith("mask-1", [1, 2, 3, 0]));
    const masks = buildL2MaskArraysFromLayer(layer);
    expect(masks).toHaveLength(2);
  });

  it("refuses a layer with fewer than two painted categories", () => {
    expect(() => buildL2MaskArraysFromLayer(buildLayerPaintedWith("mask-1", [1, 1, 0, 0]))).toThrow(
      "at least two painted categories",
    );
  });
});

describe("formatL2AppliedLabel", () => {
  it("names the chosen mask layer and both target values", () => {
    syncRememberedMaskLayers([buildLayerPaintedWith("mask-1", [1, 2, 0, 0])]);
    expect(
      formatL2AppliedLabel({
        [L2_MASK_LAYER_PARAMETER_ID]: "mask-1",
        [L2_LOWER_VALUE_PARAMETER_ID]: 0,
        [L2_UPPER_VALUE_PARAMETER_ID]: 1,
      }),
    ).toBe("L2 Minimization (Layer mask-1, lower 0, upper 1)");
  });

  it("falls back gracefully when the layer cannot be resolved", () => {
    expect(formatL2AppliedLabel({})).toBe(
      `L2 Minimization (no mask layer, lower ${DEFAULT_L2_LOWER_VALUE}, upper ${DEFAULT_L2_UPPER_VALUE})`,
    );
  });
});
