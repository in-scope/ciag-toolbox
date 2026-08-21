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
  computeOtsuCutoffsForRasterReportingProgress,
  type ThresholdOtsuCutoffs,
} from "@/lib/image/threshold/otsu-cutoffs";
import {
  applyManualThreshold,
  type ThresholdBounds,
} from "@/lib/image/threshold/threshold";
import {
  computeArrayReportingPerUnitProgress,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

import {
  BAND_WISE_SCOPE,
  FULL_CUBE_SCOPE,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  type CubeScopeChoice,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
  type ResolvedCubeScopeSelection,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  clearThresholdEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionAsyncSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-200/CT-282: thresholding produces a binary stack (2-level 8-bit) and
// NEVER combines bands. The Manual method's live bounds ride in
// ViewportRenderingState.thresholdBounds (written by the embedded editor);
// Apply injects them into the parameter values so the audit trail records the
// exact bounds and scope. Full-stack scope applies the bounds uniformly to
// every band (one binary band per source band); band-wise thresholds the
// entered bands. The Otsu method has no bounds fields: its cutoffs are
// derived from the histogram(s) inside the Apply transform.

export const THRESHOLD_ACTION_ID = "threshold";
export const THRESHOLD_METHOD_PARAMETER_ID = "method";
export const MANUAL_THRESHOLD_METHOD = "manual";
export const OTSU_THRESHOLD_METHOD = "otsu";
export const THRESHOLD_SCOPE_PARAMETER_ID = "scope";
export const THRESHOLD_BAND_RANGE_PARAMETER_ID = "bandRange";
export const THRESHOLD_OTSU_SCOPE_PARAMETER_ID = "otsuScope";
export const THRESHOLD_TARGET_BAND_PARAMETER_ID = "targetBandIndex";
export const THRESHOLD_LOWER_BOUND_PARAMETER_ID = "lowerBound";
export const THRESHOLD_UPPER_BOUND_PARAMETER_ID = "upperBound";

const THRESHOLD_METHOD_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: THRESHOLD_METHOD_PARAMETER_ID,
  label: "Method",
  description: "Otsu derives the cutoff automatically at Apply.",
  defaultValue: MANUAL_THRESHOLD_METHOD,
  options: [
    { value: MANUAL_THRESHOLD_METHOD, label: "Manual" },
    { value: OTSU_THRESHOLD_METHOD, label: "Otsu threshold" },
  ],
};

const THRESHOLD_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: THRESHOLD_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Band-wise turns each entered band into its own black/white band. Full stack applies " +
    "the bounds to every band, keeping the stack's band count.",
  defaultValue: BAND_WISE_SCOPE,
  bandRangeParameterId: THRESHOLD_BAND_RANGE_PARAMETER_ID,
  visibleWhen: {
    parameterId: THRESHOLD_METHOD_PARAMETER_ID,
    equals: MANUAL_THRESHOLD_METHOD,
  },
};

const THRESHOLD_OTSU_SCOPE_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: THRESHOLD_OTSU_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Full stack derives one cutoff over all bands together; band-wise derives each band's " +
    "own cutoff. The output keeps the stack's band count.",
  defaultValue: BAND_WISE_SCOPE,
  options: [
    { value: FULL_CUBE_SCOPE, label: "Full stack" },
    { value: BAND_WISE_SCOPE, label: "Band-wise (cutoff per band)" },
  ],
  visibleWhen: {
    parameterId: THRESHOLD_METHOD_PARAMETER_ID,
    equals: OTSU_THRESHOLD_METHOD,
  },
  hiddenForSingleBandSource: true,
};

export const THRESHOLD_ACTION: RegisteredViewportAction = {
  id: THRESHOLD_ACTION_ID,
  label: "Threshold",
  icon: Contrast,
  parameters: [
    THRESHOLD_METHOD_PARAMETER_SCHEMA,
    THRESHOLD_SCOPE_PARAMETER_SCHEMA,
    THRESHOLD_OTSU_SCOPE_PARAMETER_SCHEMA,
  ],
  successMessage: "Threshold applied",
  appliedLabel: "Threshold",
  loadingMessage: "Applying threshold...",
  formatAppliedLabel: formatThresholdAppliedLabel,
  prepareParameterValuesForApply: injectThresholdBoundsForApply,
  apply: resetStateForBinaryThresholdOutput,
  clearConsumedSourceStateAfterApply: clearThresholdEditingState,
  transformSourceAsync: createThresholdSourceTransform(),
};

export function readThresholdMethodChoice(parameterValues: ParameterValuesById): string {
  const raw = parameterValues[THRESHOLD_METHOD_PARAMETER_ID];
  return raw === OTSU_THRESHOLD_METHOD ? OTSU_THRESHOLD_METHOD : MANUAL_THRESHOLD_METHOD;
}

function injectThresholdBoundsForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  if (readThresholdMethodChoice(rawParameterValues) === OTSU_THRESHOLD_METHOD) {
    return rawParameterValues;
  }
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

function createThresholdSourceTransform(): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const raster =
      readThresholdMethodChoice(parameterValues) === OTSU_THRESHOLD_METHOD
        ? await buildOtsuThresholdStackDerivingCutoffsAtApply(source.raster, parameterValues, onProgress)
        : await buildManualThresholdStack(source.raster, parameterValues, onProgress);
    return { kind: "raster", raster };
  };
}

function buildManualThresholdStack(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const bounds = readThresholdBoundsOrThrow(parameterValues);
  const selection = resolveThresholdScopeSelection(parameterValues, raster.bandCount);
  const bandIndexes =
    selection.scope === "full-cube" ? listEveryBandIndex(raster.bandCount) : selection.bandIndexes;
  return makeBinaryStackThresholdingEachBand(raster, bandIndexes, () => bounds, onProgress);
}

// CT-282: Otsu derives its cutoff(s) inside the Apply transform - one cutoff
// over the combined histogram for the full-stack scope, or each band's own
// cutoff for band-wise - and thresholds EVERY band, so the output keeps the
// source band count under both scopes.
async function buildOtsuThresholdStackDerivingCutoffsAtApply(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const cutoffs = await computeOtsuCutoffsForRasterReportingProgress(
    raster,
    scaleProgressToWindow(onProgress, 0, 0.5),
  );
  return makeBinaryStackThresholdingEachBand(
    raster,
    listEveryBandIndex(raster.bandCount),
    pickOtsuBoundsPerBand(parameterValues, cutoffs),
    scaleProgressToWindow(onProgress, 0.5, 1),
  );
}

function pickOtsuBoundsPerBand(
  parameterValues: ParameterValuesById,
  cutoffs: ThresholdOtsuCutoffs,
): (bandIndex: number) => ThresholdBounds {
  if (readThresholdOtsuScopeChoice(parameterValues) === FULL_CUBE_SCOPE) {
    return () => cutoffs.combinedBounds;
  }
  return (bandIndex) => otsuBoundsForBandOrThrow(cutoffs, bandIndex);
}

export function readThresholdOtsuScopeChoice(
  parameterValues: ParameterValuesById,
): CubeScopeChoice {
  return readCubeScopeChoiceOrDefault(
    parameterValues[THRESHOLD_OTSU_SCOPE_PARAMETER_ID] ?? BAND_WISE_SCOPE,
    BAND_WISE_SCOPE,
  );
}

function listEveryBandIndex(bandCount: number): number[] {
  return Array.from({ length: bandCount }, (_, bandIndex) => bandIndex);
}

async function makeBinaryStackThresholdingEachBand(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  boundsForBandIndex: (bandIndex: number) => ThresholdBounds,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const bands = await computeArrayReportingPerUnitProgress(
    bandIndexes.length,
    (position) =>
      applyManualThreshold(
        getRasterBandPixelsOrThrow(raster, bandIndexes[position]!),
        boundsForBandIndex(bandIndexes[position]!),
      ),
    onProgress,
  );
  return makeBinaryStackFromBands(bands, {
    width: raster.width,
    height: raster.height,
    bandLabels: bandIndexes.map((bandIndex) => getRasterBandLabelOrDefault(raster, bandIndex)),
  });
}

function otsuBoundsForBandOrThrow(
  cutoffs: ThresholdOtsuCutoffs,
  bandIndex: number,
): ThresholdBounds {
  const bounds = cutoffs.perBandBounds[bandIndex];
  if (!bounds) {
    throw new Error(`Threshold derived no Otsu cutoff for band ${bandIndex + 1}.`);
  }
  return bounds;
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
  if (readThresholdMethodChoice(parameterValues) === OTSU_THRESHOLD_METHOD) {
    return `Threshold Otsu (${describeThresholdOtsuScopeForLabel(parameterValues)})`;
  }
  const bounds = readThresholdBoundsOrThrow(parameterValues);
  const boundsText = `[${formatThresholdBoundForLabel(bounds.lower)}, ${formatThresholdBoundForLabel(bounds.upper)}]`;
  return `Threshold ${boundsText} (${describeThresholdScopeForLabel(parameterValues)})`;
}

function describeThresholdOtsuScopeForLabel(parameterValues: ParameterValuesById): string {
  if (readThresholdOtsuScopeChoice(parameterValues) === FULL_CUBE_SCOPE) return "full stack";
  return "band-wise";
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
  if (choice !== BAND_WISE_SCOPE) return "full stack";
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
