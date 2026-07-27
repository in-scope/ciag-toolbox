import { describe, expect, it } from "vitest";

import {
  computeBandHistogramFromBandPixels,
  computeBandHistogramFromRaster,
} from "@/lib/image/compute-band-histogram";
import { computeBandHistogramWorkerResponseFromRequest } from "@/lib/image/band-histogram-worker-protocol";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportRoi } from "@/lib/image/viewport-roi";

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

  // CT-256: a request carrying a region rectangle tallies ONLY the region's
  // pixels, matching a hand-sliced tally over the same rectangle.
  it("bins only the region pixels for an integer band and keeps the container range", () => {
    const width = 6;
    const pixels = new Uint16Array(width * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = 100 + i * 10;
    const rectangle = rectangleFromCorners(1, 1, 3, 2);
    const regionResponse = computeBandHistogramWorkerResponseFromRequest({
      requestId: 7,
      pixels,
      sampleFormat: "uint",
      bitsPerSample: 16,
      binCount: 64,
      region: { rectangle, imageWidthInPixels: width },
    });
    const handSliced = handSliceRegionPixels(pixels, width, rectangle, Uint16Array);
    const expected = computeBandHistogramFromBandPixels({
      pixels: handSliced,
      sampleFormat: "uint",
      bitsPerSample: 16,
      binCount: 64,
    });
    expect(regionResponse.histogram.min).toBe(0);
    expect(regionResponse.histogram.max).toBe(65535);
    expect(regionResponse.histogram.totalSampleCount).toBe(6);
    expect(Array.from(regionResponse.histogram.bins)).toEqual(Array.from(expected.bins));
  });

  it("bins only the region pixels for a float band and spans the region's own extents", () => {
    const width = 5;
    const pixels = new Float32Array(width * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = -0.5 + i * 0.1;
    const rectangle = rectangleFromCorners(1, 0, 2, 1);
    const regionResponse = computeBandHistogramWorkerResponseFromRequest({
      requestId: 8,
      pixels,
      sampleFormat: "float",
      bitsPerSample: 32,
      binCount: 32,
      region: { rectangle, imageWidthInPixels: width },
    });
    const handSliced = handSliceRegionPixels(pixels, width, rectangle, Float32Array);
    const expected = computeBandHistogramFromBandPixels({
      pixels: handSliced,
      sampleFormat: "float",
      bitsPerSample: 32,
      binCount: 32,
    });
    expect(regionResponse.histogram.min).toBe(Math.min(...Array.from(handSliced)));
    expect(regionResponse.histogram.max).toBe(Math.max(...Array.from(handSliced)));
    expect(regionResponse.histogram.totalSampleCount).toBe(4);
    expect(Array.from(regionResponse.histogram.bins)).toEqual(Array.from(expected.bins));
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

function rectangleFromCorners(x0: number, y0: number, x1: number, y1: number): ViewportRoi {
  return { imagePixelX0: x0, imagePixelY0: y0, imagePixelX1: x1, imagePixelY1: y1 };
}

function handSliceRegionPixels<T extends Uint16Array | Float32Array>(
  pixels: T,
  imageWidth: number,
  rectangle: ViewportRoi,
  ArrayType: new (values: number[]) => T,
): T {
  const values: number[] = [];
  for (let y = rectangle.imagePixelY0; y <= rectangle.imagePixelY1; y += 1) {
    for (let x = rectangle.imagePixelX0; x <= rectangle.imagePixelX1; x += 1) {
      values.push(pixels[y * imageWidth + x] ?? 0);
    }
  }
  return new ArrayType(values);
}
