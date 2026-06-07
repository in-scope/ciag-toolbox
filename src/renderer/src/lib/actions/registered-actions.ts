import type { ComponentType, SVGProps } from "react";
import { ChevronsLeft, Crop, Layers } from "lucide-react";

import { EMPTY_PINNED_SPECTRA } from "@/lib/image/spectrum-entry";
import {
  applyBandKeepToRasterImage,
  mapKeptBandNumbersToCurrentPositions,
} from "@/lib/image/apply-band-keep";
import { applyBitShiftToRasterImage } from "@/lib/image/apply-bit-shift";
import { applyCropToRasterImage } from "@/lib/image/apply-crop-to-roi";
import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import type { IntegerParameterSchema } from "./parameter-schema";
import type { ParameterValuesById } from "./parameter-schema";
import type {
  ApplyScope,
  ViewportAction,
  ViewportActionSourceTransform,
} from "./viewport-action";
import { EMPTY_REMOVED_BAND_INDEXES, type ViewportRenderingState } from "./viewport-action";

export type RegisteredActionIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface RegisteredViewportAction extends ViewportAction {
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly appliedLabel: string;
  readonly supportsRoiScope?: boolean;
  readonly formatAppliedLabel?: (parameterValues: ParameterValuesById) => string;
  readonly prepareParameterValuesForApply?: (
    rawParameterValues: ParameterValuesById,
    sourceRenderingState: ViewportRenderingState,
    applyScope: ApplyScope,
  ) => ParameterValuesById;
  readonly isAvailableForActiveViewport?: (
    sourceRenderingState: ViewportRenderingState,
  ) => boolean;
  readonly clearConsumedSourceStateAfterApply?: (
    sourceRenderingState: ViewportRenderingState,
  ) => ViewportRenderingState;
}

const BIT_SHIFT_PARAMETER_ID = "shiftAmount";
const BIT_SHIFT_REGION_PARAMETER_ID_X0 = "regionImagePixelX0";
const BIT_SHIFT_REGION_PARAMETER_ID_Y0 = "regionImagePixelY0";
const BIT_SHIFT_REGION_PARAMETER_ID_X1 = "regionImagePixelX1";
const BIT_SHIFT_REGION_PARAMETER_ID_Y1 = "regionImagePixelY1";

const BIT_SHIFT_PARAMETER_SCHEMA: IntegerParameterSchema = {
  kind: "integer",
  id: BIT_SHIFT_PARAMETER_ID,
  label: "Shift amount",
  description:
    "Brightens images from cameras that pack a smaller bit depth (such as 12-bit) into a 16-bit file, scaling the values up so they fill the full expected brightness range. Each step doubles the values.",
  defaultValue: 4,
  min: 0,
  max: 8,
};

export const BIT_SHIFT_ACTION: RegisteredViewportAction = {
  id: "bit-shift",
  label: "Bit Shift",
  icon: ChevronsLeft,
  parameters: [BIT_SHIFT_PARAMETER_SCHEMA],
  supportsRoiScope: true,
  successMessage: "Bit shift applied",
  appliedLabel: "Bit shift",
  formatAppliedLabel: formatBitShiftAppliedLabel,
  prepareParameterValuesForApply: prepareBitShiftParameterValuesForScope,
  apply: (state) => state,
  transformSource: createBitShiftSourceTransform(),
};

function prepareBitShiftParameterValuesForScope(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
): ParameterValuesById {
  if (applyScope !== "roi") return rawParameterValues;
  const roi = sourceRenderingState.roi;
  if (!roi) {
    throw new Error("Bit Shift to region requires an active region. Draw a region first.");
  }
  return Object.freeze({
    ...rawParameterValues,
    [BIT_SHIFT_REGION_PARAMETER_ID_X0]: roi.imagePixelX0,
    [BIT_SHIFT_REGION_PARAMETER_ID_Y0]: roi.imagePixelY0,
    [BIT_SHIFT_REGION_PARAMETER_ID_X1]: roi.imagePixelX1,
    [BIT_SHIFT_REGION_PARAMETER_ID_Y1]: roi.imagePixelY1,
  });
}

function createBitShiftSourceTransform(): ViewportActionSourceTransform {
  return (source, parameterValues) => {
    if (source.kind !== "raster") {
      throw new Error(
        "Bit shift only applies to raster images (TIFF, ENVI, raw camera). The active viewport's source is not a raster.",
      );
    }
    const shiftAmount = readBitShiftAmountFromParameterValues(parameterValues);
    const region = readBitShiftRegionFromParameterValuesIfPresent(parameterValues);
    return {
      kind: "raster",
      raster: applyBitShiftToRasterImage(source.raster, shiftAmount, region ? { region } : {}),
    };
  };
}

function readBitShiftAmountFromParameterValues(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[BIT_SHIFT_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return BIT_SHIFT_PARAMETER_SCHEMA.defaultValue;
  }
  return Math.round(raw);
}

