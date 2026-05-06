import type { ComponentType, SVGProps } from "react";
import { ChevronsLeft, Contrast, Crop } from "lucide-react";

import { applyBitShiftToRasterImage } from "@/lib/image/apply-bit-shift";
import { applyCropToRasterImage } from "@/lib/image/apply-crop-to-roi";
import { canonicalizeViewportRoiCorners } from "@/lib/image/viewport-roi";
import type { IntegerParameterSchema } from "./parameter-schema";
import type { ParameterValuesById } from "./parameter-schema";
import type { ViewportAction, ViewportActionSourceTransform } from "./viewport-action";
import type { ViewportRenderingState } from "./viewport-action";

export type RegisteredActionIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface RegisteredViewportAction extends ViewportAction {
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly appliedLabel: string;
  readonly formatAppliedLabel?: (parameterValues: ParameterValuesById) => string;
  readonly prepareParameterValuesForApply?: (
    rawParameterValues: ParameterValuesById,
    sourceRenderingState: ViewportRenderingState,
  ) => ParameterValuesById;
  readonly isAvailableForActiveViewport?: (
    sourceRenderingState: ViewportRenderingState,
  ) => boolean;
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

const CROP_PARAMETER_ID_X0 = "imagePixelX0";
const CROP_PARAMETER_ID_Y0 = "imagePixelY0";
const CROP_PARAMETER_ID_X1 = "imagePixelX1";
const CROP_PARAMETER_ID_Y1 = "imagePixelY1";

export const CROP_TO_REGION_ACTION: RegisteredViewportAction = {
  id: "crop-to-region",
  label: "Crop to Region",
  icon: Crop,
  successMessage: "Crop to region applied",
  appliedLabel: "Crop to region",
  formatAppliedLabel: formatCropToRegionAppliedLabel,
  prepareParameterValuesForApply: prepareCropParameterValuesFromActiveRoi,
  isAvailableForActiveViewport: (state) => state.roi !== null,
  apply: clearRoiAfterCropApply,
  transformSource: createCropToRegionSourceTransform(),
};

function clearRoiAfterCropApply(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, roi: null };
}

function prepareCropParameterValuesFromActiveRoi(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const roi = sourceRenderingState.roi;
  if (!roi) {
    throw new Error("Crop to Region requires an active region. Draw a region first.");
  }
  return Object.freeze({
    ...rawParameterValues,
    [CROP_PARAMETER_ID_X0]: roi.imagePixelX0,
    [CROP_PARAMETER_ID_Y0]: roi.imagePixelY0,
    [CROP_PARAMETER_ID_X1]: roi.imagePixelX1,
    [CROP_PARAMETER_ID_Y1]: roi.imagePixelY1,
  });
}

function createCropToRegionSourceTransform(): ViewportActionSourceTransform {
  return (source, parameterValues) => {
    if (source.kind !== "raster") {
      throw new Error(
        "Crop to Region only applies to raster images (TIFF, ENVI, raw camera). The active viewport's source is not a raster.",
      );
    }
    const roi = readRoiFromCropParameterValues(parameterValues);
    return { kind: "raster", raster: applyCropToRasterImage(source.raster, roi) };
  };
}

function readRoiFromCropParameterValues(parameterValues: ParameterValuesById) {
  return {
    imagePixelX0: readIntegerParameterOrThrow(parameterValues, CROP_PARAMETER_ID_X0),
    imagePixelY0: readIntegerParameterOrThrow(parameterValues, CROP_PARAMETER_ID_Y0),
    imagePixelX1: readIntegerParameterOrThrow(parameterValues, CROP_PARAMETER_ID_X1),
    imagePixelY1: readIntegerParameterOrThrow(parameterValues, CROP_PARAMETER_ID_Y1),
  };
}

function readIntegerParameterOrThrow(
  parameterValues: ParameterValuesById,
  parameterId: string,
): number {
  const raw = parameterValues[parameterId];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`Crop to Region missing parameter ${parameterId}.`);
  }
  return Math.round(raw);
}

function formatCropToRegionAppliedLabel(parameterValues: ParameterValuesById): string {
  const canonical = canonicalizeViewportRoiCorners(readRoiFromCropParameterValues(parameterValues));
  return `Crop to (${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`;
}

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  NORMALIZE_ACTION,
  BIT_SHIFT_ACTION,
  CROP_TO_REGION_ACTION,
];
