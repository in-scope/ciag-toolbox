import { FoldVertical } from "lucide-react";

import {
  applyPercentileClip,
  assertPercentileClipBoundsAreValid,
  clampValuesToCutPoints,
  type PercentileClipBounds,
} from "@/lib/image/filters/percentile-clip";
import { computeWholeStackPercentileCutPoints } from "@/lib/image/filters/whole-stack-percentile";
import {
  makeFloatRasterFromBandComputationReportingProgress,
  makeFloatRasterReusingUnchangedSourceBandsReportingProgress,
} from "@/lib/image/make-float-raster";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import { scaleProgressToWindow, type UnitProgressCallback } from "@/lib/image/unit-progress";

import {
  describeCubeScopeForAppliedLabel,
  injectSourceBandCountForBandWiseLabels,
  resolveScopedBandIndexSet,
  type CubeScopeParameterIds,
} from "./band-scope-selection";
import {
  FULL_CUBE_SCOPE,
  readClipBoundOrDefault,
  readCubeScopeChoiceOrDefault,
  type ClipBoundsParameterSchema,
  type CubeScopeParameterSchema,
  type ParameterValuesById,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import type {
  ApplyScope,
  ViewportActionAsyncSourceTransform,
  ViewportRenderingState,
} from "./viewport-action";

// CT-205: percentile clipping (np.clip semantics) with the locked scope
// control deciding WHERE the cut points come from: Full stack computes one
// pair of percentile cut points over every band together and clips the whole
// stack to it; Band-wise computes each entered band's own cut points from
// that band alone (an empty field means every band, CT-251) and carries the
// other bands through unchanged. Output is
// always float32 with the source's dimensions and band count (Stage 3 float
// path).

export const PERCENTILE_CLIP_ACTION_ID = "percentile-clip";
export const PERCENTILE_CLIP_LOWER_PARAMETER_ID = "lowerPercentile";
export const PERCENTILE_CLIP_UPPER_PARAMETER_ID = "upperPercentile";
export const PERCENTILE_CLIP_SCOPE_PARAMETER_ID = "scope";
export const PERCENTILE_CLIP_BAND_RANGE_PARAMETER_ID = "bandRange";
const PERCENTILE_CLIP_BAND_COUNT_PARAMETER_ID = "sourceBandCount";

const DEFAULT_LOWER_PERCENTILE = 2;
const DEFAULT_UPPER_PERCENTILE = 98;

const PERCENTILE_CLIP_SCOPE_IDS: CubeScopeParameterIds = {
  scopeParameterId: PERCENTILE_CLIP_SCOPE_PARAMETER_ID,
  bandRangeParameterId: PERCENTILE_CLIP_BAND_RANGE_PARAMETER_ID,
  bandCountParameterId: PERCENTILE_CLIP_BAND_COUNT_PARAMETER_ID,
};

const PERCENTILE_CLIP_BOUNDS_PARAMETER_SCHEMA: ClipBoundsParameterSchema = {
  kind: "clip-bounds",
  id: "percentiles",
  label: "Percentiles",
  description:
    "Percentiles from 0 to 100. Values below the lower percentile's cut point are raised " +
    "to it; values above the upper percentile's cut point are lowered to it.",
  loParameterId: PERCENTILE_CLIP_LOWER_PARAMETER_ID,
  hiParameterId: PERCENTILE_CLIP_UPPER_PARAMETER_ID,
  loLabel: "Lower percentile",
  hiLabel: "Upper percentile",
  defaultLo: DEFAULT_LOWER_PERCENTILE,
  defaultHi: DEFAULT_UPPER_PERCENTILE,
};

const PERCENTILE_CLIP_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: PERCENTILE_CLIP_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Full stack computes one pair of cut points over every band together and clips the " +
    "whole stack to it. Band-wise computes each entered band's own cut points and carries " +
    "the other bands through unchanged. Leave the band field empty to process every band.",
  defaultValue: FULL_CUBE_SCOPE,
  bandRangeParameterId: PERCENTILE_CLIP_BAND_RANGE_PARAMETER_ID,
  emptyBandRangeMeansAllBands: true,
};

export const PERCENTILE_CLIP_ACTION: RegisteredViewportAction = {
  id: PERCENTILE_CLIP_ACTION_ID,
  label: "Percentile Clip",
  icon: FoldVertical,
  parameters: [PERCENTILE_CLIP_BOUNDS_PARAMETER_SCHEMA, PERCENTILE_CLIP_SCOPE_PARAMETER_SCHEMA],
  successMessage: "Percentile clip applied",
  appliedLabel: "Percentile clip",
  loadingMessage: "Clipping stack to percentiles...",
  formatAppliedLabel: formatPercentileClipAppliedLabel,
  prepareParameterValuesForApply: injectSourceBandCountIntoPercentileClipParameters,
  apply: (state) => state,
  transformSourceAsync: createPercentileClipSourceTransform(),
};

