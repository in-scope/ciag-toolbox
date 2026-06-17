import {
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

import type { ComponentCountParameterSchema, ParameterValuesById } from "./parameter-schema";
import type { RegisteredActionIcon, RegisteredViewportAction } from "./registered-actions";
import type { ViewportActionSourceTransform } from "./viewport-action";

// CT-180: the shared foundation that turns a transform's pure fit + project math
// into a full RegisteredViewportAction. Each transform (PCA, MNF, ICA) supplies
// only its math, a label, and an icon; this wires the component-count control,
// the float32 component-stack output (which defaults to "Open in a new panel"
// like every other operation), and the kept-count audit-trail entry once.

export const COMPONENT_COUNT_PARAMETER_ID = "componentCount";
export const DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID = "sourceBandCount";

export interface DimensionReductionTransformConfig<Fit> {
  readonly id: string;
  readonly label: string;
  readonly icon: RegisteredActionIcon;
  readonly successMessage: string;
  readonly loadingMessage?: string;
  readonly componentLabelPrefix: string;
  readonly fit: (samples: CubeSampleMatrix, bandCount: number) => Fit;
  readonly project: (samples: CubeSampleMatrix, fit: Fit, keptCount: number) => ComponentProjection;
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
    successMessage: config.successMessage,
    appliedLabel: config.label,
    loadingMessage: config.loadingMessage,
    formatAppliedLabel: (values) => formatDimensionReductionAppliedLabel(config.label, values),
    prepareParameterValuesForApply: injectResolvedComponentCountForApply,
    apply: (state) => state,
    transformSource: buildDimensionReductionSourceTransform(config),
  };
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
  _sourceRenderingState: unknown,
  _applyScope: unknown,
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
): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const raster = runDimensionReductionTransform(config, source.raster, parameterValues);
    return { kind: "raster", raster };
  };
}

function runDimensionReductionTransform<Fit>(
  config: DimensionReductionTransformConfig<Fit>,
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): RasterImage {
  const keptCount = resolveComponentCount(readComponentCountInput(parameterValues), raster.bandCount);
  const fitSamples = extractCubeSampleMatrixFromRaster(raster);
  const fit = config.fit(fitSamples, raster.bandCount);
  const projection = config.project(fitSamples, fit, keptCount);
  return makeComponentStackFromProjection(projection, buildStackMeta(config, fit, raster, keptCount));
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
  const bandCount = readSourceBandCount(parameterValues);
  if (bandCount === null) return `${label} (${keptCount} components)`;
  return `${label} (${formatComponentCountLabel(keptCount, bandCount)} components)`;
}

function readComponentCountInput(parameterValues: ParameterValuesById): number | undefined {
  const raw = parameterValues[COMPONENT_COUNT_PARAMETER_ID];
  return typeof raw === "number" ? raw : undefined;
}

function readSourceBandCount(parameterValues: ParameterValuesById): number | null {
  const raw = parameterValues[DIMENSION_REDUCTION_SOURCE_BAND_COUNT_PARAMETER_ID];
  return typeof raw === "number" ? raw : null;
}