function readBitShiftRegionFromParameterValuesIfPresent(
  parameterValues: ParameterValuesById,
): ViewportRoi | null {
  const x0 = parameterValues[BIT_SHIFT_REGION_PARAMETER_ID_X0];
  const y0 = parameterValues[BIT_SHIFT_REGION_PARAMETER_ID_Y0];
  const x1 = parameterValues[BIT_SHIFT_REGION_PARAMETER_ID_X1];
  const y1 = parameterValues[BIT_SHIFT_REGION_PARAMETER_ID_Y1];
  if (!areAllRegionCornersFiniteNumbers(x0, y0, x1, y1)) return null;
  return {
    imagePixelX0: Math.round(x0 as number),
    imagePixelY0: Math.round(y0 as number),
    imagePixelX1: Math.round(x1 as number),
    imagePixelY1: Math.round(y1 as number),
  };
}

function areAllRegionCornersFiniteNumbers(
  x0: unknown,
  y0: unknown,
  x1: unknown,
  y1: unknown,
): boolean {
  return (
    typeof x0 === "number" && Number.isFinite(x0) &&
    typeof y0 === "number" && Number.isFinite(y0) &&
    typeof x1 === "number" && Number.isFinite(x1) &&
    typeof y1 === "number" && Number.isFinite(y1)
  );
}

function formatBitShiftAppliedLabel(parameterValues: ParameterValuesById): string {
  const shiftAmount = readBitShiftAmountFromParameterValues(parameterValues);
  const region = readBitShiftRegionFromParameterValuesIfPresent(parameterValues);
  if (!region) return `Bit shift +${shiftAmount}`;
  const canonical = canonicalizeViewportRoiCorners(region);
  return `Bit shift +${shiftAmount} in (${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`;
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
  clearConsumedSourceStateAfterApply: clearRoiAfterCropApply,
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

const BAND_SUBSET_PARAMETER_ID_KEPT_NUMBERS = "keptBandNumbers";

export const BAND_SUBSET_ACTION: RegisteredViewportAction = {
  id: "band-subset",
  label: "Subset Bands",
  icon: Layers,
  successMessage: "Band subset applied",
  appliedLabel: "Subset bands",
  formatAppliedLabel: formatBandSubsetAppliedLabel,
  apply: clearBandSubsetStateAfterApply,
  clearConsumedSourceStateAfterApply: clearBandSubsetEditModeFromSource,
  transformSource: createBandSubsetSourceTransform(),
};

function clearBandSubsetStateAfterApply(state: ViewportRenderingState): ViewportRenderingState {
  return {
    ...state,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    selectedBandIndex: 0,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    isBandSubsetEditModeActive: false,
  };
}

function clearBandSubsetEditModeFromSource(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return {
    ...state,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
  };
}

function createBandSubsetSourceTransform(): ViewportActionSourceTransform {
  return (source, parameterValues) => {
    if (source.kind !== "raster") {
      throw new Error(
        "Subset Bands only applies to raster images (TIFF, ENVI, raw camera). The active viewport's source is not a raster.",
      );
    }
    const keptBandNumbers = readKeptBandNumbersFromParameterValues(parameterValues);
    const keptPositions = mapKeptBandNumbersToCurrentPositions(source.raster, keptBandNumbers);
    return { kind: "raster", raster: applyBandKeepToRasterImage(source.raster, keptPositions) };
  };
}

export function buildBandSubsetParameterValuesFromKeptNumbers(
  keptBandNumbers: ReadonlyArray<number>,
): ParameterValuesById {
  return Object.freeze({
    [BAND_SUBSET_PARAMETER_ID_KEPT_NUMBERS]: encodeKeptBandNumbersAsString(keptBandNumbers),
  });
}

function readKeptBandNumbersFromParameterValues(
  parameterValues: ParameterValuesById,
): ReadonlyArray<number> {
  const raw = parameterValues[BAND_SUBSET_PARAMETER_ID_KEPT_NUMBERS];
  if (typeof raw !== "string") {
    throw new Error("Subset Bands missing keptBandNumbers parameter.");
  }
  return parseKeptBandNumbersFromString(raw);
}

function encodeKeptBandNumbersAsString(keptBandNumbers: ReadonlyArray<number>): string {
  return keptBandNumbers.join(",");
}

function parseKeptBandNumbersFromString(value: string): ReadonlyArray<number> {
  if (value.length === 0) {
    throw new Error("Subset Bands keptBandNumbers parameter is empty.");
  }
  return value.split(",").map(parseSingleBandNumberOrThrow);
}

function parseSingleBandNumberOrThrow(token: string): number {
  const parsed = Number.parseInt(token.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Subset Bands received invalid band number '${token}'.`);
  }
  return parsed;
}

function formatBandSubsetAppliedLabel(parameterValues: ParameterValuesById): string {
  const keptBandNumbers = readKeptBandNumbersFromParameterValues(parameterValues);
  return `Subset bands [${keptBandNumbers.join(", ")}]`;
}

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  BIT_SHIFT_ACTION,
  CROP_TO_REGION_ACTION,
];
