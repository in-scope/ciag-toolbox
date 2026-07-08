import {
  collectRoiSamples,
  extractCubeSampleMatrixFromRaster,
  type CubeSampleMatrix,
} from "@/lib/image/dimension-reduction/cube-samples";
import {
  DEFAULT_MAX_KEPT_COMPONENTS,
  formatComponentCountLabel,
  resolveComponentCount,
} from "@/lib/image/dimension-reduction/component-count";
import {
  makeComponentStackFromProjection,
  readComponentStackSourceMeta,
  type ComponentProjection,
  type ComponentStackSourceMeta,
} from "@/lib/image/dimension-reduction/transform-output";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  reportProgressFractionAndYield,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";
import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

import type { ComponentCountParameterSchema, ParameterValuesById } from "./parameter-schema";
import {
  clearOperationRegionFromState,
  injectOperationRegionCorners,
  requireOperationRegionForApply,
} from "./operation-region";
import type { RegisteredActionIcon, RegisteredViewportAction } from "./registered-actions";
import type {
  ApplyScope,
  ViewportActionAsyncSourceTransform,
  ViewportRenderingState,
} from "./viewport-action";

// CT-180: the shared foundation that turns a transform's pure fit + project math
// into a full RegisteredViewportAction. Each transform (PCA, MNF, ICA) supplies
// only its math, a label, and an icon; this wires the component-count control,
// the float32 component-stack output (which defaults to "Open in a new panel"
// like every other operation), and the kept-count audit-trail entry once.

export const COMPONENT_COUNT_PARAMETER_ID = "componentCount";
export const DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID = "sourceBandCount";
// CT-182: the chosen fit scope (and the ROI bounds when scope = ROI) ride in the
// parameter values so they are recorded in the audit trail and serialized with
// the operation. The presence of the ROI corner params is what tells the source
// transform to FIT on the ROI; the apply step always projects the whole cube.
export const DIMENSION_REDUCTION_FIT_SCOPE_PARAMETER_ID = "fitScope";
export const WHOLE_IMAGE_FIT_SCOPE = "whole-image";
export const ROI_FIT_SCOPE = "roi";

const DIMENSION_REDUCTION_FIT_ROI_PARAMETER_IDS = {
  x0: "fitRegionImagePixelX0",
  y0: "fitRegionImagePixelY0",
  x1: "fitRegionImagePixelX1",
  y1: "fitRegionImagePixelY1",
} as const;

export interface DimensionReductionTransformConfig<Fit> {
  readonly id: string;
  readonly label: string;
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly loadingMessage?: string;
  readonly componentLabelPrefix: string;
  readonly fit: (samples: CubeSampleMatrix, bandCount: number) => Fit;
  // CT-223: projection reports one progress tick per projected component (the last
  // phase of the transform's phase-based progress). PCA/MNF/ICA all delegate to
  // projectMeanCentredSamplesOntoComponentVectorsReportingProgress.
  readonly project: (
    samples: CubeSampleMatrix,
    fit: Fit,
    keptCount: number,
    onProgress?: UnitProgressCallback,
  ) => Promise<ComponentProjection>;
  readonly describeKeptComponentLabels?: (fit: Fit, keptCount: number) => ReadonlyArray<string>;
}

export function registerDimensionReductionAction<Fit>(
  config: DimensionReductionTransformConfig<Fit>,
): RegisteredViewportAction {
  return {
    id: config.id,
    label: config.label,
    icon: config.icon,
    parameters: [buildComponentCountParameterSchema(config.label)],
    supportsRoiScope: true,
    successMessage: config.successMessage,
    appliedLabel: config.label,
    loadingMessage: config.loadingMessage,
    formatAppliedLabel: (values) => formatDimensionReductionAppliedLabel(config.label, values),
    prepareParameterValuesForApply: buildDimensionReductionPrepareParameterValues(config.label),
    apply: clearOperationRegionFromState,
    clearConsumedSourceStateAfterApply: clearOperationRegionFromState,
    transformSourceAsync: buildDimensionReductionSourceTransform(config),
  };
}

