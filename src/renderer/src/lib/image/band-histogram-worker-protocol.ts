import type { RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import {
  computeBandHistogramFromBandPixels,
  type BandHistogram,
} from "@/lib/image/compute-band-histogram";

export interface BandHistogramWorkerRequest {
  readonly requestId: number;
  readonly pixels: RasterTypedArray;
  readonly sampleFormat: RasterSampleFormat;
  readonly bitsPerSample: number;
  readonly binCount: number;
}

export interface BandHistogramWorkerResponse {
  readonly requestId: number;
  readonly histogram: BandHistogram;
}

export function computeBandHistogramWorkerResponseFromRequest(
  request: BandHistogramWorkerRequest,
): BandHistogramWorkerResponse {
  const histogram = computeBandHistogramFromBandPixels({
    pixels: request.pixels,
    sampleFormat: request.sampleFormat,
    bitsPerSample: request.bitsPerSample,
    binCount: request.binCount,
  });
  return { requestId: request.requestId, histogram };
}
