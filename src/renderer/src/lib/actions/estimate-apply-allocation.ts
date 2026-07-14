import type { ParameterValuesById } from "@/lib/actions/parameter-schema";
import {
  normalizeMethodPreservesSourceDataType,
  readInvertApplyToAllBands,
  readRoiFromCropParameterValues,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import { TONE_CURVE_SCOPE_PARAMETER_ID, WHOLE_STACK_TONE_CURVE_SCOPE_VALUE } from "@/lib/actions/tone-curve-scope";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-239: how many bytes of new band arrays an apply will materialize, computed
// from dimensions and parameters alone so the memory-budget gate can refuse an
// over-budget apply BEFORE a result panel is reserved or any band allocates
// (the CT-190 preflight pattern). Estimates are per operation family:
// - float ops (normalize scaling, standardize, percentile clip, denoise,
//   spatial filter, spectral derivative, flat-field, spectralon) always build a
//   full float32 cube - band-wise scopes too, because unchanged integer bands
//   are CONVERTED to float32, not carried by reference.
// - type-preserving whole-cube ops (bit shift, rotate, reflect, clip-absolute
//   normalize, whole-stack tone curve, all-bands invert) re-allocate the
//   source's own byte count.
// - band-targeted and aliasing ops cost one band or nothing; the default for
//   unlisted actions is one float band, which never blocks.

const FLOAT32_BYTES_PER_SAMPLE = 4;
const THRESHOLD_OUTPUT_BYTES_PER_SAMPLE = 1;

const FLOAT32_FULL_CUBE_ACTION_IDS: ReadonlySet<string> = new Set([
  "normalize-data",
  "standardize",
  "percentile-clip",
  "denoise",
  "spatial-filter",
  "spectral-derivative",
  "flat-field",
  "spectralon",
]);

const TYPE_PRESERVING_FULL_CUBE_ACTION_IDS: ReadonlySet<string> = new Set([
  "bit-shift",
  "rotate",
  "reflect",
]);

export function estimateApplyAllocationBytesForAction(
  action: RegisteredViewportAction,
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
): number {
  if (source.kind !== "raster") return 0;
  return estimateAllocationBytesForRasterApply(action, source.raster, parameterValues);
}

// A non-transforming action applied "in a new panel" deep-clones the source
// cube first, so its allocation is the clone itself.
export function estimateSourceCloneBytes(source: ViewportImageSource): number {
  if (source.kind !== "raster") return 0;
  return sumRasterBandBytes(source.raster);
}

function estimateAllocationBytesForRasterApply(
  action: RegisteredViewportAction,
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  if (action.id === "normalize-data" && normalizeMethodPreservesSourceDataType(parameterValues)) {
    return sumRasterBandBytes(raster);
  }
  if (FLOAT32_FULL_CUBE_ACTION_IDS.has(action.id)) return float32CubeBytes(raster);
  if (TYPE_PRESERVING_FULL_CUBE_ACTION_IDS.has(action.id)) return sumRasterBandBytes(raster);
  if (action.id === "tone-curve") return estimateToneCurveAllocationBytes(raster, parameterValues);
  if (action.id === "invert") return estimateInvertAllocationBytes(raster, parameterValues);
  if (action.id === "threshold") return thresholdCubeBytes(raster);
  if (action.id === "crop-to-region") return estimateCropAllocationBytes(raster, parameterValues);
  return singleFloatBandBytes(raster);
}

function pixelCountOf(raster: RasterImage): number {
  return raster.width * raster.height;
}

function float32CubeBytes(raster: RasterImage): number {
  return pixelCountOf(raster) * raster.bandCount * FLOAT32_BYTES_PER_SAMPLE;
}

function singleFloatBandBytes(raster: RasterImage): number {
  return pixelCountOf(raster) * FLOAT32_BYTES_PER_SAMPLE;
}

function thresholdCubeBytes(raster: RasterImage): number {
  return pixelCountOf(raster) * raster.bandCount * THRESHOLD_OUTPUT_BYTES_PER_SAMPLE;
}

// The clone cost of the whole cube: every band's own byte count, aliased bands
// billed per band because type-preserving remaps allocate each output band.
export function sumRasterBandBytes(raster: RasterImage): number {
  let totalBytes = 0;
  for (const band of raster.bandPixels) totalBytes += band.byteLength;
  return totalBytes;
}

function largestBandBytes(raster: RasterImage): number {
  let largest = 0;
  for (const band of raster.bandPixels) largest = Math.max(largest, band.byteLength);
  return largest;
}

function estimateToneCurveAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const appliesToWholeStack =
    parameterValues[TONE_CURVE_SCOPE_PARAMETER_ID] === WHOLE_STACK_TONE_CURVE_SCOPE_VALUE;
  return appliesToWholeStack ? sumRasterBandBytes(raster) : largestBandBytes(raster);
}

function estimateInvertAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  if (readInvertApplyToAllBands(parameterValues)) return sumRasterBandBytes(raster);
  return largestBandBytes(raster);
}

function estimateCropAllocationBytes(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number {
  const cropPixelCount = tryReadCropRegionPixelCount(raster, parameterValues);
  if (cropPixelCount === null) return sumRasterBandBytes(raster);
  const bytesPerSample = largestBandBytes(raster) / Math.max(1, pixelCountOf(raster));
  return Math.ceil(cropPixelCount * raster.bandCount * bytesPerSample);
}

function tryReadCropRegionPixelCount(
  raster: RasterImage,
  parameterValues: ParameterValuesById,
): number | null {
  try {
    const roi = readRoiFromCropParameterValues(parameterValues);
    const width = Math.min(Math.abs(roi.imagePixelX1 - roi.imagePixelX0) + 1, raster.width);
    const height = Math.min(Math.abs(roi.imagePixelY1 - roi.imagePixelY0) + 1, raster.height);
    return width * height;
  } catch {
    return null;
  }
}
