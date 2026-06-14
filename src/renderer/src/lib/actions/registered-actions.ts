import type { ComponentType, SVGProps } from "react";
import { Blend, ChevronsLeft, Crop, Eclipse, Layers, Palette, RotateCw, Scaling, Sigma, SlidersHorizontal, Spline, SunDim, Target } from "lucide-react";

import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import {
  applyBandKeepToRasterImage,
  formatKeptOriginalBandsHistoryLabel,
  mapKeptBandNumbersToCurrentPositions,
} from "@/lib/image/apply-band-keep";
import { applyBitShiftToRasterImage } from "@/lib/image/apply-bit-shift";
import {
  applyToneCurveToRasterBand,
  type ToneCurveAnchor,
} from "@/lib/image/apply-tone-curve";
import {
  applyBrightnessToRasterBands,
  brightnessDeltaForRangeFractionOfBand,
} from "@/lib/image/apply-brightness";
import { applyContrastToRasterBands } from "@/lib/image/apply-contrast";
import { applyCropToRasterImage } from "@/lib/image/apply-crop-to-roi";
import {
  buildFalseColorComposite,
  type FalseColorBandAssignment,
} from "@/lib/image/apply-false-color-composite";
import {
  applyGeometricTransformToRasterImage,
  GEOMETRIC_TRANSFORM_LABELS,
  GEOMETRIC_TRANSFORMS,
  isGeometricTransform,
  type GeometricTransform,
} from "@/lib/image/apply-geometric-transform";
import {
  autoNormalizeUnboundedRasterToUnitRange,
  isRasterDataRangeBoundedForInvert,
  planInvertForRaster,
} from "@/lib/image/apply-invert";
import { applyFlatFieldToRasterImage } from "@/lib/image/apply-flat-field";
import {
  applyNormalizeToRaster,
  MIN_MAX_NORMALIZE_METHOD,
  type NormalizeRangeMethod,
} from "@/lib/image/apply-normalize";
import {
  applyRgbToGrayscale,
  LUMINANCE_GRAYSCALE_WEIGHTS,
  type RgbToGrayscaleWeights,
} from "@/lib/image/apply-rgb-to-grayscale";
import { applySpectralonReflectanceCalibration } from "@/lib/image/apply-spectralon";
import { applyStandardizeToRaster } from "@/lib/image/apply-standardize";
import {
  formatBandNumbersAsRangeText,
  parseBandRangeText,
} from "@/lib/image/parse-band-range";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  readRememberedReferenceRasterOrNull,
} from "@/lib/image/reference-raster-store";
import { readReferenceTokenDisplayName } from "@/lib/image/reference-token";
import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import {
  FULL_CUBE_SCOPE,
  NO_RASTER_REFERENCE_SELECTED,
  readBandNumberOrDefault,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  readRasterReferenceTokenOrEmpty,
  type BandNumberParameterSchema,
  type BooleanParameterSchema,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type IntegerParameterSchema,
  type NumberParameterSchema,
  type RasterReferenceParameterSchema,
  type ResolvedCubeScopeSelection,
  type SliderParameterSchema,
} from "./parameter-schema";
import type { ParameterValue, ParameterValuesById } from "./parameter-schema";
import {
  clearOperationRegionFromState,
  injectOperationRegionCorners,
  requireOperationRegionForApply,
} from "./operation-region";
import type {
  ApplyScope,
  ViewportAction,
  ViewportActionOutput,
  ViewportActionSecondaryOutputsTransform,
  ViewportActionSourceTransform,
} from "./viewport-action";
import { EMPTY_REMOVED_BAND_INDEXES, type ViewportRenderingState } from "./viewport-action";

export type RegisteredActionIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface RegisteredViewportAction extends ViewportAction {
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly appliedLabel: string;
  /**
   * CT-106: operation-specific message shown in the result panel's loading
   * state while the transform computes. Falls back to "Applying <label>..."
   * when omitted (see describeOperationLoadingMessage).
   */
  readonly loadingMessage?: string;
  /**
   * The operation always needs an area; the operation flow makes the user select
   * one (CT-095) and Apply stays disabled until they do.
   */
  readonly requiresOperationRegion?: boolean;
  /**
   * The operation can optionally be limited to an area; the user opts in via the
   * "Apply to" scope selector and then selects the region (CT-095).
   */
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
  /**
   * The operation emits extra outputs alongside its primary result; each is
   * placed in its own fresh viewport with its own applied label (CT-097).
   */
  readonly transformSourceToSecondaryOutputs?: ViewportActionSecondaryOutputsTransform;
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
  apply: clearOperationRegionFromState,
  clearConsumedSourceStateAfterApply: clearOperationRegionFromState,
  transformSource: createBitShiftSourceTransform(),
};

const BIT_SHIFT_REGION_PARAMETER_IDS = {
  x0: BIT_SHIFT_REGION_PARAMETER_ID_X0,
  y0: BIT_SHIFT_REGION_PARAMETER_ID_Y0,
  x1: BIT_SHIFT_REGION_PARAMETER_ID_X1,
  y1: BIT_SHIFT_REGION_PARAMETER_ID_Y1,
};

function prepareBitShiftParameterValuesForScope(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
): ParameterValuesById {
  if (applyScope !== "roi") return rawParameterValues;
  const region = requireOperationRegionForApply(sourceRenderingState, "Bit Shift");
  return injectOperationRegionCorners(rawParameterValues, region, BIT_SHIFT_REGION_PARAMETER_IDS);
}

function createBitShiftSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
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
  requiresOperationRegion: true,
  formatAppliedLabel: formatCropToRegionAppliedLabel,
  prepareParameterValuesForApply: prepareCropParameterValuesFromOperationRegion,
  apply: clearRegionAndStaleInspectionRoiAfterCrop,
  clearConsumedSourceStateAfterApply: clearOperationRegionFromState,
  transformSource: createCropToRegionSourceTransform(),
};

function clearRegionAndStaleInspectionRoiAfterCrop(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return { ...state, operationRegion: null, roi: null };
}

const CROP_REGION_PARAMETER_IDS = {
  x0: CROP_PARAMETER_ID_X0,
  y0: CROP_PARAMETER_ID_Y0,
  x1: CROP_PARAMETER_ID_X1,
  y1: CROP_PARAMETER_ID_Y1,
};

