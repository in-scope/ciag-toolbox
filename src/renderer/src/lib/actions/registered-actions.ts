import type { ComponentType, SVGProps } from "react";
import { ChevronsLeft, Contrast } from "lucide-react";

import { applyBitShiftToRasterImage } from "@/lib/image/apply-bit-shift";
import type { IntegerParameterSchema } from "./parameter-schema";
import type { ParameterValuesById } from "./parameter-schema";
import type { ViewportAction, ViewportActionSourceTransform } from "./viewport-action";

export type RegisteredActionIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface RegisteredViewportAction extends ViewportAction {
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly appliedLabel: string;
  readonly formatAppliedLabel?: (parameterValues: ParameterValuesById) => string;
}

export const NORMALIZE_ACTION: RegisteredViewportAction = {
  id: "normalize",
  label: "Normalize",
  icon: Contrast,
  successMessage: "Normalization applied",
  appliedLabel: "Normalized",
  apply: (state) => ({ ...state, normalizationEnabled: true }),
};

const BIT_SHIFT_PARAMETER_ID = "shiftAmount";

const BIT_SHIFT_PARAMETER_SCHEMA: IntegerParameterSchema = {
  kind: "integer",
  id: BIT_SHIFT_PARAMETER_ID,
  label: "Shift amount",
  description: "Number of bits to shift each pixel value to the left.",
  defaultValue: 4,
  min: 0,
  max: 8,
};

export const BIT_SHIFT_ACTION: RegisteredViewportAction = {
  id: "bit-shift",
  label: "Bit Shift",
  icon: ChevronsLeft,
  parameters: [BIT_SHIFT_PARAMETER_SCHEMA],
  successMessage: "Bit shift applied",
  appliedLabel: "Bit shift",
  formatAppliedLabel: (parameterValues) =>
    `Bit shift +${readBitShiftAmountFromParameterValues(parameterValues)}`,
  apply: (state) => state,
  transformSource: createBitShiftSourceTransform(),
};

function createBitShiftSourceTransform(): ViewportActionSourceTransform {
  return (source, parameterValues) => {
    if (source.kind !== "raster") {
      throw new Error(
        "Bit shift only applies to raster images (TIFF, ENVI, raw camera). The active viewport's source is not a raster.",
      );
    }
    const shiftAmount = readBitShiftAmountFromParameterValues(parameterValues);
    return { kind: "raster", raster: applyBitShiftToRasterImage(source.raster, shiftAmount) };
  };
}

function readBitShiftAmountFromParameterValues(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[BIT_SHIFT_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return BIT_SHIFT_PARAMETER_SCHEMA.defaultValue;
  }
  return Math.round(raw);
}

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  NORMALIZE_ACTION,
  BIT_SHIFT_ACTION,
];