function buildDimensionReductionPrepareParameterValues(
  label: string,
): RegisteredViewportAction["prepareParameterValuesForApply"] {
  return (rawParameterValues, sourceRenderingState, applyScope, sourceRaster) => {
    const withResolvedCount = injectResolvedComponentCountForApply(rawParameterValues, sourceRaster);
    return injectFitScopeForApply(withResolvedCount, sourceRenderingState, applyScope, label);
  };
}

function injectFitScopeForApply(
  parameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
  label: string,
): ParameterValuesById {
  if (applyScope !== "roi") {
    return Object.freeze({ ...parameterValues, [DIMENSION_REDUCTION_FIT_SCOPE_PARAMETER_ID]: WHOLE_IMAGE_FIT_SCOPE });
  }
  const region = requireOperationRegionForApply(sourceRenderingState, label);
  const withRegion = injectOperationRegionCorners(parameterValues, region, DIMENSION_REDUCTION_FIT_ROI_PARAMETER_IDS);
  return Object.freeze({ ...withRegion, [DIMENSION_REDUCTION_FIT_SCOPE_PARAMETER_ID]: ROI_FIT_SCOPE });
}

function buildComponentCountParameterSchema(label: string): ComponentCountParameterSchema {
  return {
    kind: "component-count",
    id: COMPONENT_COUNT_PARAMETER_ID,
    label: "Components",
    description: `How many ${label} components to keep as the bands of the new stack.`,
    defaultValue: DEFAULT_MAX_KEPT_COMPONENTS,
  };
}

function injectResolvedComponentCountForApply(
  rawParameterValues: ParameterValuesById,
  sourceRaster?: RasterImage | null,
): ParameterValuesById {
  if (!sourceRaster) return rawParameterValues;
  const keptCount = resolveComponentCount(
    readComponentCountInput(rawParameterValues),
    sourceRaster.bandCount,
  );
  return Object.freeze({
    ...rawParameterValues,
    [COMPONENT_COUNT_PARAMETER_ID]: keptCount,
    [DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID]: sourceRaster.bandCount,
  });
}

function buildDimensionReductionSourceTransform<Fit>(
  config: DimensionReductionTransformConfig<Fit>,
): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const raster = await runDimensionReductionTransform(config, source.raster, parameterValues, onProgress);
    return { kind: "raster", raster };
  };
}

// CT-223: phase-based progress. There is no per-band loop here, so the bar advances
// through the transform's coarse phases: fit-sample extraction, the fit itself
// (statistics + eigen), projection-sample extraction, then one tick per projected
// component across the second half of the bar.
const FIT_SAMPLES_EXTRACTED_FRACTION = 0.2;
const FIT_COMPLETE_FRACTION = 0.4;
const PROJECTION_SAMPLES_EXTRACTED_FRACTION = 0.5;

async function runDimensionReductionTransform<Fit>(
  config: DimensionReductionTransformConfig<Fit>,
  raster: RasterImage,
  parameterValues: ParameterValuesById,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const keptCount = resolveComponentCount(readComponentCountInput(parameterValues), raster.bandCount);
  await reportProgressFractionAndYield(onProgress, 0);
  const fitSamples = extractFitSamples(raster, parameterValues);
  await reportProgressFractionAndYield(onProgress, FIT_SAMPLES_EXTRACTED_FRACTION);
  const fit = config.fit(fitSamples, raster.bandCount);
  await reportProgressFractionAndYield(onProgress, FIT_COMPLETE_FRACTION);
  const projectionSamples = extractCubeSampleMatrixFromRaster(raster);
  await reportProgressFractionAndYield(onProgress, PROJECTION_SAMPLES_EXTRACTED_FRACTION);
  const projection = await config.project(
    projectionSamples,
    fit,
    keptCount,
    scaleProgressToWindow(onProgress, PROJECTION_SAMPLES_EXTRACTED_FRACTION, 1),
  );
  return makeComponentStackFromProjection(projection, buildStackMeta(config, fit, raster, keptCount));
}