function prepareCropParameterValuesFromOperationRegion(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const region = requireOperationRegionForApply(sourceRenderingState, "Crop to Region");
  return injectOperationRegionCorners(rawParameterValues, region, CROP_REGION_PARAMETER_IDS);
}

function createCropToRegionSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
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
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
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
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
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
  return formatKeptOriginalBandsHistoryLabel(keptBandNumbers);
}

const FLAT_FIELD_LIGHT_PARAMETER_ID = "lightReferenceToken";
const FLAT_FIELD_DARK_PARAMETER_ID = "darkReferenceToken";

const FLAT_FIELD_LIGHT_PARAMETER_SCHEMA: RasterReferenceParameterSchema = {
  kind: "raster-reference",
  id: FLAT_FIELD_LIGHT_PARAMETER_ID,
  label: "Light reference (required)",
  description:
    "A bright flat-field capture used to remove illumination and sensor non-uniformity. Choose a file or a loaded panel. Must match the stack's width and height; use the same number of bands or a single band that applies to every band.",
  optional: false,
  defaultValue: NO_RASTER_REFERENCE_SELECTED,
};

const FLAT_FIELD_DARK_PARAMETER_SCHEMA: RasterReferenceParameterSchema = {
  kind: "raster-reference",
  id: FLAT_FIELD_DARK_PARAMETER_ID,
  label: "Dark reference (optional)",
  description:
    "An optional dark capture subtracted from both the image and the light reference. Defaults to zeros when omitted.",
  optional: true,
  defaultValue: NO_RASTER_REFERENCE_SELECTED,
};

export const FLAT_FIELD_ACTION: RegisteredViewportAction = {
  id: "flat-field",
  label: "Flat-field Correction",
  icon: SunDim,
  parameters: [FLAT_FIELD_LIGHT_PARAMETER_SCHEMA, FLAT_FIELD_DARK_PARAMETER_SCHEMA],
  successMessage: "Flat-field correction applied",
  appliedLabel: "Flat-field correction",
  loadingMessage: "Applying flat-field correction...",
  formatAppliedLabel: formatFlatFieldAppliedLabel,
  apply: (state) => state,
  transformSource: createFlatFieldSourceTransform(),
};

function createFlatFieldSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const lightReference = resolveRequiredLightReferenceOrThrow(parameterValues);
    const darkReference = resolveOptionalDarkReferenceOrThrow(parameterValues);
    const raster = applyFlatFieldToRasterImage(source.raster, lightReference, darkReference ?? undefined);
    return { kind: "raster", raster };
  };
}

function resolveRequiredLightReferenceOrThrow(parameterValues: ParameterValuesById): RasterImage {
  const token = readRasterReferenceTokenOrEmpty(parameterValues[FLAT_FIELD_LIGHT_PARAMETER_ID]);
  if (token === NO_RASTER_REFERENCE_SELECTED) {
    throw new Error("Choose a light reference stack before applying flat-field correction.");
  }
  return readRememberedReferenceRasterForTokenOrThrow(token);
}

function resolveOptionalDarkReferenceOrThrow(parameterValues: ParameterValuesById): RasterImage | null {
  const token = readRasterReferenceTokenOrEmpty(parameterValues[FLAT_FIELD_DARK_PARAMETER_ID]);
  if (token === NO_RASTER_REFERENCE_SELECTED) return null;
  return readRememberedReferenceRasterForTokenOrThrow(token);
}

function readRememberedReferenceRasterForTokenOrThrow(token: string): RasterImage {
  const raster = readRememberedReferenceRasterOrNull(token);
  if (!raster) {
    throw new Error("The reference stack is no longer loaded. Re-select the reference file and try again.");
  }
  return raster;
}

function formatFlatFieldAppliedLabel(parameterValues: ParameterValuesById): string {
  const lightName = readReferenceFileNameForLabel(parameterValues[FLAT_FIELD_LIGHT_PARAMETER_ID]);
  const darkToken = readRasterReferenceTokenOrEmpty(parameterValues[FLAT_FIELD_DARK_PARAMETER_ID]);
  if (darkToken === NO_RASTER_REFERENCE_SELECTED) return `Flat-field (light: ${lightName})`;
  return `Flat-field (light: ${lightName}, dark: ${readReferenceTokenDisplayName(darkToken)})`;
}

function readReferenceFileNameForLabel(value: ParameterValuesById[string] | undefined): string {
  const token = readRasterReferenceTokenOrEmpty(value);
  return token === NO_RASTER_REFERENCE_SELECTED ? "none" : readReferenceTokenDisplayName(token);
}

const SPECTRALON_REFLECTANCE_PARAMETER_ID = "reflectance";
const SPECTRALON_BRIGHT_PARAMETER_ID_X0 = "brightImagePixelX0";
const SPECTRALON_BRIGHT_PARAMETER_ID_Y0 = "brightImagePixelY0";
const SPECTRALON_BRIGHT_PARAMETER_ID_X1 = "brightImagePixelX1";
const SPECTRALON_BRIGHT_PARAMETER_ID_Y1 = "brightImagePixelY1";

const SPECTRALON_REFLECTANCE_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: SPECTRALON_REFLECTANCE_PARAMETER_ID,
  label: "Known reflectance",
  description:
    "The known reflectance of the bright Spectralon target, as a fraction (e.g. 0.99). Pixel values are scaled so the bright target reads at this reflectance.",
  defaultValue: 0.99,
  min: 0,
  max: 1,
  step: 0.01,
};

export const SPECTRALON_ACTION: RegisteredViewportAction = {
  id: "spectralon",
  label: "Spectralon Calibration",
  icon: Target,
  parameters: [SPECTRALON_REFLECTANCE_PARAMETER_SCHEMA],
  successMessage: "Spectralon reflectance calibration applied",
  appliedLabel: "Spectralon calibration",
  loadingMessage: "Calibrating reflectance...",
  requiresOperationRegion: true,
  formatAppliedLabel: formatSpectralonAppliedLabel,
  prepareParameterValuesForApply: prepareSpectralonBrightRegionFromOperationRegion,
  apply: clearOperationRegionFromState,
  clearConsumedSourceStateAfterApply: clearOperationRegionFromState,
  transformSource: createSpectralonSourceTransform(),
};

const SPECTRALON_BRIGHT_REGION_PARAMETER_IDS = {
  x0: SPECTRALON_BRIGHT_PARAMETER_ID_X0,
  y0: SPECTRALON_BRIGHT_PARAMETER_ID_Y0,
  x1: SPECTRALON_BRIGHT_PARAMETER_ID_X1,
  y1: SPECTRALON_BRIGHT_PARAMETER_ID_Y1,
};

