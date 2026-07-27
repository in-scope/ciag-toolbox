import type { RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import {
  computeBandHistogramFromBandPixels,
  type BandHistogram,
} from "@/lib/image/compute-band-histogram";
import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

// CT-256: a request may carry a canonical region rectangle; the histogram is then
// tallied over ONLY the region's pixels. Float ranges derive from the region's own
// extents automatically (the tally sees only region samples); integer ranges keep
// the data-type container range because it derives from sampleFormat/bitsPerSample.
export interface BandHistogramRegionSelection {
  readonly rectangle: ViewportRoi;
  readonly imageWidthInPixels: number;
}

export interface BandHistogramWorkerRequest {
  readonly requestId: number;
  readonly pixels: RasterTypedArray;
  readonly sampleFormat: RasterSampleFormat;
  readonly bitsPerSample: number;
  readonly binCount: number;
  readonly region?: BandHistogramRegionSelection;
}

export interface BandHistogramWorkerResponse {
  readonly requestId: number;
  readonly histogram: BandHistogram;
}

export function computeBandHistogramWorkerResponseFromRequest(
  request: BandHistogramWorkerRequest,
): BandHistogramWorkerResponse {
  const histogram = computeBandHistogramFromBandPixels({
    pixels: resolveRequestPixelsForRegionOrWholeBand(request),
    sampleFormat: request.sampleFormat,
    bitsPerSample: request.bitsPerSample,
    binCount: request.binCount,
  });
  return { requestId: request.requestId, histogram };
}

function resolveRequestPixelsForRegionOrWholeBand(
  request: BandHistogramWorkerRequest,
): RasterTypedArray {
  if (!request.region) return request.pixels;
  return extractRegionPixelsFromBandPixels(request.pixels, request.region);
}

export function extractRegionPixelsFromBandPixels(
  pixels: RasterTypedArray,
  selection: BandHistogramRegionSelection,
): RasterTypedArray {
  const rect = canonicalizeViewportRoiCorners(selection.rectangle);
  const regionWidth = rect.imagePixelX1 - rect.imagePixelX0 + 1;
  const regionHeight = rect.imagePixelY1 - rect.imagePixelY0 + 1;
  const regionPixels = allocateArrayMatchingBandSampleType(pixels, regionWidth * regionHeight);
  for (let row = 0; row < regionHeight; row += 1) {
    const rowStart = (rect.imagePixelY0 + row) * selection.imageWidthInPixels + rect.imagePixelX0;
    regionPixels.set(pixels.subarray(rowStart, rowStart + regionWidth), row * regionWidth);
  }
  return regionPixels;
}

function allocateArrayMatchingBandSampleType(
  pixels: RasterTypedArray,
  length: number,
): RasterTypedArray {
  const TypedArrayConstructor = pixels.constructor as new (length: number) => RasterTypedArray;
  return new TypedArrayConstructor(length);
}
