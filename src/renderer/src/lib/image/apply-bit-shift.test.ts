import { describe, expect, it } from "vitest";

import {
  MAX_BIT_SHIFT_AMOUNT,
  MIN_BIT_SHIFT_AMOUNT,
  applyBitShiftToRasterImage,
} from "./apply-bit-shift";
import type { RasterImage } from "./raster-image";

describe("applyBitShiftToRasterImage", () => {
  it("returns an independent copy when the shift amount is zero", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint16Array([10, 20, 30, 40]));
    const result = applyBitShiftToRasterImage(raster, 0);
    expect(Array.from(result.bandPixels[0]!)).toEqual([10, 20, 30, 40]);
    expect(result.bandPixels[0]).not.toBe(raster.bandPixels[0]);
  });

  it("multiplies uint16 values by 2^shift for in-range data", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint16Array([1, 2, 4, 8]));
    const result = applyBitShiftToRasterImage(raster, 4);
    expect(Array.from(result.bandPixels[0]!)).toEqual([16, 32, 64, 128]);
  });

  it("clamps overflowing uint16 values to 65535", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint16Array([0xfff, 0x8000, 0]));
    const result = applyBitShiftToRasterImage(raster, 4);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0xfff0, 0xffff, 0]);
  });

  it("clamps overflowing uint8 values to 255", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint8Array([1, 100, 200]));
    const result = applyBitShiftToRasterImage(raster, 4);
    expect(Array.from(result.bandPixels[0]!)).toEqual([16, 0xff, 0xff]);
  });

  it("clamps int16 values at both positive and negative extremes", () => {
    const raster = createSingleBandRasterImageFromValues(
      new Int16Array([10, -10, 30000, -30000, 0]),
      "int",
    );
    const result = applyBitShiftToRasterImage(raster, 2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([40, -40, 32767, -32768, 0]);
  });

  it("multiplies float32 values without clamping", () => {
    const raster = createSingleBandRasterImageFromValues(
      new Float32Array([0.25, -0.5, 1.5]),
      "float",
    );
    const result = applyBitShiftToRasterImage(raster, 3);
    expect(Array.from(result.bandPixels[0]!)).toEqual([2, -4, 12]);
  });

  it("shifts every band independently for multi-band rasters", () => {
    const raster = createTwoBandUint16RasterImage([100, 200], [50, 60]);
    const result = applyBitShiftToRasterImage(raster, 2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([400, 800]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([200, 240]);
  });

  it("does not mutate the source raster's pixel buffers", () => {
    const sourceBand = new Uint16Array([1, 2, 3, 4]);
    const raster = createSingleBandRasterImageFromValues(sourceBand);
    applyBitShiftToRasterImage(raster, 5);
    expect(Array.from(sourceBand)).toEqual([1, 2, 3, 4]);
  });

  it("rejects non-integer shift amounts", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint16Array([1]));
    expect(() => applyBitShiftToRasterImage(raster, 1.5)).toThrow(/integer/i);
  });

  it("rejects shift amounts below the minimum", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint16Array([1]));
    expect(() => applyBitShiftToRasterImage(raster, MIN_BIT_SHIFT_AMOUNT - 1)).toThrow(/between/i);
  });

  it("rejects shift amounts above the maximum", () => {
    const raster = createSingleBandRasterImageFromValues(new Uint16Array([1]));
    expect(() => applyBitShiftToRasterImage(raster, MAX_BIT_SHIFT_AMOUNT + 1)).toThrow(/between/i);
  });
});

function createSingleBandRasterImageFromValues(
  band: Uint8Array | Uint16Array | Int16Array | Float32Array,
  sampleFormat: RasterImage["sampleFormat"] = inferSampleFormatFromBand(band),
): RasterImage {
  return {
    bandPixels: [band],
    width: band.length,
    height: 1,
    bitsPerSample: band.BYTES_PER_ELEMENT * 8,
    sampleFormat,
    bandCount: 1,
  };
}

function createTwoBandUint16RasterImage(
  bandA: ReadonlyArray<number>,
  bandB: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [new Uint16Array(bandA), new Uint16Array(bandB)],
    width: bandA.length,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 2,
  };
}

function inferSampleFormatFromBand(
  band: Uint8Array | Uint16Array | Int16Array | Float32Array,
): RasterImage["sampleFormat"] {
  if (band instanceof Float32Array) return "float";
  if (band instanceof Int16Array) return "int";
  return "uint";
}
