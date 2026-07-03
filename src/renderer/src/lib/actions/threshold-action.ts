import { Contrast } from "lucide-react";

import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import {
  formatBandNumbersAsRangeText,
  parseBandRangeText,
} from "@/lib/image/parse-band-range";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  getRasterBandLabelOrDefault,
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import { makeBinaryStackFromBands } from "@/lib/image/threshold/binary-stack";
import {
  applyManualThreshold,
  applyManualThresholdAcrossBands,
  type ThresholdBounds,
} from "@/lib/image/threshold/threshold";

import {
  BAND_WISE_SCOPE,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  type CubeScopeParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
  type ResolvedCubeScopeSelection,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  clearThresholdEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-200: manual threshold with draggable bounds. The live bounds ride in
// ViewportRenderingState.thresholdBounds (written by the embedded editor);
// Apply injects them into the parameter values so the audit trail records the
// exact bounds and scope. The output is a NEW binary stack (2-level 8-bit),
// per band by default (Band-wise) or one combined band (Full stack).

export const THRESHOLD_ACTION_ID = "threshold";
export const THRESHOLD_SCOPE_PARAMETER_ID = "scope";
export const THRESHOLD_BAND_RANGE_PARAMETER_ID = "bandRange";
export const THRESHOLD_TARGET_BAND_PARAMETER_ID = "targetBandIndex";
export const THRESHOLD_LOWER_BOUND_PARAMETER_ID = "lowerBound";
export const THRESHOLD_UPPER_BOUND_PARAMETER_ID = "upperBound";

const THRESHOLD_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: THRESHOLD_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Band-wise turns each entered band into its own black/white band. Full stack combines " +
    "all bands into one black/white band: a pixel is white only when every band is within the bounds.",
  defaultValue: BAND_WISE_SCOPE,
  bandRangeParameterId: THRESHOLD_BAND_RANGE_PARAMETER_ID,
};

export const THRESHOLD_ACTION: RegisteredViewportAction = {
  id: THRESHOLD_ACTION_ID,
  label: "Threshold",
  icon: Contrast,
  parameters: [THRESHOLD_SCOPE_PARAMETER_SCHEMA],
  successMessage: "Threshold applied",
  appliedLabel: "Threshold",
  loadingMessage: "Applying threshold...",
  formatAppliedLabel: formatThresholdAppliedLabel,
  prepareParameterValuesForApply: injectThresholdBoundsForApply,
  apply: resetStateForBinaryThresholdOutput,
  clearConsumedSourceStateAfterApply: clearThresholdEditingState,
  transformSource: createThresholdSourceTransform(),
};

function injectThresholdBoundsForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const bounds = sourceRenderingState.thresholdBounds;
  if (!bounds) {
    throw new Error("Threshold needs lower and upper bounds. Adjust the bounds first.");
  }
  return Object.freeze({
    ...rawParameterValues,
    [THRESHOLD_LOWER_BOUND_PARAMETER_ID]: bounds.lower,
    [THRESHOLD_UPPER_BOUND_PARAMETER_ID]: bounds.upper,
    [THRESHOLD_TARGET_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
}

// The binary output has its own band count, so band-dependent viewer state
// (selected band, subset edit mode, pinned spectra) resets like the other
// band-count-changing operations, and the consumed editing bounds clear.
function resetStateForBinaryThresholdOutput(
  state: ViewportRenderingState,
): ViewportRenderingState {
  return {
    ...clearThresholdEditingState(state),
    selectedBandIndex: 0,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  };
}

function createThresholdSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const bounds = readThresholdBoundsOrThrow(parameterValues);
    const selection = resolveThresholdScopeSelection(parameterValues, source.raster.bandCount);
    return { kind: "raster", raster: buildBinaryThresholdStack(source.raster, bounds, selection) };
  };
}

function buildBinaryThresholdStack(
  raster: RasterImage,
  bounds: ThresholdBounds,
  selection: ResolvedCubeScopeSelection,
): RasterImage {
  if (selection.scope === "full-cube") {
    return makeCombinedBinaryStack(raster, bounds);
  }
  return makePerBandBinaryStack(raster, bounds, selection.bandIndexes);
}

