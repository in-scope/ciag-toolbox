import {
  buildDisplayNormalizedToneCurveLookupTable,
  buildMonotoneToneCurve,
  toneCurveOutputRangeForBand,
  type ToneCurveAnchor,
} from "@/lib/image/apply-tone-curve";
import {
  clampBandIndexToRaster,
  type RasterImage,
} from "@/lib/image/raster-image";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

// CT-171: a tone-curve PREVIEW is now display-only. Instead of baking the band
// into a new RasterImage (the old applyToneCurveToRasterBand path, which forced
// the whole image texture to re-upload on every anchor drag), the preview is a
// display-normalized 1-D lookup table the GPU samples. This builder allocates no
// raster; it returns the LUT the renderer uploads via setToneCurveLookupTable.

export function buildToneCurvePreviewLutOrNull(
  raster: RasterImage | null,
  bandIndex: number,
  anchors: ReadonlyArray<ToneCurveAnchor> | null,
): ReadonlyArray<number> | null {
  if (!raster || !anchors || anchors.length < 2) return null;
  const clampedBandIndex = clampBandIndexToRaster(raster, bandIndex);
  const range = toneCurveOutputRangeForBand(raster, clampedBandIndex);
  const curve = buildMonotoneToneCurve(anchors);
  return buildDisplayNormalizedToneCurveLookupTable(curve, range, TONE_CURVE_LUT_ENTRY_COUNT);
}
