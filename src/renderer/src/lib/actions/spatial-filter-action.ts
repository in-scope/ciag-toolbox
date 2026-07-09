import { Grid3x3 } from "lucide-react";

import {
  assertShapeFitsSpatialFilterGrid,
  createReusableSpatialFilterGrid,
  type BandSpatialShape,
  type SpatialFrequencyFilterMode,
  type SpatialFrequencyFilterSettings,
} from "@/lib/image/filters/spatial-frequency-filter";
import {
  filterBandsOnDedicatedSpatialFilterWorker,
  isSpatialFilterWorkerAvailable,
  type SpatialFilterBandInput,
} from "@/lib/image/filters/spatial-filter-worker-client";
import { makeFloatRasterReusingUnchangedSourceBands } from "@/lib/image/make-float-raster";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import { getRasterBandPixelsOrThrow, type RasterImage } from "@/lib/image/raster-image";
import {
  reportCompletedUnitAndYieldSoProgressCanPaint,
  reportMultiUnitWorkStarting,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  describeCubeScopeForAppliedLabel,
  injectSelectedBandAsBandWiseDefault,
  resolveScopedBandIndexSet,
  type CubeScopeParameterIds,
} from "./band-scope-selection";
import {
  FULL_CUBE_SCOPE,
  type ClipBoundsParameterSchema,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type NumberParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import type { ViewportRenderingState } from "./viewport-action";

// CT-203: spatial frequency filtering within each band's picture. The mode
// selector picks the Butterworth transfer (high/low/bandpass); each mode shows
// only its own cutoff field(s). The locked scope control decides which bands
// are filtered: Full stack filters every band, Band-wise filters only the
// entered bands and carries the rest through unchanged, so the output stack
// always keeps the source's dimensions (float32 via the Stage 3 float path).
//
// CT-219a: the FFT loop runs on a dedicated Web Worker (transformSourceAsync)
// so a large stack does not freeze the UI thread, and the working-grid size is
// pre-flighted in assertCanApplyToSource so an oversized stack fails with a
// clear error before a result panel is reserved.

export const SPATIAL_FILTER_ACTION_ID = "spatial-filter";
export const SPATIAL_FILTER_MODE_PARAMETER_ID = "mode";
export const SPATIAL_FILTER_LOWPASS_CUTOFF_PARAMETER_ID = "lowpassCutoff";
export const SPATIAL_FILTER_HIGHPASS_CUTOFF_PARAMETER_ID = "highpassCutoff";
export const SPATIAL_FILTER_BANDPASS_LOW_CUTOFF_PARAMETER_ID = "bandpassLowCutoff";
export const SPATIAL_FILTER_BANDPASS_HIGH_CUTOFF_PARAMETER_ID = "bandpassHighCutoff";
export const SPATIAL_FILTER_SCOPE_PARAMETER_ID = "scope";
export const SPATIAL_FILTER_BAND_RANGE_PARAMETER_ID = "bandRange";
const SPATIAL_FILTER_TARGET_BAND_PARAMETER_ID = "targetBandIndex";

const SPATIAL_FILTER_SCOPE_IDS: CubeScopeParameterIds = {
  scopeParameterId: SPATIAL_FILTER_SCOPE_PARAMETER_ID,
  bandRangeParameterId: SPATIAL_FILTER_BAND_RANGE_PARAMETER_ID,
  targetBandParameterId: SPATIAL_FILTER_TARGET_BAND_PARAMETER_ID,
};

const LOWPASS_MODE_VALUE = "lowpass" satisfies SpatialFrequencyFilterMode;
const HIGHPASS_MODE_VALUE = "highpass" satisfies SpatialFrequencyFilterMode;
const BANDPASS_MODE_VALUE = "bandpass" satisfies SpatialFrequencyFilterMode;

const DEFAULT_LOWPASS_CUTOFF = 0.15;
const DEFAULT_HIGHPASS_CUTOFF = 0.05;
const DEFAULT_BANDPASS_LOW_CUTOFF = 0.05;
const DEFAULT_BANDPASS_HIGH_CUTOFF = 0.25;

const CUTOFF_UNIT_HINT =
  "Spatial frequency in cycles per pixel; 0.5 is the finest detail a stack can hold.";

const SPATIAL_FILTER_MODE_PARAMETER_SCHEMA: EnumParameterSchema = {
  kind: "enum",
  id: SPATIAL_FILTER_MODE_PARAMETER_ID,
  label: "Mode",
  description:
    "Low-pass smooths by keeping only coarse spatial structure. High-pass sharpens by keeping " +
    "only fine structure. Bandpass keeps structure between two cutoffs.",
  defaultValue: LOWPASS_MODE_VALUE,
  options: [
    { value: LOWPASS_MODE_VALUE, label: "Low-pass" },
    { value: HIGHPASS_MODE_VALUE, label: "High-pass" },
    { value: BANDPASS_MODE_VALUE, label: "Bandpass" },
  ],
};

const SPATIAL_FILTER_LOWPASS_CUTOFF_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: SPATIAL_FILTER_LOWPASS_CUTOFF_PARAMETER_ID,
  label: "Cutoff",
  description: `${CUTOFF_UNIT_HINT} Structure finer than the cutoff is smoothed away.`,
  defaultValue: DEFAULT_LOWPASS_CUTOFF,
  min: 0.01,
  max: 0.5,
  step: 0.01,
  visibleWhen: { parameterId: SPATIAL_FILTER_MODE_PARAMETER_ID, equals: LOWPASS_MODE_VALUE },
};