// CT-251: the source band count is captured at Apply time so an empty-field
// band-wise apply can record the full band range in its History label.
function injectSourceBandCountIntoPercentileClipParameters(
  rawParameterValues: ParameterValuesById,
  _sourceRenderingState: ViewportRenderingState,
  _applyScope: ApplyScope,
  sourceRaster?: RasterImage | null,
): ParameterValuesById {
  return injectSourceBandCountForBandWiseLabels(
    PERCENTILE_CLIP_SCOPE_IDS,
    rawParameterValues,
    sourceRaster,
  );
}

export function readPercentileClipBounds(
  parameterValues: ParameterValuesById,
): PercentileClipBounds {
  return {
    lowerPercentile: readClipBoundOrDefault(
      parameterValues[PERCENTILE_CLIP_LOWER_PARAMETER_ID],
      DEFAULT_LOWER_PERCENTILE,
    ),
    upperPercentile: readClipBoundOrDefault(
      parameterValues[PERCENTILE_CLIP_UPPER_PARAMETER_ID],
      DEFAULT_UPPER_PERCENTILE,
    ),
  };
}

function createPercentileClipSourceTransform(): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const bounds = readPercentileClipBounds(parameterValues);
    assertPercentileClipBoundsAreValid(bounds);
    const raster = await clipRasterBandsToPercentiles(source.raster, parameterValues, bounds, onProgress);
    return { kind: "raster", raster };
  };
}

function clipRasterBandsToPercentiles(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
  bounds: PercentileClipBounds,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  if (readPercentileClipScopeChoice(parameterValues) === FULL_CUBE_SCOPE) {
    return clipEveryBandToWholeStackCutPoints(raster, bounds, onProgress);
  }
  const clippedBandIndexes = resolveScopedBandIndexSet(
    PERCENTILE_CLIP_SCOPE_IDS,
    parameterValues,
    raster.bandCount,
  );
  return clipEachBandToItsOwnCutPoints(raster, clippedBandIndexes, bounds, onProgress);
}

// CT-219c: the cut points come from whole-stack-percentile.ts (no stack
// concatenation, so reference-scale stacks no longer fail allocation); the cut
// point phase fills the first half of the busy bar, the clamp loop the second.
const CUT_POINT_PHASE_END_FRACTION = 0.5;

async function clipEveryBandToWholeStackCutPoints(
  raster: RasterImage,
  bounds: PercentileClipBounds,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const cutPoints = await computeWholeStackPercentileCutPoints(
    raster.bandPixels,
    bounds,
    scaleProgressToWindow(onProgress, 0, CUT_POINT_PHASE_END_FRACTION),
  );
  return makeFloatRasterFromBandComputationReportingProgress(
    raster,
    (band) => clampValuesToCutPoints(band, cutPoints),
    scaleProgressToWindow(onProgress, CUT_POINT_PHASE_END_FRACTION, 1),
  );
}

function clipEachBandToItsOwnCutPoints(
  raster: RasterImage,
  clippedBandIndexes: ReadonlySet<number>,
  bounds: PercentileClipBounds,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  return makeFloatRasterReusingUnchangedSourceBandsReportingProgress(
    raster,
    clippedBandIndexes,
    (band) => applyPercentileClip(band, bounds),
    onProgress,
  );
}

function readPercentileClipScopeChoice(parameterValues: ParameterValuesById): string {
  return readCubeScopeChoiceOrDefault(
    parameterValues[PERCENTILE_CLIP_SCOPE_PARAMETER_ID] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
}

function formatPercentileClipAppliedLabel(parameterValues: ParameterValuesById): string {
  const bounds = readPercentileClipBounds(parameterValues);
  const scopeText = describeCubeScopeForAppliedLabel(PERCENTILE_CLIP_SCOPE_IDS, parameterValues);
  const boundsText = `${formatPercentileForLabel(bounds.lowerPercentile)} - ${formatPercentileForLabel(bounds.upperPercentile)}%`;
  return `Percentile clip (${boundsText}, ${scopeText})`;
}

function formatPercentileForLabel(percentile: number): string {
  if (Number.isInteger(percentile)) return String(percentile);
  return percentile.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
