import { Droplets } from "lucide-react";

import {
  applyDenoiseToBandInChunksReportingProgress,
  type DenoiseMethod,
  type DenoiseSettings,
} from "@/lib/image/filters/denoise";
import { makeFloatRasterReusingUnchangedSourceBandsReportingProgress } from "@/lib/image/make-float-raster";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";

import {
  describeCubeScopeForAppliedLabel,
  injectSelectedBandAsBandWiseDefault,
  resolveScopedBandIndexSet,
  type CubeScopeParameterIds,
} from "./band-scope-selection";
import {
  FULL_CUBE_SCOPE,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type IntegerParameterSchema,
  type NumberParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import type { ViewportActionAsyncSourceTransform, ViewportRenderingState } from "./viewport-action";

// CT-204: denoising within each band's picture. The method selector picks a
// Gaussian blur (separable convolution, sigma) or a median rank filter
// (radius); each method shows only its own parameter field. The locked scope
// control decides which bands are denoised: Full stack denoises every band,
// Band-wise denoises only the entered bands and carries the rest through
// unchanged, so the output stack always keeps the source's dimensions
// (float32 via the Stage 3 float path).

export const DENOISE_ACTION_ID = "denoise";
export const DENOISE_METHOD_PARAMETER_ID = "method";
export const DENOISE_GAUSSIAN_SIGMA_PARAMETER_ID = "gaussianSigma";
export const DENOISE_MEDIAN_RADIUS_PARAMETER_ID = "medianRadius";
export const DENOISE_SCOPE_PARAMETER_ID = "scope";
export const DENOISE_BAND_RANGE_PARAMETER_ID = "bandRange";
const DENOISE_TARGET_BAND_PARAMETER_ID = "targetBandIndex";

const GAUSSIAN_METHOD_VALUE = "gaussian" satisfies DenoiseMethod;
const MEDIAN_METHOD_VALUE = "median" satisfies DenoiseMethod;

const DEFAULT_GAUSSIAN_SIGMA = 1;
const DEFAULT_MEDIAN_RADIUS = 1;

const DENOISE_SCOPE_IDS: CubeScopeParameterIds = {
  scopeParameterId: DENOISE_SCOPE_PARAMETER_ID,
  bandRangeParameterId: DENOISE_BAND_RANGE_PARAMETER_ID,
  targetBandParameterId: DENOISE_TARGET_BAND_PARAMETER_ID,
};

const DENOISE_METHOD_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: DENOISE_METHOD_PARAMETER_ID,
  label: "Method",
  description:
    "Gaussian smooths every pixel with its neighbours (best for fine grain noise). " +
    "Median replaces each pixel with its neighbourhood median (best for isolated " +
    "salt-and-pepper spikes; keeps edges sharp).",
  defaultValue: GAUSSIAN_METHOD_VALUE,
  options: [
    { value: GAUSSIAN_METHOD_VALUE, label: "Gaussian" },
    { value: MEDIAN_METHOD_VALUE, label: "Median" },
  ],
};

const DENOISE_GAUSSIAN_SIGMA_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: DENOISE_GAUSSIAN_SIGMA_PARAMETER_ID,
  label: "Sigma",
  description: "Blur strength in pixels; larger sigma smooths over a wider neighbourhood.",
  defaultValue: DEFAULT_GAUSSIAN_SIGMA,
  min: 0.1,
  max: 10,
  step: 0.1,
  visibleWhen: { parameterId: DENOISE_METHOD_PARAMETER_ID, equals: GAUSSIAN_METHOD_VALUE },
};

const DENOISE_MEDIAN_RADIUS_PARAMETER_SCHEMA: IntegerParameterSchema = {
  kind: "integer",
  id: DENOISE_MEDIAN_RADIUS_PARAMETER_ID,
  label: "Radius",
  description:
    "Neighbourhood radius in pixels; radius 1 ranks a 3 x 3 window around each pixel.",
  defaultValue: DEFAULT_MEDIAN_RADIUS,
  min: 1,
  max: 10,
  visibleWhen: { parameterId: DENOISE_METHOD_PARAMETER_ID, equals: MEDIAN_METHOD_VALUE },
};

const DENOISE_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: DENOISE_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Full stack denoises every band's picture. Band-wise denoises only the entered bands " +
    "(defaults to the current band) and carries the other bands through unchanged.",
  defaultValue: FULL_CUBE_SCOPE,
  bandRangeParameterId: DENOISE_BAND_RANGE_PARAMETER_ID,
};

