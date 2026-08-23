import type { MaskLayer } from "@/lib/masks/mask-layer";
import { readRememberedMaskLayerOrNull } from "@/lib/masks/mask-layer-reference-store";
import { listNonEmptyCategoryValuesInMaskLayer } from "@/lib/analysis/npc-qualification";

import {
  NO_MASK_LAYER_SELECTED,
  readMaskLayerIdOrEmpty,
  type MaskLayerParameterSchema,
  type NumberParameterSchema,
  type ParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "./parameter-schema";

// CT-313: the tunables of resources/builtin-python/l2_minimization.py's
// run(cube, wavelengths, params): a mask layer (its first two non-empty
// categories become the script's lowerMask/upperMask, in category order) plus
// lowerVal/upperVal, each defaulting to the script's own default (0.0/1.0).

export const L2_MASK_LAYER_PARAMETER_ID = "l2MaskLayer";
export const L2_LOWER_VALUE_PARAMETER_ID = "l2LowerValue";
export const L2_UPPER_VALUE_PARAMETER_ID = "l2UpperValue";

export const DEFAULT_L2_LOWER_VALUE = 0.0;
export const DEFAULT_L2_UPPER_VALUE = 1.0;

export interface L2MinimizationSettings {
  readonly maskLayerId: string;
  readonly lowerVal: number;
  readonly upperVal: number;
}

export function buildL2MinimizationParameterSchemas(): ReadonlyArray<ParameterSchema> {
  return [
    buildMaskLayerParameterSchema(),
    buildLowerValueParameterSchema(),
    buildUpperValueParameterSchema(),
  ];
}

function buildMaskLayerParameterSchema(): MaskLayerParameterSchema {
  return {
    kind: "mask-layer",
    id: L2_MASK_LAYER_PARAMETER_ID,
    label: "Mask layer",
    description:
      "The layer's first two painted categories become the lower and upper class the fit targets.",
    defaultValue: NO_MASK_LAYER_SELECTED,
  };
}

function buildLowerValueParameterSchema(): NumberParameterSchema {
  return {
    kind: "number",
    id: L2_LOWER_VALUE_PARAMETER_ID,
    label: "Lower value",
    description: "Target output value for pixels in the layer's first painted category.",
    defaultValue: DEFAULT_L2_LOWER_VALUE,
  };
}

function buildUpperValueParameterSchema(): NumberParameterSchema {
  return {
    kind: "number",
    id: L2_UPPER_VALUE_PARAMETER_ID,
    label: "Upper value",
    description: "Target output value for pixels in the layer's second painted category.",
    defaultValue: DEFAULT_L2_UPPER_VALUE,
  };
}

export function readL2MinimizationSettings(
  parameterValues: ParameterValuesById,
): L2MinimizationSettings {
  return {
    maskLayerId: readMaskLayerIdOrEmpty(parameterValues[L2_MASK_LAYER_PARAMETER_ID]),
    lowerVal: readNumberOrDefault(parameterValues[L2_LOWER_VALUE_PARAMETER_ID], DEFAULT_L2_LOWER_VALUE),
    upperVal: readNumberOrDefault(parameterValues[L2_UPPER_VALUE_PARAMETER_ID], DEFAULT_L2_UPPER_VALUE),
  };
}

function readNumberOrDefault(value: ParameterValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// The params dict run(cube, wavelengths, params) receives; the keys are the
// built-in script's own parameter names.
export function buildL2ExecuteParams(settings: L2MinimizationSettings): Record<string, unknown> {
  return { lowerVal: settings.lowerVal, upperVal: settings.upperVal };
}

// l2_minimization.py reads masks[0] as the lower class and masks[1] as the
// upper class - the FIRST TWO non-empty category values of the chosen layer,
// in category order (not every category, unlike NPC's per-category scoring).
export function buildL2MaskArraysFromLayer(layer: MaskLayer): Uint8Array[] {
  const [lowerValue, upperValue] = listNonEmptyCategoryValuesInMaskLayer(layer);
  if (lowerValue === undefined || upperValue === undefined) {
    throw new Error("Choose a mask layer with at least two painted categories.");
  }
  return [
    selectPixelsPaintedWithCategoryValue(layer.values, lowerValue),
    selectPixelsPaintedWithCategoryValue(layer.values, upperValue),
  ];
}

function selectPixelsPaintedWithCategoryValue(
  values: Uint8Array,
  categoryValue: number,
): Uint8Array {
  const selected = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    selected[index] = values[index] === categoryValue ? 1 : 0;
  }
  return selected;
}

// formatAppliedLabel only receives ParameterValuesById (RegisteredViewportAction's
// contract), so the mask layer's human name is resolved through the SAME
// reference store transformSourceAsync uses - it is still populated at label
// time because the field only clears entries on the next sync, never on
// unmount, and the panel is still open when Apply resolves the label.
export function formatL2AppliedLabel(parameterValues: ParameterValuesById): string {
  const settings = readL2MinimizationSettings(parameterValues);
  const layerName = readRememberedMaskLayerOrNull(settings.maskLayerId)?.name ?? "no mask layer";
  return `L2 Minimization (${layerName}, lower ${settings.lowerVal}, upper ${settings.upperVal})`;
}
