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
  parseThresholdOtsuCutoffsFromJson,
  serializeThresholdOtsuCutoffsToJson,
  type ThresholdOtsuCutoffs,
} from "@/lib/image/threshold/otsu-cutoffs";
import {
  applyManualThreshold,
  applyManualThresholdAcrossBands,
  type ThresholdBounds,
} from "@/lib/image/threshold/threshold";
import {
  computeArrayReportingPerUnitProgress,
  reportCompletedUnitAndYieldSoProgressCanPaint,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

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
  type ViewportActionAsyncSourceTransform,
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
// CT-201: present only when the bounds came from the Auto (Otsu) button. Its
// presence marks the cutoff as Otsu-derived in the audit trail; band-wise
// Apply reads each band's own cutoff from it, combined Apply the single
// cutoff over all bands' data together.
export const THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID = "otsuCutoffsJson";

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
  transformSourceAsync: createThresholdSourceTransform(),
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
    ...serializedOtsuCutoffsParameterOrEmpty(sourceRenderingState.thresholdOtsuCutoffs),
    [THRESHOLD_LOWER_BOUND_PARAMETER_ID]: bounds.lower,
    [THRESHOLD_UPPER_BOUND_PARAMETER_ID]: bounds.upper,
    [THRESHOLD_TARGET_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
}

function serializedOtsuCutoffsParameterOrEmpty(
  cutoffs: ThresholdOtsuCutoffs | null,
): ParameterValuesById {
  if (!cutoffs) return NO_OTSU_PARAMETER;
  return { [THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID]: serializeThresholdOtsuCutoffsToJson(cutoffs) };
}

const NO_OTSU_PARAMETER: ParameterValuesById = Object.freeze({});

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
    const selection = resolveThresholdScopeSelection(parameterValues, source.raster.bandCount);
    const otsuCutoffs = readThresholdOtsuCutoffsIfPresent(parameterValues);
    if (otsuCutoffs) {
      return { kind: "raster", raster: await buildOtsuThresholdStack(source.raster, otsuCutoffs, selection, onProgress) };
    }
    const bounds = readThresholdBoundsOrThrow(parameterValues);
    return { kind: "raster", raster: await buildBinaryThresholdStack(source.raster, bounds, selection, onProgress) };
  };
}

// CT-201: an Otsu apply thresholds each band with ITS OWN cutoff (band-wise)
// or every band with the one cutoff derived over the combined data (full stack).
function buildOtsuThresholdStack(
  raster: RasterImage,
  cutoffs: ThresholdOtsuCutoffs,
  selection: ResolvedCubeScopeSelection,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  if (selection.scope === "full-cube") {
    return makeCombinedBinaryStack(raster, cutoffs.combinedBounds, onProgress);
  }
  return makePerBandOtsuBinaryStack(raster, cutoffs, selection.bandIndexes, onProgress);
}

async function makePerBandOtsuBinaryStack(
  raster: RasterImage,
  cutoffs: ThresholdOtsuCutoffs,
  bandIndexes: ReadonlyArray<number>,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const bands = await computeArrayReportingPerUnitProgress(
    bandIndexes.length,
    (position) =>
      applyManualThreshold(
        getRasterBandPixelsOrThrow(raster, bandIndexes[position]!),
        otsuBoundsForBandOrThrow(cutoffs, bandIndexes[position]!),
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
    throw new Error(`Threshold has no Otsu cutoff for band ${bandIndex + 1}. Click Auto again.`);
  }
  return bounds;
}

function readThresholdOtsuCutoffsIfPresent(
  parameterValues: ParameterValuesById,
): ThresholdOtsuCutoffs | null {
  const raw = parameterValues[THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID];
  if (typeof raw !== "string") return null;
  return parseThresholdOtsuCutoffsFromJson(raw);
}

function buildBinaryThresholdStack(
  raster: RasterImage,
  bounds: ThresholdBounds,
  selection: ResolvedCubeScopeSelection,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  if (selection.scope === "full-cube") {
    return makeCombinedBinaryStack(raster, bounds, onProgress);
  }
  return makePerBandBinaryStack(raster, bounds, selection.bandIndexes, onProgress);
}

// The combined output is a single band, so there is no leading 0 tick: the bar
// only appears with the completion tick (the spinner covers the wait).
async function makeCombinedBinaryStack(
  raster: RasterImage,
  bounds: ThresholdBounds,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const combined = applyManualThresholdAcrossBands(raster.bandPixels, bounds);
  await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, 1, 1);
  return makeBinaryStackFromBands([combined], {
    width: raster.width,
    height: raster.height,
    bandLabels: ["All bands"],
  });
}

async function makePerBandBinaryStack(
  raster: RasterImage,
  bounds: ThresholdBounds,
  bandIndexes: ReadonlyArray<number>,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const bands = await computeArrayReportingPerUnitProgress(
    bandIndexes.length,
    (position) => applyManualThreshold(getRasterBandPixelsOrThrow(raster, bandIndexes[position]!), bounds),
    onProgress,
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
  const otsuCutoffs = readThresholdOtsuCutoffsIfPresent(parameterValues);
  if (otsuCutoffs) return formatOtsuThresholdAppliedLabel(parameterValues, otsuCutoffs);
  const bounds = readThresholdBoundsOrThrow(parameterValues);
  const boundsText = `[${formatThresholdBoundForLabel(bounds.lower)}, ${formatThresholdBoundForLabel(bounds.upper)}]`;
  return `Threshold ${boundsText} (${describeThresholdScopeForLabel(parameterValues)})`;
}

// CT-201: the audit trail records that the cutoff was Otsu-derived and its
// value(s); band-wise scope surfaces the per-band cutoff list here ONLY (the
// popup keeps showing just the current band's bounds).
function formatOtsuThresholdAppliedLabel(
  parameterValues: ParameterValuesById,
  cutoffs: ThresholdOtsuCutoffs,
): string {
  const choice = readCubeScopeChoiceOrDefault(
    parameterValues[THRESHOLD_SCOPE_PARAMETER_ID] ?? BAND_WISE_SCOPE,
    BAND_WISE_SCOPE,
  );
  if (choice !== BAND_WISE_SCOPE) {
    const cutoffText = formatThresholdBoundForLabel(cutoffs.combinedBounds.lower);
    return `Threshold Otsu (cutoff ${cutoffText}, combined: full stack)`;
  }
  return `Threshold Otsu (band-wise cutoffs: ${describePerBandOtsuCutoffs(parameterValues, cutoffs)})`;
}

function describePerBandOtsuCutoffs(
  parameterValues: ParameterValuesById,
  cutoffs: ThresholdOtsuCutoffs,
): string {
  const selection = resolveThresholdScopeSelection(parameterValues, cutoffs.perBandBounds.length);
  if (selection.scope !== "band-wise") return "";
  return selection.bandIndexes
    .map((bandIndex) => describeSingleBandOtsuCutoff(cutoffs, bandIndex))
    .join(", ");
}

function describeSingleBandOtsuCutoff(cutoffs: ThresholdOtsuCutoffs, bandIndex: number): string {
  return `band ${bandIndex + 1}: ${formatThresholdBoundForLabel(otsuBoundsForBandOrThrow(cutoffs, bandIndex).lower)}`;
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
