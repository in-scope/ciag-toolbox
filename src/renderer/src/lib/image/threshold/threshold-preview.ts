import {
  buildDisplayNormalizedLookupTable,
  toneCurveOutputRangeForBand,
} from "@/lib/image/apply-tone-curve";
import { clampBandIndexToRaster, type RasterImage } from "@/lib/image/raster-image";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

import { isValueWithinThresholdBounds, type ThresholdBounds } from "./threshold";

// CT-200: the manual threshold is the ONE Stage 5 operation with a live
// preview. Like the tone-curve and brightness/contrast previews it is
// display-only: a step-function lookup table (in-range -> white, out -> black)
// uploaded through the shared single-band display-LUT slot, so dragging a
// bound never re-bakes or re-uploads the image; the data changes only on
// Apply. The step's in/out test is the SAME isValueWithinThresholdBounds the
// committed applyManualThreshold uses, so Apply matches the preview.

export function buildThresholdPreviewLutOrNull(
  raster: RasterImage | null,
  bandIndex: number,
  bounds: ThresholdBounds | null,
): ReadonlyArray<number> | null {
  if (!raster || !bounds) return null;
  const range = toneCurveOutputRangeForBand(raster, clampBandIndexToRaster(raster, bandIndex));
  return buildDisplayNormalizedLookupTable(
    (value) => (isValueWithinThresholdBounds(value, bounds) ? range.max : range.min),
    range,
    TONE_CURVE_LUT_ENTRY_COUNT,
  );
}