const SPATIAL_FILTER_HIGHPASS_CUTOFF_PARAMETER_SCHEMA: NumberParameterSchema = {
  kind: "number",
  id: SPATIAL_FILTER_HIGHPASS_CUTOFF_PARAMETER_ID,
  label: "Cutoff",
  description: `${CUTOFF_UNIT_HINT} Structure coarser than the cutoff (including flat background) is removed.`,
  defaultValue: DEFAULT_HIGHPASS_CUTOFF,
  min: 0.01,
  max: 0.5,
  step: 0.01,
  visibleWhen: { parameterId: SPATIAL_FILTER_MODE_PARAMETER_ID, equals: HIGHPASS_MODE_VALUE },
};

const SPATIAL_FILTER_BANDPASS_CUTOFFS_PARAMETER_SCHEMA: ClipBoundsParameterSchema = {
  kind: "clip-bounds",
  id: "bandpassCutoffs",
  label: "Bandpass cutoffs",
  description: `${CUTOFF_UNIT_HINT} Structure between the two cutoffs is kept.`,
  loParameterId: SPATIAL_FILTER_BANDPASS_LOW_CUTOFF_PARAMETER_ID,
  hiParameterId: SPATIAL_FILTER_BANDPASS_HIGH_CUTOFF_PARAMETER_ID,
  loLabel: "Low cutoff",
  hiLabel: "High cutoff",
  defaultLo: DEFAULT_BANDPASS_LOW_CUTOFF,
  defaultHi: DEFAULT_BANDPASS_HIGH_CUTOFF,
  visibleWhen: { parameterId: SPATIAL_FILTER_MODE_PARAMETER_ID, equals: BANDPASS_MODE_VALUE },
};

const SPATIAL_FILTER_SCOPE_PARAMETER_SCHEMA: CubeScopeParameterSchema = {
  kind: "cube-scope",
  id: SPATIAL_FILTER_SCOPE_PARAMETER_ID,
  label: "Scope",
  description:
    "Full stack filters every band's picture. Band-wise filters only the entered bands " +
    "(defaults to the current band) and carries the other bands through unchanged.",
  defaultValue: FULL_CUBE_SCOPE,
  bandRangeParameterId: SPATIAL_FILTER_BAND_RANGE_PARAMETER_ID,
};