function prepareSpectralonBrightRegionFromOperationRegion(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const region = requireOperationRegionForApply(sourceRenderingState, "Spectralon Calibration");
  return injectOperationRegionCorners(rawParameterValues, region, SPECTRALON_BRIGHT_REGION_PARAMETER_IDS);
}

function createSpectralonSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const brightRoi = readSpectralonBrightRoiOrThrow(parameterValues);
    const reflectance = readSpectralonReflectanceFromParameterValues(parameterValues);
    const raster = applySpectralonReflectanceCalibration(source.raster, { brightRoi, reflectance });
    return { kind: "raster", raster };
  };
}

function readSpectralonReflectanceFromParameterValues(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[SPECTRALON_REFLECTANCE_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return SPECTRALON_REFLECTANCE_PARAMETER_SCHEMA.defaultValue;
  }
  return raw;
}

function readSpectralonBrightRoiOrThrow(parameterValues: ParameterValuesById): ViewportRoi {
  return {
    imagePixelX0: readIntegerParameterOrThrowForSpectralon(parameterValues, SPECTRALON_BRIGHT_PARAMETER_ID_X0),
    imagePixelY0: readIntegerParameterOrThrowForSpectralon(parameterValues, SPECTRALON_BRIGHT_PARAMETER_ID_Y0),
    imagePixelX1: readIntegerParameterOrThrowForSpectralon(parameterValues, SPECTRALON_BRIGHT_PARAMETER_ID_X1),
    imagePixelY1: readIntegerParameterOrThrowForSpectralon(parameterValues, SPECTRALON_BRIGHT_PARAMETER_ID_Y1),
  };
}

function readIntegerParameterOrThrowForSpectralon(
  parameterValues: ParameterValuesById,
  parameterId: string,
): number {
  const raw = parameterValues[parameterId];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error("Spectralon Calibration requires a bright-target region. Draw a region first.");
  }
  return Math.round(raw);
}

function formatSpectralonAppliedLabel(parameterValues: ParameterValuesById): string {
  const reflectance = readSpectralonReflectanceFromParameterValues(parameterValues);
  const canonical = canonicalizeViewportRoiCorners(readSpectralonBrightRoiOrThrow(parameterValues));
  return (
    `Spectralon reflectance ${reflectance} from ` +
    `(${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`
  );
}

const TONE_CURVE_ANCHORS_PARAMETER_ID = "toneCurveAnchorsJson";
const TONE_CURVE_BAND_PARAMETER_ID = "targetBandIndex";
const TONE_CURVE_REGION_PARAMETER_IDS = {
  x0: "regionImagePixelX0",
  y0: "regionImagePixelY0",
  x1: "regionImagePixelX1",
  y1: "regionImagePixelY1",
} as const;

export const TONE_CURVE_ACTION: RegisteredViewportAction = {
  id: "tone-curve",
  label: "Tone Curve",
  icon: Spline,
  successMessage: "Tone curve applied",
  appliedLabel: "Tone curve",
  loadingMessage: "Applying tone curve...",
  supportsRoiScope: true,
  formatAppliedLabel: formatToneCurveAppliedLabel,
  prepareParameterValuesForApply: prepareToneCurveParameterValues,
  apply: clearToneCurveAfterApply,
  clearConsumedSourceStateAfterApply: clearOperationRegionFromState,
  transformSource: createToneCurveSourceTransform(),
};

function clearToneCurveAfterApply(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, toneCurveAnchors: null, operationRegion: null };
}

function prepareToneCurveParameterValues(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
): ParameterValuesById {
  const anchors = sourceRenderingState.toneCurveAnchors;
  if (!anchors || anchors.length < 2) {
    throw new Error("Tone Curve needs at least two anchor points. Adjust the curve first.");
  }
  const withAnchors = withToneCurveAnchorsAndBandValues(rawParameterValues, anchors, sourceRenderingState.selectedBandIndex);
  return injectToneCurveRegionIfPresent(withAnchors, resolveToneCurveRegion(sourceRenderingState, applyScope));
}

function resolveToneCurveRegion(
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
): ViewportRoi | null {
  if (applyScope !== "roi") return null;
  return requireOperationRegionForApply(sourceRenderingState, "Tone Curve");
}

function withToneCurveAnchorsAndBandValues(
  rawParameterValues: ParameterValuesById,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  selectedBandIndex: number,
): ParameterValuesById {
  return {
    ...rawParameterValues,
    [TONE_CURVE_ANCHORS_PARAMETER_ID]: serializeToneCurveAnchors(anchors),
    [TONE_CURVE_BAND_PARAMETER_ID]: selectedBandIndex,
  };
}

function injectToneCurveRegionIfPresent(
  parameterValues: ParameterValuesById,
  region: ViewportRoi | null,
): ParameterValuesById {
  if (!region) return Object.freeze({ ...parameterValues });
  return injectOperationRegionCorners(parameterValues, region, TONE_CURVE_REGION_PARAMETER_IDS);
}

function serializeToneCurveAnchors(anchors: ReadonlyArray<ToneCurveAnchor>): string {
  return JSON.stringify(anchors.map((anchor) => [anchor.input, anchor.output]));
}

function createToneCurveSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const bandIndex = readToneCurveBandIndex(parameterValues);
    const anchors = readToneCurveAnchorsOrThrow(parameterValues);
    const region = readToneCurveRegionIfPresent(parameterValues);
    const raster = applyToneCurveToRasterBand(source.raster, bandIndex, anchors, region ? { region } : {});
    return { kind: "raster", raster };
  };
}

