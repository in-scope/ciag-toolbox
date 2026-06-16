import {
  buildDisplayNormalizedComposedToneCurveLookupTable,
  buildMonotoneToneCurve,
  type ToneCurve,
  type ToneCurveAnchor,
} from "@/lib/image/apply-tone-curve";
import {
  dataTypeValueRangeForBand,
  type DataTypeValueRange,
} from "@/lib/image/data-type-value-range";
import {
  clampBandIndexToRaster,
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import {
  colorBandIndexForToneCurveChannel,
  listNonIdentityToneCurveChannels,
  type ToneCurveChannelAnchors,
} from "@/lib/image/tone-curve-channels";
import type { ToneCurveValueRanges } from "@/lib/image/tone-curve-editor-state";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

// CT-177: for a true-colour composite the GPU preview samples THREE display-only
// lookup tables (one per R/G/B channel) instead of the single CT-171 LUT. Each
// channel LUT folds that channel's own curve and the rgb/Value curve together on
// the CPU, so the shader just textures each component through its own table. The
// builders allocate no raster; the renderer uploads the small tables and never
// re-uploads the image. A scientific stack / single-band photo keeps the single
// LUT path unchanged.

export type ColorToneCurveChannel = "red" | "green" | "blue";

// The three display-normalized lookup tables the composite preview uploads, one
// per R/G/B channel. Each is sampled independently by the shader (CT-177).
export interface ToneCurveChannelPreviewLuts {
  readonly red: ReadonlyArray<number>;
  readonly green: ReadonlyArray<number>;
  readonly blue: ReadonlyArray<number>;
}

export function buildCompositeToneCurveValueRanges(raster: RasterImage): ToneCurveValueRanges {
  const range = colorBandDataTypeRange(raster, 0);
  return { inputMin: range.min, inputMax: range.max, outputMin: range.min, outputMax: range.max };
}

export function isCompositeToneCurvePreviewActive(
  raster: RasterImage | null,
  channelAnchors: ToneCurveChannelAnchors,
): boolean {
  if (!raster || !shouldRenderRasterAsRgbComposite(raster)) return false;
  const ranges = buildCompositeToneCurveValueRanges(raster);
  return listNonIdentityToneCurveChannels(channelAnchors, ranges).length > 0;
}

export function buildComposedChannelPreviewLutOrNull(
  raster: RasterImage | null,
  channel: ColorToneCurveChannel,
  channelAnchors: ReadonlyArray<ToneCurveAnchor> | null | undefined,
  valueAnchors: ReadonlyArray<ToneCurveAnchor> | null | undefined,
): ReadonlyArray<number> | null {
  if (!raster || !shouldRenderRasterAsRgbComposite(raster)) return null;
  const range = colorBandDataTypeRange(raster, colorBandIndexForToneCurveChannel(channel) ?? 0);
  const perChannelCurve = buildCurveFromAnchorsOrIdentity(channelAnchors, range);
  const valueCurve = buildCurveFromAnchorsOrIdentity(valueAnchors, range);
  return buildDisplayNormalizedComposedToneCurveLookupTable(perChannelCurve, valueCurve, range, TONE_CURVE_LUT_ENTRY_COUNT);
}

function colorBandDataTypeRange(raster: RasterImage, bandIndex: number): DataTypeValueRange {
  const band = getRasterBandPixelsOrThrow(raster, clampBandIndexToRaster(raster, bandIndex));
  return dataTypeValueRangeForBand(band, raster.sampleFormat);
}

function buildCurveFromAnchorsOrIdentity(
  anchors: ReadonlyArray<ToneCurveAnchor> | null | undefined,
  range: DataTypeValueRange,
): ToneCurve {
  if (anchors && anchors.length >= 2) return buildMonotoneToneCurve(anchors);
  return buildMonotoneToneCurve(identityAnchorsForRange(range));
}

function identityAnchorsForRange(range: DataTypeValueRange): ReadonlyArray<ToneCurveAnchor> {
  return [
    { input: range.min, output: range.min },
    { input: range.max, output: range.max },
  ];
}