export const SPATIAL_FILTER_ACTION: RegisteredViewportAction = {
  id: SPATIAL_FILTER_ACTION_ID,
  label: "Spatial Filter",
  icon: Grid3x3,
  parameters: [
    SPATIAL_FILTER_MODE_PARAMETER_SCHEMA,
    SPATIAL_FILTER_LOWPASS_CUTOFF_PARAMETER_SCHEMA,
    SPATIAL_FILTER_HIGHPASS_CUTOFF_PARAMETER_SCHEMA,
    SPATIAL_FILTER_BANDPASS_CUTOFFS_PARAMETER_SCHEMA,
    SPATIAL_FILTER_SCOPE_PARAMETER_SCHEMA,
  ],
  successMessage: "Spatial filter applied",
  appliedLabel: "Spatial filter",
  loadingMessage: "Filtering spatial frequencies...",
  formatAppliedLabel: formatSpatialFilterAppliedLabel,
  prepareParameterValuesForApply: injectSelectedBandIntoSpatialFilterParameters,
  apply: (state) => state,
  assertCanApplyToSource: assertSpatialFilterSourceFitsWorkingGrid,
  transformSourceAsync: transformSourceThroughSpatialFilter,
};

// Band-wise scope with an empty range falls back to the band the user is
// looking at, so the viewed band is captured at Apply time (threshold pattern).
function injectSelectedBandIntoSpatialFilterParameters(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return injectSelectedBandAsBandWiseDefault(
    SPATIAL_FILTER_SCOPE_IDS,
    rawParameterValues,
    sourceRenderingState,
  );
}

export function readSpatialFilterSettings(
  parameterValues: ParameterValuesById,
): SpatialFrequencyFilterSettings {
  const mode = readSpatialFilterMode(parameterValues);
  if (mode === BANDPASS_MODE_VALUE) return readBandpassSettings(parameterValues);
  if (mode === HIGHPASS_MODE_VALUE) {
    return { mode, cutoff: readCutoffOrDefault(parameterValues[SPATIAL_FILTER_HIGHPASS_CUTOFF_PARAMETER_ID], DEFAULT_HIGHPASS_CUTOFF) };
  }
  return { mode, cutoff: readCutoffOrDefault(parameterValues[SPATIAL_FILTER_LOWPASS_CUTOFF_PARAMETER_ID], DEFAULT_LOWPASS_CUTOFF) };
}

function readBandpassSettings(parameterValues: ParameterValuesById): SpatialFrequencyFilterSettings {
  return {
    mode: BANDPASS_MODE_VALUE,
    lowCutoff: readCutoffOrDefault(
      parameterValues[SPATIAL_FILTER_BANDPASS_LOW_CUTOFF_PARAMETER_ID],
      DEFAULT_BANDPASS_LOW_CUTOFF,
    ),
    highCutoff: readCutoffOrDefault(
      parameterValues[SPATIAL_FILTER_BANDPASS_HIGH_CUTOFF_PARAMETER_ID],
      DEFAULT_BANDPASS_HIGH_CUTOFF,
    ),
  };
}

function readSpatialFilterMode(parameterValues: ParameterValuesById): SpatialFrequencyFilterMode {
  const raw = parameterValues[SPATIAL_FILTER_MODE_PARAMETER_ID];
  if (raw === HIGHPASS_MODE_VALUE || raw === BANDPASS_MODE_VALUE) return raw;
  return LOWPASS_MODE_VALUE;
}

