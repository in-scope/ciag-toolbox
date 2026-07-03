import { Waves } from "lucide-react";

import { applySpatialFrequencyFilterToBand, type SpatialFrequencyFilterMode, type SpatialFrequencyFilterSettings } from "@/lib/image/filters/spatial-frequency-filter";
import { makeFloatRasterReusingUnchangedSourceBands } from "@/lib/image/make-float-raster";
import {
  formatBandNumbersAsRangeText,
  parseBandRangeText,
} from "@/lib/image/parse-band-range";
import { coerceViewportSourceToRasterSource } from "@/lib/image/promote-source-to-raster";
import type { RasterImage } from "@/lib/image/raster-image";

import {
  FULL_CUBE_SCOPE,
  readBandRangeTextOrEmpty,
  readCubeScopeChoiceOrDefault,
  type ClipBoundsParameterSchema,
  type CubeScopeParameterSchema,
  type EnumParameterSchema,
  type NumberParameterSchema,
  type ParameterValue,
  type ParameterValuesById,
} from "./parameter-schema";
import type { RegisteredViewportAction } from "./registered-actions";
import type { ViewportActionSourceTransform, ViewportRenderingState } from "./viewport-action";

// CT-203: spatial frequency filtering within each band's picture. The mode
// selector picks the Butterworth transfer (high/low/bandpass); each mode shows
// only its own cutoff field(s). The locked scope control decides which bands
// are filtered: Full stack filters every band, Band-wise filters only the
// entered bands and carries the rest through unchanged, so the output stack
// always keeps the source's dimensions (float32 via the Stage 3 float path).

export const SPATIAL_FILTER_ACTION_ID = "spatial-filter";
export const SPATIAL_FILTER_MODE_PARAMETER_ID = "mode";
export const SPATIAL_FILTER_LOWPASS_CUTOFF_PARAMETER_ID = "lowpassCutoff";
export const SPATIAL_FILTER_HIGHPASS_CUTOFF_PARAMETER_ID = "highpassCutoff";
export const SPATIAL_FILTER_BANDPASS_LOW_CUTOFF_PARAMETER_ID = "bandpassLowCutoff";
export const SPATIAL_FILTER_BANDPASS_HIGH_CUTOFF_PARAMETER_ID = "bandpassHighCutoff";
export const SPATIAL_FILTER_SCOPE_PARAMETER_ID = "scope";
export const SPATIAL_FILTER_BAND_RANGE_PARAMETER_ID = "bandRange";
const SPATIAL_FILTER_TARGET_BAND_PARAMETER_ID = "targetBandIndex";

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
  icon: Waves,
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
  prepareParameterValuesForApply: injectSelectedBandAsBandWiseDefault,
  apply: (state) => state,
  transformSource: createSpatialFilterSourceTransform(),
};

// Band-wise scope with an empty range falls back to the band the user is
// looking at, so the viewed band is captured at Apply time (threshold pattern).
function injectSelectedBandAsBandWiseDefault(
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById {
  return Object.freeze({
    ...rawParameterValues,
    [SPATIAL_FILTER_TARGET_BAND_PARAMETER_ID]: sourceRenderingState.selectedBandIndex,
  });
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

function createSpatialFilterSourceTransform(): ViewportActionSourceTransform {
  return (rawSource, parameterValues) => {
    const source = coerceViewportSourceToRasterSource(rawSource);
    const settings = readSpatialFilterSettings(parameterValues);
    const filteredBandIndexes = resolveFilteredBandIndexSet(parameterValues, source.raster.bandCount);
    return { kind: "raster", raster: filterBandsOfRaster(source.raster, filteredBandIndexes, settings) };
  };
}

function filterBandsOfRaster(
  raster: RasterImage,
  filteredBandIndexes: ReadonlySet<number>,
  settings: SpatialFrequencyFilterSettings,
): RasterImage {
  const shape = { width: raster.width, height: raster.height };
  return makeFloatRasterReusingUnchangedSourceBands(raster, filteredBandIndexes, (band) =>
    applySpatialFrequencyFilterToBand(band, shape, settings),
  );
}

function resolveFilteredBandIndexSet(
  parameterValues: ParameterValuesById,
  bandCount: number,
): ReadonlySet<number> {
  if (readSpatialFilterScopeChoice(parameterValues) === FULL_CUBE_SCOPE) {
    return new Set(Array.from({ length: bandCount }, (_unused, index) => index));
  }
  return new Set(resolveBandWiseFilteredIndexes(parameterValues, bandCount));
}

function resolveBandWiseFilteredIndexes(
  parameterValues: ParameterValuesById,
  bandCount: number,
): ReadonlyArray<number> {
  const text = readBandRangeTextOrEmpty(parameterValues[SPATIAL_FILTER_BAND_RANGE_PARAMETER_ID]);
  if (text.trim() === "") return [readTargetBandIndexOrZero(parameterValues)];
  const parsed = parseBandRangeText(text, bandCount);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.bandNumbers.map((bandNumber) => bandNumber - 1);
}

function readTargetBandIndexOrZero(parameterValues: ParameterValuesById): number {
  const raw = parameterValues[SPATIAL_FILTER_TARGET_BAND_PARAMETER_ID];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

function readSpatialFilterScopeChoice(parameterValues: ParameterValuesById) {
  return readCubeScopeChoiceOrDefault(
    parameterValues[SPATIAL_FILTER_SCOPE_PARAMETER_ID] ?? FULL_CUBE_SCOPE,
    FULL_CUBE_SCOPE,
  );
}

function formatSpatialFilterAppliedLabel(parameterValues: ParameterValuesById): string {
  const settings = readSpatialFilterSettings(parameterValues);
  return `Spatial filter (${describeSettingsForLabel(settings)}, ${describeScopeForLabel(parameterValues)})`;
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

function describeScopeForLabel(parameterValues: ParameterValuesById): string {
  if (readSpatialFilterScopeChoice(parameterValues) === FULL_CUBE_SCOPE) return "full stack";
  return `band-wise: bands ${describeBandWiseBandSetForLabel(parameterValues)}`;
}

function describeBandWiseBandSetForLabel(parameterValues: ParameterValuesById): string {
  const text = readBandRangeTextOrEmpty(parameterValues[SPATIAL_FILTER_BAND_RANGE_PARAMETER_ID]);
  if (text.trim() === "") return String(readTargetBandIndexOrZero(parameterValues) + 1);
  const parsed = parseBandRangeText(text, Number.MAX_SAFE_INTEGER);
  return parsed.ok ? formatBandNumbersAsRangeText(parsed.bandNumbers) : text.trim();
}