function readToneCurveBandIndex(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[TONE_CURVE_BAND_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function readToneCurveAnchorsOrThrow(
  parameterValues: ParameterValuesById,
): ReadonlyArray<ToneCurveAnchor> {
  const raw = parameterValues[TONE_CURVE_ANCHORS_PARAMETER_ID];
  if (typeof raw !== "string") {
    throw new Error("Tone Curve needs at least two anchor points. Adjust the curve first.");
  }
  const pairs = JSON.parse(raw) as ReadonlyArray<readonly [number, number]>;
  return pairs.map(([input, output]) => ({ input, output }));
}

function readToneCurveRegionIfPresent(
  parameterValues: ParameterValuesById,
): ViewportRoi | null {
  const x0 = parameterValues[TONE_CURVE_REGION_PARAMETER_IDS.x0];
  const y0 = parameterValues[TONE_CURVE_REGION_PARAMETER_IDS.y0];
  const x1 = parameterValues[TONE_CURVE_REGION_PARAMETER_IDS.x1];
  const y1 = parameterValues[TONE_CURVE_REGION_PARAMETER_IDS.y1];
  if (!areAllRegionCornersFiniteNumbers(x0, y0, x1, y1)) return null;
  return {
    imagePixelX0: Math.round(x0 as number),
    imagePixelY0: Math.round(y0 as number),
    imagePixelX1: Math.round(x1 as number),
    imagePixelY1: Math.round(y1 as number),
  };
}

function formatToneCurveAppliedLabel(parameterValues: ParameterValuesById): string {
  const anchors = readToneCurveAnchorsOrThrow(parameterValues);
  const label = `Tone curve (${anchors.length} points)`;
  const region = readToneCurveRegionIfPresent(parameterValues);
  if (!region) return label;
  const canonical = canonicalizeViewportRoiCorners(region);
  return `${label} in (${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`;
}

const BRIGHTNESS_CONTRAST_BRIGHTNESS_PARAMETER_ID = "brightnessPercent";
const BRIGHTNESS_CONTRAST_CONTRAST_PARAMETER_ID = "contrastRatio";
const BRIGHTNESS_CONTRAST_ALL_BANDS_PARAMETER_ID = "applyToAllBands";
const BRIGHTNESS_CONTRAST_BAND_PARAMETER_ID = "targetBandIndex";

const BRIGHTNESS_CONTRAST_BRIGHTNESS_PARAMETER_SCHEMA: SliderParameterSchema = {
  kind: "slider",
  id: BRIGHTNESS_CONTRAST_BRIGHTNESS_PARAMETER_ID,
  label: "Brightness",
  description:
    "Adds a constant to every pixel, as a percentage of the data-type range. Values clip to the data-type range at both ends.",
  defaultValue: 0,
  min: -100,
  max: 100,
  step: 1,
  valueSuffix: "%",
};

const BRIGHTNESS_CONTRAST_CONTRAST_PARAMETER_SCHEMA: SliderParameterSchema = {
  kind: "slider",
  id: BRIGHTNESS_CONTRAST_CONTRAST_PARAMETER_ID,
  label: "Contrast",
  description:
    "Scales each pixel around the band mean: (value - mean) * contrast + mean. 1 leaves the band unchanged; values clip to the data-type range.",
  defaultValue: 1,
  min: 0,
  max: 4,
  step: 0.05,
};

const BRIGHTNESS_CONTRAST_ALL_BANDS_PARAMETER_SCHEMA: BooleanParameterSchema = {
  kind: "boolean",
  id: BRIGHTNESS_CONTRAST_ALL_BANDS_PARAMETER_ID,
  label: "Apply to all bands",
  description: "Off applies to the selected band only; on applies to every band in the stack.",
  defaultValue: false,
};

export const BRIGHTNESS_CONTRAST_ACTION: RegisteredViewportAction = {
  id: "brightness-contrast",
  label: "Brightness & Contrast",
  icon: SlidersHorizontal,
  parameters: [
    BRIGHTNESS_CONTRAST_BRIGHTNESS_PARAMETER_SCHEMA,
    BRIGHTNESS_CONTRAST_CONTRAST_PARAMETER_SCHEMA,
    BRIGHTNESS_CONTRAST_ALL_BANDS_PARAMETER_SCHEMA,
  ],
  successMessage: "Brightness and contrast applied",
  appliedLabel: "Brightness & contrast",
  formatAppliedLabel: formatBrightnessContrastAppliedLabel,
  prepareParameterValuesForApply: injectSelectedBandIndexForBrightnessContrast,
  apply: (state) => state,
  transformSource: createBrightnessContrastSourceTransform(),
};

function injectSelectedBandIndexForBrightnessContrast(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return Object.freeze({
    ...rawParameterValues,
    [BRIGHTNESS_CONTRAST_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
}

function createBrightnessContrastSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const bandIndexes = resolveBrightnessContrastBandIndexes(parameterValues, source.raster);
    return { kind: "raster", raster: adjustBrightnessThenContrast(source.raster, bandIndexes, parameterValues) };
  };
}

function adjustBrightnessThenContrast(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  parameterValues: ParameterValuesById,
): RasterImage {
  const brightnessFraction = readBrightnessPercent(parameterValues) / 100;
  const firstBand = getRasterBandPixelsOrThrow(raster, bandIndexes[0] ?? 0);
  const brightnessDelta = brightnessDeltaForRangeFractionOfBand(firstBand, raster.sampleFormat, brightnessFraction);
  const brightened = applyBrightnessToRasterBands(raster, bandIndexes, brightnessDelta);
  return applyContrastToRasterBands(brightened, bandIndexes, readContrastRatio(parameterValues));
}

function resolveBrightnessContrastBandIndexes(
  parameterValues: ParameterValuesById,
  raster: RasterImage,
): ReadonlyArray<number> {
  if (readApplyToAllBands(parameterValues)) return listAllBandIndexes(raster.bandPixels.length);
  return [readBrightnessContrastTargetBandIndex(parameterValues)];
}

function listAllBandIndexes(bandCount: number): ReadonlyArray<number> {
  return Array.from({ length: bandCount }, (_unused, index) => index);
}

function readApplyToAllBands(parameterValues: ParameterValuesById): boolean {
  return parameterValues[BRIGHTNESS_CONTRAST_ALL_BANDS_PARAMETER_ID] === true;
}

function readBrightnessContrastTargetBandIndex(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[BRIGHTNESS_CONTRAST_BAND_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function readBrightnessPercent(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[BRIGHTNESS_CONTRAST_BRIGHTNESS_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return BRIGHTNESS_CONTRAST_BRIGHTNESS_PARAMETER_SCHEMA.defaultValue;
  }
  return raw;
}

function readContrastRatio(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[BRIGHTNESS_CONTRAST_CONTRAST_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return BRIGHTNESS_CONTRAST_CONTRAST_PARAMETER_SCHEMA.defaultValue;
  }
  return raw;
}

function formatBrightnessContrastAppliedLabel(parameterValues: ParameterValuesById): string {
  const brightness = formatSignedPercent(readBrightnessPercent(parameterValues));
  const contrast = readContrastRatio(parameterValues).toFixed(2);
  return `Brightness ${brightness}, contrast ${contrast} (${describeAffectedBands(parameterValues)})`;
}

function describeAffectedBands(parameterValues: ParameterValuesById): string {
  if (readApplyToAllBands(parameterValues)) return "all bands";
  return `band ${readBrightnessContrastTargetBandIndex(parameterValues) + 1}`;
}

function formatSignedPercent(percent: number): string {
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

const INVERT_ALL_BANDS_PARAMETER_ID = "applyToAllBands";
const INVERT_BAND_PARAMETER_ID = "targetBandIndex";

const INVERT_ALL_BANDS_PARAMETER_SCHEMA: BooleanParameterSchema = {
  kind: "boolean",
  id: INVERT_ALL_BANDS_PARAMETER_ID,
  label: "Apply to all bands",
  description: "Off inverts the selected band only; on inverts every band in the stack.",
  defaultValue: false,
};

const AUTO_NORMALIZED_FOR_INVERT_LABEL = "Normalize to [0,1] (auto for invert)";

const NO_SECONDARY_OUTPUTS: ReadonlyArray<ViewportActionOutput> = Object.freeze([]);

export const INVERT_ACTION: RegisteredViewportAction = {
  id: "invert",
  label: "Invert",
  icon: Eclipse,
  parameters: [INVERT_ALL_BANDS_PARAMETER_SCHEMA],
  successMessage: "Invert applied",
  appliedLabel: "Invert",
  formatAppliedLabel: formatInvertAppliedLabel,
  prepareParameterValuesForApply: injectSelectedBandIndexForInvert,
  apply: (state) => state,
  transformSource: createInvertSourceTransform(),
  transformSourceToSecondaryOutputs: createInvertSecondaryOutputsTransform(),
};

function injectSelectedBandIndexForInvert(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return Object.freeze({
    ...rawParameterValues,
    [INVERT_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
}

function createInvertSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const bandIndexes = resolveInvertBandIndexes(parameterValues, source.raster);
    return { kind: "raster", raster: resolveInvertPrimaryRaster(source.raster, bandIndexes) };
  };
}

function resolveInvertPrimaryRaster(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
): RasterImage {
  const outcome = planInvertForRaster(raster, bandIndexes);
  return outcome.kind === "direct" ? outcome.inverted : outcome.normalizedThenInverted;
}

function createInvertSecondaryOutputsTransform(): ViewportActionSecondaryOutputsTransform {
  return (rawSource) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    return listAutoNormalizedSecondaryOutputForUnboundedRaster(source.raster);
  };
}

function listAutoNormalizedSecondaryOutputForUnboundedRaster(
  raster: RasterImage,
): ReadonlyArray<ViewportActionOutput> {
  if (isRasterDataRangeBoundedForInvert(raster)) return NO_SECONDARY_OUTPUTS;
  const normalized = autoNormalizeUnboundedRasterToUnitRange(raster);
  return [{ source: { kind: "raster", raster: normalized }, appliedLabel: AUTO_NORMALIZED_FOR_INVERT_LABEL }];
}

function resolveInvertBandIndexes(
  parameterValues: ParameterValuesById,
  raster: RasterImage,
): ReadonlyArray<number> {
  if (readInvertApplyToAllBands(parameterValues)) return listAllBandIndexes(raster.bandPixels.length);
  return [readInvertTargetBandIndex(parameterValues)];
}

function readInvertApplyToAllBands(parameterValues: ParameterValuesById): boolean {
  return parameterValues[INVERT_ALL_BANDS_PARAMETER_ID] === true;
}

function readInvertTargetBandIndex(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[INVERT_BAND_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function formatInvertAppliedLabel(parameterValues: ParameterValuesById): string {
  return `Invert (${describeInvertAffectedBands(parameterValues)})`;
}

function describeInvertAffectedBands(parameterValues: ParameterValuesById): string {
  if (readInvertApplyToAllBands(parameterValues)) return "all bands";
  return `band ${readInvertTargetBandIndex(parameterValues) + 1}`;
}

const NORMALIZE_SCOPE_PARAMETER_ID = "scope";
const NORMALIZE_BAND_PARAMETER_ID = "targetBandIndex";
const NORMALIZE_BAND_RANGE_PARAMETER_ID = "bandRange";
const NORMALIZE_METHOD_PARAMETER_ID = "method";
const NORMALIZE_LOW_PERCENTILE_PARAMETER_ID = "lowPercentile";
const NORMALIZE_HIGH_PERCENTILE_PARAMETER_ID = "highPercentile";
const MIN_MAX_METHOD_VALUE = "min-max";
const ROBUST_PERCENTILE_METHOD_VALUE = "robust-percentile";

const NORMALIZE_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: NORMALIZE_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Full stack scales every band by one stack-wide min and max; band-wise scales each entered band by its own min and max (defaults to the current band).",
  defaultValue: FULL_CUBE_SCOPE,
  bandRangeParameterId: NORMALIZE_BAND_RANGE_PARAMETER_ID,
};

const NORMALIZE_METHOD_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: NORMALIZE_METHOD_PARAMETER_ID,
  label: "Method",
  description:
    "Min-max uses the absolute min and max. Robust uses the low/high percentiles so sparse bright outliers do not flatten the image (values outside the percentile range clip to 0/1).",
  defaultValue: MIN_MAX_METHOD_VALUE,
  options: [
    { value: MIN_MAX_METHOD_VALUE, label: "Min-max (absolute)" },
    { value: ROBUST_PERCENTILE_METHOD_VALUE, label: "Robust (percentile clip)" },
  ],
};

const NORMALIZE_LOW_PERCENTILE_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: NORMALIZE_LOW_PERCENTILE_PARAMETER_ID,
  label: "Low percentile (robust)",
  description: "Lower clip percentile used by the robust method.",
  defaultValue: 2,
  min: 0,
  max: 100,
  step: 0.5,
};

const NORMALIZE_HIGH_PERCENTILE_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: NORMALIZE_HIGH_PERCENTILE_PARAMETER_ID,
  label: "High percentile (robust)",
  description: "Upper clip percentile used by the robust method.",
  defaultValue: 98,
  min: 0,
  max: 100,
  step: 0.5,
};

export const NORMALIZE_DATA_ACTION: RegisteredViewportAction = {
  id: "normalize-data",
  label: "Normalize",
  icon: Scaling,
  parameters: [
    NORMALIZE_SCOPE_PARAMETER_SCHEMA,
    NORMALIZE_METHOD_PARAMETER_SCHEMA,
    NORMALIZE_LOW_PERCENTILE_PARAMETER_SCHEMA,
    NORMALIZE_HIGH_PERCENTILE_PARAMETER_SCHEMA,
  ],
  successMessage: "Normalize applied",
  appliedLabel: "Normalize",
  loadingMessage: "Normalizing...",
  formatAppliedLabel: formatNormalizeAppliedLabel,
  prepareParameterValuesForApply: injectSelectedBandIndexForNormalize,
  apply: (state) => state,
  transformSource: createNormalizeSourceTransform(),
};

function injectSelectedBandIndexForNormalize(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return Object.freeze({
    ...rawParameterValues,
    [NORMALIZE_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
}

function createNormalizeSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const selection = resolveNormalizeScopeSelection(parameterValues, source.raster.bandCount);
    const method = resolveNormalizeRangeMethod(parameterValues);
    return { kind: "raster", raster: applyNormalizeToRaster(source.raster, selection, method) };
  };
}

function resolveNormalizeScopeSelection(
  parameterValues: ParameterValuesById,
  bandCount: number,
): ResolvedCubeScopeSelection {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[NORMALIZE_SCOPE_PARAMETER_ID] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
  if (choice === FULL_CUBE_SCOPE) return { scope: "full-cube" };
  return resolveBandWiseScopeOrThrow(
    parameterValues[NORMALIZE_BAND_RANGE_PARAMETER_ID],
    readNormalizeTargetBandIndex(parameterValues),
    bandCount,
  );
}

function resolveNormalizeRangeMethod(parameterValues: ParameterValuesById): NormalizeRangeMethod {
  if (parameterValues[NORMALIZE_METHOD_PARAMETER_ID] !== ROBUST_PERCENTILE_METHOD_VALUE) {
    return MIN_MAX_NORMALIZE_METHOD;
  }
  return {
    kind: "percentile",
    bounds: {
      lowPercentile: readNormalizePercentile(parameterValues, NORMALIZE_LOW_PERCENTILE_PARAMETER_ID, 2),
      highPercentile: readNormalizePercentile(parameterValues, NORMALIZE_HIGH_PERCENTILE_PARAMETER_ID, 98),
    },
  };
}

function readNormalizePercentile(
  parameterValues: ParameterValuesById,
  parameterId: string,
  fallback: number,
): number {
  const raw = parameterValues[parameterId];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function readNormalizeTargetBandIndex(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[NORMALIZE_BAND_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function formatNormalizeAppliedLabel(parameterValues: ParameterValuesById): string {
  return `Normalize to [0,1] (${formatNormalizeScopeLabel(parameterValues)}${formatNormalizeMethodSuffix(parameterValues)})`;
}

function formatNormalizeScopeLabel(parameterValues: ParameterValuesById): string {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[NORMALIZE_SCOPE_PARAMETER_ID] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
  if (choice === FULL_CUBE_SCOPE) return "full stack";
  return `band-wise: bands ${describeBandWiseBandSet(
    parameterValues[NORMALIZE_BAND_RANGE_PARAMETER_ID],
    readNormalizeTargetBandIndex(parameterValues),
  )}`;
}

function formatNormalizeMethodSuffix(parameterValues: ParameterValuesById): string {
  const method = resolveNormalizeRangeMethod(parameterValues);
  if (method.kind === "min-max") return "";
  return `, robust ${method.bounds.lowPercentile}-${method.bounds.highPercentile}%`;
}

function resolveBandWiseScopeOrThrow(
  bandRangeValue: ParameterValue | undefined,
  fallbackBandIndex: number,
  bandCount: number,
): ResolvedCubeScopeSelection {
  const text = readBandRangeTextOrEmpty(bandRangeValue);
  if (text.trim() === "") return { scope: "band-wise", bandIndexes: [fallbackBandIndex] };
  const parsed = parseBandRangeText(text, bandCount);
  if (!parsed.ok) throw new Error(parsed.error);
  return { scope: "band-wise", bandIndexes: parsed.bandNumbers.map((bandNumber) => bandNumber - 1) };
}

function describeBandWiseBandSet(
  bandRangeValue: ParameterValue | undefined,
  fallbackBandIndex: number,
): string {
  const text = readBandRangeTextOrEmpty(bandRangeValue);
  if (text.trim() === "") return String(fallbackBandIndex + 1);
  const parsed = parseBandRangeText(text, Number.MAX_SAFE_INTEGER);
  return parsed.ok ? formatBandNumbersAsRangeText(parsed.bandNumbers) : text.trim();
}

const STANDARDIZE_SCOPE_PARAMETER_ID = "scope";
const STANDARDIZE_BAND_PARAMETER_ID = "targetBandIndex";
const STANDARDIZE_BAND_RANGE_PARAMETER_ID = "bandRange";
const STANDARDIZE_TARGET_MEAN_PARAMETER_ID = "targetMean";
const STANDARDIZE_TARGET_STD_PARAMETER_ID = "targetStandardDeviation";

const STANDARDIZE_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: STANDARDIZE_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Full stack standardizes by one stack-wide mean and std; band-wise standardizes each entered band by its own mean and std (defaults to the current band).",
  defaultValue: FULL_CUBE_SCOPE,
  bandRangeParameterId: STANDARDIZE_BAND_RANGE_PARAMETER_ID,
};

const STANDARDIZE_TARGET_MEAN_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: STANDARDIZE_TARGET_MEAN_PARAMETER_ID,
  label: "Target mean",
  description: "The mean the standardized data should be centered on.",
  defaultValue: 0,
  step: 0.1,
};

const STANDARDIZE_TARGET_STD_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: STANDARDIZE_TARGET_STD_PARAMETER_ID,
  label: "Target standard deviation",
  description: "The standard deviation the standardized data should be scaled to.",
  defaultValue: 1,
  step: 0.1,
};

export const STANDARDIZE_ACTION: RegisteredViewportAction = {
  id: "standardize",
  label: "Standardize",
  icon: Sigma,
  parameters: [
    STANDARDIZE_SCOPE_PARAMETER_SCHEMA,
    STANDARDIZE_TARGET_MEAN_PARAMETER_SCHEMA,
    STANDARDIZE_TARGET_STD_PARAMETER_SCHEMA,
  ],
  successMessage: "Standardize applied",
  appliedLabel: "Standardize",
  loadingMessage: "Standardizing...",
  formatAppliedLabel: formatStandardizeAppliedLabel,
  prepareParameterValuesForApply: injectSelectedBandIndexForStandardize,
  apply: (state) => state,
  transformSource: createStandardizeSourceTransform(),
};

function injectSelectedBandIndexForStandardize(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return Object.freeze({
    ...rawParameterValues,
    [STANDARDIZE_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
}

function createStandardizeSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const selection = resolveStandardizeScopeSelection(parameterValues, source.raster.bandCount);
    const target = readStandardizeTargetDistribution(parameterValues);
    return { kind: "raster", raster: applyStandardizeToRaster(source.raster, selection, target) };
  };
}

function resolveStandardizeScopeSelection(
  parameterValues: ParameterValuesById,
  bandCount: number,
): ResolvedCubeScopeSelection {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[STANDARDIZE_SCOPE_PARAMETER_ID] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
  if (choice === FULL_CUBE_SCOPE) return { scope: "full-cube" };
  return resolveBandWiseScopeOrThrow(
    parameterValues[STANDARDIZE_BAND_RANGE_PARAMETER_ID],
    readStandardizeTargetBandIndex(parameterValues),
    bandCount,
  );
}

function readStandardizeTargetBandIndex(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[STANDARDIZE_BAND_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function readStandardizeTargetDistribution(parameterValues: ParameterValuesById): {
  targetMean: number;
  targetStandardDeviation: number;
} {
  return {
    targetMean: readNumberParameterOrDefault(
      parameterValues[STANDARDIZE_TARGET_MEAN_PARAMETER_ID],
      STANDARDIZE_TARGET_MEAN_PARAMETER_SCHEMA.defaultValue,
    ),
    targetStandardDeviation: readNumberParameterOrDefault(
      parameterValues[STANDARDIZE_TARGET_STD_PARAMETER_ID],
      STANDARDIZE_TARGET_STD_PARAMETER_SCHEMA.defaultValue,
    ),
  };
}

function readNumberParameterOrDefault(
  raw: ParameterValue | undefined,
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return raw;
}

function formatStandardizeAppliedLabel(parameterValues: ParameterValuesById): string {
  const target = readStandardizeTargetDistribution(parameterValues);
  return `Standardize (${describeStandardizeScope(parameterValues)}, mean ${target.targetMean}, std ${target.targetStandardDeviation})`;
}

function describeStandardizeScope(parameterValues: ParameterValuesById): string {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[STANDARDIZE_SCOPE_PARAMETER_ID] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
  if (choice === FULL_CUBE_SCOPE) return "full stack";
  return `band-wise: bands ${describeBandWiseBandSet(
    parameterValues[STANDARDIZE_BAND_RANGE_PARAMETER_ID],
    readStandardizeTargetBandIndex(parameterValues),
  )}`;
}

const RGB_TO_GRAYSCALE_RED_WEIGHT_PARAMETER_ID = "redWeight";
const RGB_TO_GRAYSCALE_GREEN_WEIGHT_PARAMETER_ID = "greenWeight";
const RGB_TO_GRAYSCALE_BLUE_WEIGHT_PARAMETER_ID = "blueWeight";

const RGB_TO_GRAYSCALE_RED_WEIGHT_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: RGB_TO_GRAYSCALE_RED_WEIGHT_PARAMETER_ID,
  label: "Red weight",
  description: "Weight applied to the red band. Defaults to the luminance weight; enter 0.3333 for a straight average.",
  defaultValue: LUMINANCE_GRAYSCALE_WEIGHTS.red,
  step: 0.001,
};

const RGB_TO_GRAYSCALE_GREEN_WEIGHT_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: RGB_TO_GRAYSCALE_GREEN_WEIGHT_PARAMETER_ID,
  label: "Green weight",
  description: "Weight applied to the green band. Defaults to the luminance weight; enter 0.3333 for a straight average.",
  defaultValue: LUMINANCE_GRAYSCALE_WEIGHTS.green,
  step: 0.001,
};

const RGB_TO_GRAYSCALE_BLUE_WEIGHT_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: RGB_TO_GRAYSCALE_BLUE_WEIGHT_PARAMETER_ID,
  label: "Blue weight",
  description: "Weight applied to the blue band. Defaults to the luminance weight; enter 0.3333 for a straight average.",
  defaultValue: LUMINANCE_GRAYSCALE_WEIGHTS.blue,
  step: 0.001,
};

export const RGB_TO_GRAYSCALE_ACTION: RegisteredViewportAction = {
  id: "rgb-to-grayscale",
  label: "RGB to Grayscale",
  icon: Blend,
  parameters: [
    RGB_TO_GRAYSCALE_RED_WEIGHT_PARAMETER_SCHEMA,
    RGB_TO_GRAYSCALE_GREEN_WEIGHT_PARAMETER_SCHEMA,
    RGB_TO_GRAYSCALE_BLUE_WEIGHT_PARAMETER_SCHEMA,
  ],
  successMessage: "Converted RGB to grayscale",
  appliedLabel: "RGB to grayscale",
  formatAppliedLabel: formatRgbToGrayscaleAppliedLabel,
  apply: resetToSingleBandAfterGrayscaleApply,
  transformSource: createRgbToGrayscaleSourceTransform(),
};

function resetToSingleBandAfterGrayscaleApply(state: ViewportRenderingState): ViewportRenderingState {
  return resetBandDependentStateAfterBandCountChange(state);
}

function resetBandDependentStateAfterBandCountChange(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return {
    ...state,
    selectedBandIndex: 0,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
  };
}

function createRgbToGrayscaleSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const weights = readRgbToGrayscaleWeights(parameterValues);
    return { kind: "raster", raster: applyRgbToGrayscale(source.raster, weights) };
  };
}

function readRgbToGrayscaleWeights(parameterValues: ParameterValuesById): RgbToGrayscaleWeights {
  return {
    red: readNumberParameterOrDefault(
      parameterValues[RGB_TO_GRAYSCALE_RED_WEIGHT_PARAMETER_ID],
      LUMINANCE_GRAYSCALE_WEIGHTS.red,
    ),
    green: readNumberParameterOrDefault(
      parameterValues[RGB_TO_GRAYSCALE_GREEN_WEIGHT_PARAMETER_ID],
      LUMINANCE_GRAYSCALE_WEIGHTS.green,
    ),
    blue: readNumberParameterOrDefault(
      parameterValues[RGB_TO_GRAYSCALE_BLUE_WEIGHT_PARAMETER_ID],
      LUMINANCE_GRAYSCALE_WEIGHTS.blue,
    ),
  };
}

function formatRgbToGrayscaleAppliedLabel(parameterValues: ParameterValuesById): string {
  const weights = readRgbToGrayscaleWeights(parameterValues);
  return `RGB to grayscale (R ${formatWeight(weights.red)}, G ${formatWeight(weights.green)}, B ${formatWeight(weights.blue)})`;
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(3);
}

const FALSE_COLOR_RED_BAND_PARAMETER_ID = "redBandNumber";
const FALSE_COLOR_GREEN_BAND_PARAMETER_ID = "greenBandNumber";
const FALSE_COLOR_BLUE_BAND_PARAMETER_ID = "blueBandNumber";

const FALSE_COLOR_RED_BAND_PARAMETER_SCHEMA: BandNumberParameterSchema = {
  kind: "band-number",
  id: FALSE_COLOR_RED_BAND_PARAMETER_ID,
  label: "Band R",
  description: "Source band mapped to the red output channel.",
  defaultValue: 1,
};

const FALSE_COLOR_GREEN_BAND_PARAMETER_SCHEMA: BandNumberParameterSchema = {
  kind: "band-number",
  id: FALSE_COLOR_GREEN_BAND_PARAMETER_ID,
  label: "Band G",
  description: "Source band mapped to the green output channel.",
  defaultValue: 2,
};

const FALSE_COLOR_BLUE_BAND_PARAMETER_SCHEMA: BandNumberParameterSchema = {
  kind: "band-number",
  id: FALSE_COLOR_BLUE_BAND_PARAMETER_ID,
  label: "Band B",
  description: "Source band mapped to the blue output channel.",
  defaultValue: 3,
};

export const FALSE_COLOR_ACTION: RegisteredViewportAction = {
  id: "false-color",
  label: "False-color Composite",
  icon: Palette,
  parameters: [
    FALSE_COLOR_RED_BAND_PARAMETER_SCHEMA,
    FALSE_COLOR_GREEN_BAND_PARAMETER_SCHEMA,
    FALSE_COLOR_BLUE_BAND_PARAMETER_SCHEMA,
  ],
  successMessage: "False-color composite applied",
  appliedLabel: "False-color composite",
  formatAppliedLabel: formatFalseColorAppliedLabel,
  apply: resetBandDependentStateAfterBandCountChange,
  transformSource: createFalseColorSourceTransform(),
};

export function readFalseColorBandAssignment(
  parameterValues: ParameterValuesById,
): FalseColorBandAssignment {
  return {
    r: readBandNumberOrDefault(parameterValues[FALSE_COLOR_RED_BAND_PARAMETER_ID], FALSE_COLOR_RED_BAND_PARAMETER_SCHEMA.defaultValue),
    g: readBandNumberOrDefault(parameterValues[FALSE_COLOR_GREEN_BAND_PARAMETER_ID], FALSE_COLOR_GREEN_BAND_PARAMETER_SCHEMA.defaultValue),
    b: readBandNumberOrDefault(parameterValues[FALSE_COLOR_BLUE_BAND_PARAMETER_ID], FALSE_COLOR_BLUE_BAND_PARAMETER_SCHEMA.defaultValue),
  };
}

function createFalseColorSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const assignment = readFalseColorBandAssignment(parameterValues);
    return { kind: "raster", raster: buildFalseColorComposite(source.raster, assignment) };
  };
}

function formatFalseColorAppliedLabel(parameterValues: ParameterValuesById): string {
  const assignment = readFalseColorBandAssignment(parameterValues);
  return `False-color (R band ${assignment.r}, G band ${assignment.g}, B band ${assignment.b})`;
}

const GEOMETRIC_TRANSFORM_PARAMETER_ID = "transform";

const GEOMETRIC_TRANSFORM_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: GEOMETRIC_TRANSFORM_PARAMETER_ID,
  label: "Transform",
  description:
    "Rotate the whole stack clockwise or flip it. Rotations of 90 and 270 degrees swap the reported width and height.",
  defaultValue: "rotate-90-cw",
  options: GEOMETRIC_TRANSFORMS.map((transform) => ({
    value: transform,
    label: GEOMETRIC_TRANSFORM_LABELS[transform],
  })),
};

