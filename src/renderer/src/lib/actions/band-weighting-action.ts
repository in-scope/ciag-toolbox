import { Scale } from "lucide-react";

import { computeWeightedSumReportingProgress } from "@/lib/image/band-ops/band-weighting";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import {
  EMPTY_PINNED_ROI_SPECTRA,
  EMPTY_PINNED_SPECTRA,
} from "@/lib/image/spectrum-entry";
import type { RasterImage } from "@/lib/image/raster-image";

import type { ParameterValuesById } from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import {
  clearBandWeightingEditingState,
  EMPTY_REMOVED_BAND_INDEXES,
  type ViewportActionAsyncSourceTransform,
  type ViewportRenderingState,
} from "./viewport-action";

// CT-209: combine every band into one weighted-sum image. The per-band weights
// are set by hand, by a quick Python formula, or by an imported tool (all through
// the CT-208 scripting worker); a formula/tool result just populates the same
// editable weight fields. The weights ride in ViewportRenderingState (written by
// the embedded editor) and Apply injects them into the parameter values so the
// audit trail records them. The output is a NEW single-band float32 stack.

export const BAND_WEIGHTING_ACTION_ID = "band-weighting";
const BAND_WEIGHTING_WEIGHTS_PARAMETER_ID = "weightsJson";
const WEIGHTED_SUM_BAND_LABEL = "Weighted sum";

export const BAND_WEIGHTING_ACTION: RegisteredViewportAction = {
  id: BAND_WEIGHTING_ACTION_ID,
  label: "Band Weighting",
  icon: Scale,
  successMessage: "Band weighting applied",
  appliedLabel: "Band weighting",
  loadingMessage: "Computing weighted sum...",
  formatAppliedLabel: formatBandWeightingAppliedLabel,
  prepareParameterValuesForApply: injectBandWeightsForApply,
  apply: resetStateForWeightedSumOutput,
  clearConsumedSourceStateAfterApply: clearBandWeightingEditingState,
  supportsStopDuringApply: true,
  transformSourceAsync: createBandWeightingSourceTransform(),
};

function injectBandWeightsForApply(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  const weights = sourceRenderingState.bandWeights;
  if (!weights) {
    throw new Error("Band weighting needs a weight for each band. Set the weights first.");
  }
  return Object.freeze({
    ...rawParameterValues,
    [BAND_WEIGHTING_WEIGHTS_PARAMETER_ID]: JSON.stringify([...weights]),
  });
}

// The weighted sum is a single band, so band-dependent viewer state (selected
// band, subset edit mode, pinned spectra) resets like the other band-count-changing
// operations, and the consumed editing weights clear.
function resetStateForWeightedSumOutput(state: ViewportRenderingState): ViewportRenderingState {
  return clearBandWeightingEditingState({
    ...state,
    selectedBandIndex: 0,
    removedBandIndexes: EMPTY_REMOVED_BAND_INDEXES,
    isBandSubsetEditModeActive: false,
    pinnedSpectra: EMPTY_PINNED_SPECTRA,
    pinnedRoiSpectra: EMPTY_PINNED_ROI_SPECTRA,
  });
}

// CT-240: the weighted sum sweeps every band at every pixel, so at reference
// scale it runs as an async transform - chunked with paint yields and a
// determinate progress fraction - instead of blocking the renderer.
function createBandWeightingSourceTransform(): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress, abortSignal) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const weights = readBandWeightsOrThrow(parameterValues);
    return { kind: "raster", raster: await buildWeightedSumStack(source.raster, weights, onProgress, abortSignal) };
  };
}

async function buildWeightedSumStack(
  raster: RasterImage,
  weights: ReadonlyArray<number>,
  onProgress?: (fraction: number) => void,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  const band = await computeWeightedSumReportingProgress(raster.bandPixels, weights, onProgress, abortSignal);
  return makeFloat32RasterFromBands(
    { width: raster.width, height: raster.height, bandLabels: [WEIGHTED_SUM_BAND_LABEL] },
    [band],
  );
}

export function readBandWeightsOrThrow(parameterValues: ParameterValuesById): number[] {
  const raw = parameterValues[BAND_WEIGHTING_WEIGHTS_PARAMETER_ID];
  if (typeof raw !== "string") {
    throw new Error("Band weighting needs a weight for each band. Set the weights first.");
  }
  return parseBandWeightsJson(raw);
}

function parseBandWeightsJson(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isFiniteNumber)) {
    throw new Error("Band weighting received malformed weights.");
  }
  return parsed;
}

function readBandWeightsForLabelOrNull(parameterValues: ParameterValuesById): number[] | null {
  const raw = parameterValues[BAND_WEIGHTING_WEIGHTS_PARAMETER_ID];
  if (typeof raw !== "string") return null;
  return parseBandWeightsJson(raw);
}

function formatBandWeightingAppliedLabel(parameterValues: ParameterValuesById): string {
  const weights = readBandWeightsForLabelOrNull(parameterValues);
  if (!weights) return "Band weighting";
  return `Band weighting (weights: ${weights.map(formatWeightForLabel).join(", ")})`;
}

function formatWeightForLabel(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(3);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
