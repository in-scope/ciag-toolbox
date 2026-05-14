import { describe, expect, it } from "vitest";

import {
  computeBandHistogramFromBandPixels,
  computeBandHistogramFromRaster,
} from "@/lib/image/compute-band-histogram";
import { computeBandHistogramWorkerResponseFromRequest } from "@/lib/image/band-histogram-worker-protocol";
import type { RasterImage } from "@/lib/image/raster-image";

describe("computeBandHistogramWorkerResponseFromRequest", () => {
  it("matches the in-process function bin-for-bin", () => {
    const pixels = new Uint16Array(1024);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 65536;
    const raster: RasterImage = {
      bandPixels: [pixels],
      width: 32,
      height: 32,
      bitsPerSample: 16,
      sampleFormat: "uint",
      bandCount: 1,
    };
    const inProcess = computeBandHistogramFromRaster(raster, 0, 256);
    const workerResponse = computeBandHistogramWorkerResponseFromRequest({
      requestId: 1,
      pixels,
      sampleFormat: "uint",
      bitsPerSample: 16,
      binCount: 256,
    });
    expect(workerResponse.requestId).toBe(1);
    expect(workerResponse.histogram.binCount).toBe(inProcess.binCount);
    expect(workerResponse.histogram.min).toBe(inProcess.min);
    expect(workerResponse.histogram.max).toBe(inProcess.max);
    expect(workerResponse.histogram.binWidth).toBe(inProcess.binWidth);
    expect(workerResponse.histogram.totalSampleCount).toBe(inProcess.totalSampleCount);
    expect(workerResponse.histogram.excludedSampleCount).toBe(inProcess.excludedSampleCount);
    expect(Array.from(workerResponse.histogram.bins)).toEqual(Array.from(inProcess.bins));
  });

  it("propagates the request id back on the response", () => {
    const pixels = new Uint8Array([1, 2, 3]);
    const inProcess = computeBandHistogramFromBandPixels({
      pixels,
      sampleFormat: "uint",
      bitsPerSample: 8,
      binCount: 8,
    });
    const response = computeBandHistogramWorkerResponseFromRequest({
      requestId: 42,
      pixels,
      sampleFormat: "uint",
      bitsPerSample: 8,
      binCount: 8,
    });
    expect(response.requestId).toBe(42);
    expect(Array.from(response.histogram.bins)).toEqual(Array.from(inProcess.bins));
  });
});