function makeCombinedBinaryStack(raster: RasterImage, bounds: ThresholdBounds): RasterImage {
  const combined = applyManualThresholdAcrossBands(raster.bandPixels, bounds);
  return makeBinaryStackFromBands([combined], {
    width: raster.width,
    height: raster.height,
    bandLabels: ["All bands"],
  });
}

function makePerBandBinaryStack(
  raster: RasterImage,
  bounds: ThresholdBounds,
  bandIndexes: ReadonlyArray<number>,
): RasterImage {
  const bands = bandIndexes.map((bandIndex) =>
    applyManualThreshold(getRasterBandPixelsOrThrow(raster, bandIndex), bounds),
  );
  return makeBinaryStackFromBands(bands, {
    width: raster.width,
    height: raster.height,
    bandLabels: bandIndexes.map((bandIndex) => getRasterBandLabelOrDefault(raster, bandIndex)),
  });
}

export function readThresholdBoundsOrThrow(parameterValues: ParameterValuesById): ThresholdBounds {
  const lower = parameterValues[THRESHOLD_LOWER_BOUND_PARAMETER_ID];
  const upper = parameterValues[THRESHOLD_UPPER_BOUND_PARAMETER_ID];
  if (!isFiniteNumber(lower) || !isFiniteNumber(upper)) {
    throw new Error("Threshold needs lower and upper bounds. Adjust the bounds first.");
  }
  return { lower, upper };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveThresholdScopeSelection(
  parameterValues: ParameterValuesById,
  bandCount: number,
): ResolvedCubeScopeSelection {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[THRESHOLD_SCOPE_PARAMETER_ID] ?? BAND_WISE_SCOPE,
    BAND_WISE_SCOPE,
  );
  if (choice !== BAND_WISE_SCOPE) return { scope: "full-cube" };
  return resolveBandWiseThresholdBands(parameterValues, bandCount);
}

function resolveBandWiseThresholdBands(
  parameterValues: ParameterValuesById,
  bandCount: number,
): ResolvedCubeScopeSelection {
  const text = readBandRangeTextOrEmpty(parameterValues[THRESHOLD_BAND_RANGE_PARAMETER_ID]);
  if (text.trim() === "") {
    return { scope: "band-wise", bandIndexes: [readThresholdTargetBandIndex(parameterValues)] };
  }
  const parsed = parseBandRangeText(text, bandCount);
  if (!parsed.ok) throw new Error(parsed.error);
  return { scope: "band-wise", bandIndexes: parsed.bandNumbers.map((bandNumber) => bandNumber - 1) };
}

function readThresholdTargetBandIndex(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[THRESHOLD_TARGET_BAND_PARAMETER_ID];
  if (!isFiniteNumber(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function formatThresholdAppliedLabel(parameterValues: ParameterValuesById): string {
  const bounds = readThresholdBoundsOrThrow(parameterValues);
  const boundsText = `[${formatThresholdBoundForLabel(bounds.lower)}, ${formatThresholdBoundForLabel(bounds.upper)}]`;
  return `Threshold ${boundsText} (${describeThresholdScopeForLabel(parameterValues)})`;
}

function formatThresholdBoundForLabel(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function describeThresholdScopeForLabel(parameterValues: ParameterValuesById): string {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[THRESHOLD_SCOPE_PARAMETER_ID] ?? BAND_WISE_SCOPE,
    BAND_WISE_SCOPE,
  );
  if (choice !== BAND_WISE_SCOPE) return "combined: full stack";
  return `band-wise: bands ${describeThresholdBandSet(parameterValues)}`;
}

function describeThresholdBandSet(parameterValues: ParameterValuesById): string {
  const bandRangeValue: ParameterValue | undefined =
    parameterValues[THRESHOLD_BAND_RANGE_PARAMETER_ID];
  const text = readBandRangeTextOrEmpty(bandRangeValue);
  if (text.trim() === "") return String(readThresholdTargetBandIndex(parameterValues) + 1);
  const parsed = parseBandRangeText(text, Number.MAX_SAFE_INTEGER);
  return parsed.ok ? formatBandNumbersAsRangeText(parsed.bandNumbers) : text.trim();
}