export const ROTATE_REFLECT_ACTION: RegisteredViewportAction = {
  id: "rotate-reflect",
  label: "Rotate & Reflect",
  icon: RotateCw,
  parameters: [GEOMETRIC_TRANSFORM_PARAMETER_SCHEMA],
  successMessage: "Geometric transform applied",
  appliedLabel: "Rotate / reflect",
  formatAppliedLabel: formatGeometricTransformAppliedLabel,
  apply: clearRegionAfterGeometricTransform,
  clearConsumedSourceStateAfterApply: clearRegionAfterGeometricTransform,
  transformSource: createGeometricTransformSourceTransform(),
};

function clearRegionAfterGeometricTransform(state: ViewportRenderingState): ViewportRenderingState {
  return { ...state, roi: null };
}

function createGeometricTransformSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const transform = readGeometricTransformChoice(parameterValues);
    return { kind: "raster", raster: applyGeometricTransformToRasterImage(source.raster, transform) };
  };
}

function readGeometricTransformChoice(parameterValues: ParameterValuesById): GeometricTransform {
  const raw = parameterValues[GEOMETRIC_TRANSFORM_PARAMETER_ID];
  if (isGeometricTransform(raw)) return raw;
  return GEOMETRIC_TRANSFORM_PARAMETER_SCHEMA.defaultValue as GeometricTransform;
}

function formatGeometricTransformAppliedLabel(parameterValues: ParameterValuesById): string {
  return GEOMETRIC_TRANSFORM_LABELS[readGeometricTransformChoice(parameterValues)];
}

export const REGISTERED_VIEWPORT_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  BIT_SHIFT_ACTION,
  CROP_TO_REGION_ACTION,
  FLAT_FIELD_ACTION,
  SPECTRALON_ACTION,
  TONE_CURVE_ACTION,
  BRIGHTNESS_CONTRAST_ACTION,
  INVERT_ACTION,
  NORMALIZE_DATA_ACTION,
  STANDARDIZE_ACTION,
  RGB_TO_GRAYSCALE_ACTION,
  FALSE_COLOR_ACTION,
  ROTATE_REFLECT_ACTION,
];