function readCutoffOrDefault(value: ParameterValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function assertSpatialFilterSourceFitsWorkingGrid(source: ViewportImageSource): void {
  if (source.kind !== "raster") return;
  assertShapeFitsSpatialFilterGrid({ width: source.raster.width, height: source.raster.height });
}

async function transformSourceThroughSpatialFilter(
  rawSource: ViewportImageSource,
  parameterValues: ParameterValuesById,
  onProgress?: UnitProgressCallback,
): Promise<ViewportImageSource> {
  const source = coerceViewportSourceToRasterSource(rawSource);
  const settings = readSpatialFilterSettings(parameterValues);
  const filteredBandIndexes = resolveScopedBandIndexSet(
    SPATIAL_FILTER_SCOPE_IDS,
    parameterValues,
    source.raster.bandCount,
  );
  const raster = await filterBandsOfRaster(source.raster, filteredBandIndexes, settings, onProgress);
  return { kind: "raster", raster };
}

async function filterBandsOfRaster(
  raster: RasterImage,
  filteredBandIndexes: ReadonlySet<number>,
  settings: SpatialFrequencyFilterSettings,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const shape = { width: raster.width, height: raster.height };
  const filteredByIndex = await filterScopedBands(raster, filteredBandIndexes, shape, settings, onProgress);
  return makeFloatRasterReusingUnchangedSourceBands(raster, filteredBandIndexes, (_band, index) =>
    readFilteredBandOrThrow(filteredByIndex, index),
  );
}

// CT-221: the progress fraction counts FILTERED bands (bands completed / bands to
// filter), one tick as each band returns from the worker.
function filterScopedBands(
  raster: RasterImage,
  filteredBandIndexes: ReadonlySet<number>,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
  onProgress?: UnitProgressCallback,
): Promise<Map<number, Float32Array>> {
  const bands = listScopedBandInputs(raster, filteredBandIndexes);
  if (isSpatialFilterWorkerAvailable()) {
    return filterBandsOnDedicatedSpatialFilterWorker(bands, shape, settings, onProgress);
  }
  return filterBandsOnThisThread(bands, shape, settings, onProgress);
}

function listScopedBandInputs(
  raster: RasterImage,
  filteredBandIndexes: ReadonlySet<number>,
): SpatialFilterBandInput[] {
  return [...filteredBandIndexes]
    .sort((a, b) => a - b)
    .map((bandIndex) => ({ bandIndex, pixels: getRasterBandPixelsOrThrow(raster, bandIndex) }));
}

// Vitest's node environment has no Web Worker; the same reusable-grid filter
// runs inline there (and in any runtime without workers), with the same
// per-band completion ticks, within-band fractions (CT-225), and paint yields.
async function filterBandsOnThisThread(
  bands: ReadonlyArray<SpatialFilterBandInput>,
  shape: BandSpatialShape,
  settings: SpatialFrequencyFilterSettings,
  onProgress?: UnitProgressCallback,
): Promise<Map<number, Float32Array>> {
  const reusableGrid = createReusableSpatialFilterGrid();
  const filteredByBandIndex = new Map<number, Float32Array>();
  reportMultiUnitWorkStarting(onProgress, bands.length);
  for (const [completedBefore, band] of bands.entries()) {
    const onWithinBandProgress = (fraction: number): void =>
      onProgress?.((completedBefore + fraction) / bands.length);
    filteredByBandIndex.set(
      band.bandIndex,
      reusableGrid.filterBand(band.pixels, shape, settings, onWithinBandProgress),
    );
    await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, completedBefore + 1, bands.length);
  }
  return filteredByBandIndex;
}

function readFilteredBandOrThrow(
  filteredByIndex: ReadonlyMap<number, Float32Array>,
  bandIndex: number,
): Float32Array {
  const filtered = filteredByIndex.get(bandIndex);
  if (filtered) return filtered;
  throw new Error(`Spatial filter produced no result for band ${bandIndex + 1}`);
}

function formatSpatialFilterAppliedLabel(parameterValues: ParameterValuesById): string {
  const settings = readSpatialFilterSettings(parameterValues);
  const scopeText = describeCubeScopeForAppliedLabel(SPATIAL_FILTER_SCOPE_IDS, parameterValues);
  return `Spatial filter (${describeSettingsForLabel(settings)}, ${scopeText})`;
}

function describeSettingsForLabel(settings: SpatialFrequencyFilterSettings): string {
  if (settings.mode === "bandpass") {
    return `bandpass ${formatCutoffForLabel(settings.lowCutoff)} - ${formatCutoffForLabel(settings.highCutoff)}`;
  }
  const modeText = settings.mode === "lowpass" ? "low-pass" : "high-pass";
  return `${modeText}, cutoff ${formatCutoffForLabel(settings.cutoff)}`;
}

function formatCutoffForLabel(cutoff: number): string {
  if (Number.isInteger(cutoff)) return String(cutoff);
  return cutoff.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