export const DENOISE_ACTION: RegisteredViewportAction = {
  id: DENOISE_ACTION_ID,
  label: "Denoise",
  icon: Droplets,
  parameters: [
    DENOISE_METHOD_PARAMETER_SCHEMA,
    DENOISE_GAUSSIAN_SIGMA_PARAMETER_SCHEMA,
    DENOISE_MEDIAN_RADIUS_PARAMETER_SCHEMA,
    DENOISE_SCOPE_PARAMETER_SCHEMA,
  ],
  successMessage: "Denoise applied",
  appliedLabel: "Denoise",
  loadingMessage: "Denoising stack...",
  formatAppliedLabel: formatDenoiseAppliedLabel,
  prepareParameterValuesForApply: injectSelectedBandIntoDenoiseParameters,
  apply: (state) => state,
  transformSourceAsync: createDenoiseSourceTransform(),
};

// Band-wise scope with an empty range falls back to the band the user is
// looking at, so the viewed band is captured at Apply time (threshold pattern).
function injectSelectedBandIntoDenoiseParameters(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return injectSelectedBandAsBandWiseDefault(
    DENOISE_SCOPE_IDS,
    rawParameterValues,
    sourceRenderingState,
  );
}

export function readDenoiseSettings(parameterValues: ParameterValuesById): DenoiseSettings {
  if (readDenoiseMethod(parameterValues) === MEDIAN_METHOD_VALUE) {
    return {
      method: MEDIAN_METHOD_VALUE,
      radius: readFiniteNumberOrDefault(
        parameterValues[DENOISE_MEDIAN_RADIUS_PARAMETER_ID],
        DEFAULT_MEDIAN_RADIUS,
      ),
    };
  }
  return {
    method: GAUSSIAN_METHOD_VALUE,
    sigma: readFiniteNumberOrDefault(
      parameterValues[DENOISE_GAUSSIAN_SIGMA_PARAMETER_ID],
      DEFAULT_GAUSSIAN_SIGMA,
    ),
  };
}

function readDenoiseMethod(parameterValues: ParameterValuesById): DenoiseMethod {
  const raw = parameterValues[DENOISE_METHOD_PARAMETER_ID];
  return raw === MEDIAN_METHOD_VALUE ? raw : GAUSSIAN_METHOD_VALUE;
}

function readFiniteNumberOrDefault(value: ParameterValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createDenoiseSourceTransform(): ViewportActionAsyncSourceTransform {
  return async (rawSource, parameterValues, onProgress) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const settings = readDenoiseSettings(parameterValues);
    const denoisedBandIndexes = resolveScopedBandIndexSet(
      DENOISE_SCOPE_IDS,
      parameterValues,
      source.raster.bandCount,
    );
    const raster = await denoiseBandsOfRaster(source.raster, denoisedBandIndexes, settings, onProgress);
    return { kind: "raster", raster };
  };
}

// CT-226: each band's kernel work runs in row chunks reporting a within-band
// fraction, so the busy bar advances continuously through a slow band instead of
// jumping once per band.
function denoiseBandsOfRaster(
  raster: RasterImage,
  denoisedBandIndexes: ReadonlySet<number>,
  settings: DenoiseSettings,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const shape = { width: raster.width, height: raster.height };
  return makeFloatRasterReusingUnchangedSourceBandsReportingProgress(
    raster,
    denoisedBandIndexes,
    (band, _bandIndex, onWithinBandProgress) =>
      applyDenoiseToBandInChunksReportingProgress(band, shape, settings, onWithinBandProgress),
    onProgress,
  );
}

function formatDenoiseAppliedLabel(parameterValues: ParameterValuesById): string {
  const settings = readDenoiseSettings(parameterValues);
  const scopeText = describeCubeScopeForAppliedLabel(DENOISE_SCOPE_IDS, parameterValues);
  return `Denoise (${describeSettingsForLabel(settings)}, ${scopeText})`;
}

function describeSettingsForLabel(settings: DenoiseSettings): string {
  if (settings.method === "median") return `median, radius ${formatNumberForLabel(settings.radius)}`;
  return `Gaussian, sigma ${formatNumberForLabel(settings.sigma)}`;
}

function formatNumberForLabel(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