// CT-182: when the fit ROI corners are present the fit consumes ONLY the in-ROI
// pixels; the apply step (extractCubeSampleMatrixFromRaster above) always feeds
// every pixel of the full cube, so the whole image is projected through an
// ROI-derived transform.
function extractFitSamples(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): CubeSampleMatrix {
  const fitRoi = readFitRoiFromParameterValuesIfPresent(parameterValues);
  if (!fitRoi) return extractCubeSampleMatrixFromRaster(raster);
  return collectRoiSamples(raster, fitRoi);
}

function readFitRoiFromParameterValuesIfPresent(
  parameterValues: ParameterValuesById,
): ViewportRoi | null {
  const x0 = parameterValues[DIMENSION_REDUCTION_FIT_ROI_PARAMETER_IDS.x0];
  const y0 = parameterValues[DIMENSION_REDUCTION_FIT_ROI_PARAMETER_IDS.y0];
  const x1 = parameterValues[DIMENSION_REDUCTION_FIT_ROI_PARAMETER_IDS.x1];
  const y1 = parameterValues[DIMENSION_REDUCTION_FIT_ROI_PARAMETER_IDS.y1];
  if (!areAllFitRoiCornersFiniteNumbers(x0, y0, x1, y1)) return null;
  return {
    imagePixelX0: Math.round(x0 as number),
    imagePixelY0: Math.round(y0 as number),
    imagePixelX1: Math.round(x1 as number),
    imagePixelY1: Math.round(y1 as number),
  };
}

function areAllFitRoiCornersFiniteNumbers(x0: unknown, y0: unknown, x1: unknown, y1: unknown): boolean {
  return [x0, y0, x1, y1].every((value) => typeof value === "number" && Number.isFinite(value));
}

function buildStackMeta<Fit>(
  config: DimensionReductionTransformConfig<Fit>,
  fit: Fit,
  raster: RasterImage,
  keptCount: number,
): ComponentStackSourceMeta {
  return {
    ...readComponentStackSourceMeta(raster, config.componentLabelPrefix),
    componentLabels: config.describeKeptComponentLabels?.(fit, keptCount),
  };
}

function formatDimensionReductionAppliedLabel(
  label: string,
  parameterValues: ParameterValuesById,
): string {
  const keptCount = readComponentCountInput(parameterValues);
  if (keptCount === undefined) return label;
  return appendFitScopeSuffix(`${label} (${formatKeptComponentCount(keptCount, parameterValues)})`, parameterValues);
}

function formatKeptComponentCount(keptCount: number, parameterValues: ParameterValuesById): string {
  const bandCount = readSourceBandCount(parameterValues);
  if (bandCount === null) return `${keptCount} components`;
  return `${formatComponentCountLabel(keptCount, bandCount)} components`;
}

// CT-182: a fit on an ROI records the region in the applied label (and the audit
// trail) so the history makes clear the transform was derived from a sub-region
// and projected onto the whole cube.
function appendFitScopeSuffix(label: string, parameterValues: ParameterValuesById): string {
  const fitRoi = readFitRoiFromParameterValuesIfPresent(parameterValues);
  if (!fitRoi) return label;
  const canonical = canonicalizeViewportRoiCorners(fitRoi);
  return (
    `${label} fit on ROI ` +
    `(${canonical.imagePixelX0}, ${canonical.imagePixelY0}) - (${canonical.imagePixelX1}, ${canonical.imagePixelY1})`
  );
}

function readComponentCountInput(parameterValues: ParameterValuesById): number | undefined {
  const raw = parameterValues[COMPONENT_COUNT_PARAMETER_ID];
  return typeof raw === "number" ? raw : undefined;
}

function readSourceBandCount(parameterValues: ParameterValuesById): number | null {
  const raw = parameterValues[DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID];
  return typeof raw === "number" ? raw : null;
}
