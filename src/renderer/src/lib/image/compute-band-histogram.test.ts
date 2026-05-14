import { describe, expect, it } from "vitest";

import {
  computeBandHistogramFromRaster,
  computeBandHistogramFromBandPixels,
  DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
} from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";

describe("computeBandHistogramFromRaster", () => {
  it("counts uniform uint8 values into one bin per integer value", () => {
    const pixels = new Uint8Array(256);
    for (let v = 0; v < 256; v++) pixels[v] = v;
    const raster = buildSingleBandRaster(pixels, 8, "uint");
    const result = computeBandHistogramFromRaster(raster, 0);
    expect(result.binCount).toBe(DEFAULT_BAND_HISTOGRAM_BIN_COUNT);
    expect(result.min).toBe(0);
    expect(result.max).toBe(255);
    expect(result.binWidth).toBe(1);
    expect(result.totalSampleCount).toBe(256);
    expect(result.excludedSampleCount).toBe(0);
    for (let i = 0; i < 256; i++) expect(result.bins[i]).toBe(1);
  });

  it("places uint16 samples at edge boundaries into the expected bins", () => {
    const pixels = new Uint16Array([0, 65535 - 256, 65535]);
    const raster = buildSingleBandRaster(pixels, 16, "uint");
    const result = computeBandHistogramFromRaster(raster, 0, 256);
    expect(result.min).toBe(0);
    expect(result.max).toBe(65535);
    expect(result.binWidth).toBe(256);
    expect(result.bins[0]).toBe(1);
    expect(result.bins[254]).toBe(1);
    expect(result.bins[255]).toBe(1);
    expect(result.totalSampleCount).toBe(3);
  });

  it("groups int16 negative and positive values across the signed range", () => {
    const pixels = new Int16Array([-32768, -1, 0, 32767]);
    const raster = buildSingleBandRaster(pixels, 16, "int");
    const result = computeBandHistogramFromRaster(raster, 0, 256);
    expect(result.min).toBe(-32768);
    expect(result.max).toBe(32767);
    expect(result.binWidth).toBe(256);
    expect(result.bins[0]).toBe(1);
    expect(result.bins[127]).toBe(1);
    expect(result.bins[128]).toBe(1);
    expect(result.bins[255]).toBe(1);
    expect(result.totalSampleCount).toBe(4);
    expect(result.excludedSampleCount).toBe(0);
  });

  it("uses the actual finite min/max for float32 bands", () => {
    const pixels = new Float32Array([0.25, 0.5, 0.75, 0.75]);
    const raster = buildSingleBandRaster(pixels, 32, "float");
    const result = computeBandHistogramFromRaster(raster, 0, 4);
    expect(result.min).toBeCloseTo(0.25, 6);
    expect(result.max).toBeCloseTo(0.75, 6);
    expect(result.binWidth).toBeCloseTo(0.125, 6);
    expect(result.bins[0]).toBe(1);
    expect(result.bins[2]).toBe(1);
    expect(result.bins[3]).toBe(2);
    expect(result.totalSampleCount).toBe(4);
  });

  it("counts non-finite float samples in the excluded tally", () => {
    const pixels = new Float32Array([0.1, Number.NaN, Number.POSITIVE_INFINITY, 0.9]);
    const raster = buildSingleBandRaster(pixels, 32, "float");
    const result = computeBandHistogramFromRaster(raster, 0, 8);
    expect(result.totalSampleCount).toBe(2);
    expect(result.excludedSampleCount).toBe(2);
  });

  it("places every sample of an all-zero uint16 band into the first bin", () => {
    const pixels = new Uint16Array(16);
    const raster = buildSingleBandRaster(pixels, 16, "uint");
    const result = computeBandHistogramFromRaster(raster, 0);
    expect(result.bins[0]).toBe(16);
    expect(result.totalSampleCount).toBe(16);
    for (let i = 1; i < result.binCount; i++) expect(result.bins[i]).toBe(0);
  });

  it("falls back to a synthetic range when a float band is constant", () => {
    const pixels = new Float32Array([7, 7, 7, 7]);
    const raster = buildSingleBandRaster(pixels, 32, "float");
    const result = computeBandHistogramFromRaster(raster, 0, 4);
    expect(result.min).toBe(7);
    expect(result.max).toBe(8);
    expect(result.bins[0]).toBe(4);
    expect(result.totalSampleCount).toBe(4);
  });
});

describe("computeBandHistogramFromBandPixels (low-level)", () => {
  it("clamps a sample equal to max into the last bin (not out of range)", () => {
    const pixels = new Uint16Array([65535]);
    const result = computeBandHistogramFromBandPixels({
      pixels,
      sampleFormat: "uint",
      bitsPerSample: 16,
      binCount: 4,
    });
    expect(result.bins[result.binCount - 1]).toBe(1);
    expect(result.excludedSampleCount).toBe(0);
  });
});

function buildSingleBandRaster(
  pixels: RasterImage["bandPixels"][number],
  bitsPerSample: number,
  sampleFormat: RasterImage["sampleFormat"],
): RasterImage {
  return {
    bandPixels: [pixels],
    width: pixels.length,
    height: 1,
    bitsPerSample,
    sampleFormat,
    bandCount: 1,
  };
}
