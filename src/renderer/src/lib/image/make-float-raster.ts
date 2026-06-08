import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-077: shared constructor for operation-produced float32 rasters. Operations
// that emit fractional results (normalize, standardize, Spectralon, ...) compute
// per-band values and hand them here to get a valid float raster that flows
// through tile rebuild, render (display clips to [0, 1]), pixel readout (true
// values), and the ENVI float save path. Out-of-range true values are preserved
// in bandPixels; only the display clips them.

export const FLOAT32_BITS_PER_SAMPLE = 32;

export type ComputeFloatBandFromSource = (
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
) => Float32Array;

export function makeFloatRasterFromBandComputation(
  source: RasterImage,
  computeFloatBand: ComputeFloatBandFromSource,
): RasterImage {
  const bandPixels = source.bandPixels.map((band, index) =>
    computeSingleFloatBandMatchingSourceLength(band, index, computeFloatBand),
  );
  return buildFloat32RasterPreservingMetadata(source, bandPixels);
}

export function mapBandPixelsToFloat32(
  sourceBandPixels: RasterTypedArray,
  mapValue: (value: number, pixelIndex: number) => number,
): Float32Array {
  const out = new Float32Array(sourceBandPixels.length);
  for (let i = 0; i < sourceBandPixels.length; i += 1) {
    out[i] = mapValue(sourceBandPixels[i] ?? 0, i);
  }
  return out;
}

function computeSingleFloatBandMatchingSourceLength(
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
  computeFloatBand: ComputeFloatBandFromSource,
): Float32Array {
  const result = computeFloatBand(sourceBandPixels, bandIndex);
  assertComputedBandLengthMatchesSource(result, sourceBandPixels, bandIndex);
  return result;
}

function assertComputedBandLengthMatchesSource(
  result: Float32Array,
  sourceBandPixels: RasterTypedArray,
  bandIndex: number,
): void {
  if (result.length === sourceBandPixels.length) return;
  throw new Error(
    `Float band computation for band ${bandIndex} produced ${result.length} values ` +
      `but the source band has ${sourceBandPixels.length}`,
  );
}

function buildFloat32RasterPreservingMetadata(
  source: RasterImage,
  bandPixels: ReadonlyArray<Float32Array>,
): RasterImage {
  return {
    ...source,
    bandPixels,
    sampleFormat: "float",
    bitsPerSample: FLOAT32_BITS_PER_SAMPLE,
  };
}
