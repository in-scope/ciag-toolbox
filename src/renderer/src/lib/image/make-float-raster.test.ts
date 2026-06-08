import { describe, expect, it } from "vitest";

import {
  FLOAT32_BITS_PER_SAMPLE,
  makeFloatRasterFromBandComputation,
  mapBandPixelsToFloat32,
} from "@/lib/image/make-float-raster";
import type { RasterImage } from "@/lib/image/raster-image";

describe("makeFloatRasterFromBandComputation", () => {
  it("produces a float32 raster with Float32Array band buffers", () => {
    const result = makeFloatRasterFromBandComputation(buildUint8Raster(), halveEachValue);
    expect(result.sampleFormat).toBe("float");
    expect(result.bitsPerSample).toBe(FLOAT32_BITS_PER_SAMPLE);
    expect(result.bandPixels[0]!).toBeInstanceOf(Float32Array);
  });

  it("computes each band through the provided function", () => {
    const result = makeFloatRasterFromBandComputation(buildUint8Raster(), halveEachValue);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 1, 2, 3]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([5, 6, 7, 8]);
  });

  it("passes the band index to the computation", () => {
    const result = makeFloatRasterFromBandComputation(buildUint8Raster(), (_pixels, index) =>
      new Float32Array([index, index, index, index]),
    );
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0, 0, 0]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([1, 1, 1, 1]);
  });

  it("preserves dimensions, band count, and band metadata", () => {
    const result = makeFloatRasterFromBandComputation(buildUint8Raster(), halveEachValue);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.bandCount).toBe(2);
    expect(result.bandLabels).toEqual(["A", "B"]);
    expect(result.bandWavelengths).toEqual([400, 500]);
    expect(result.bandOriginalNumbers).toEqual([1, 2]);
  });

  it("preserves out-of-range true values in bandPixels for display-only clipping", () => {
    const result = makeFloatRasterFromBandComputation(buildUint8Raster(), () =>
      new Float32Array([-0.5, 0.25, 1.5, 2]),
    );
    expect(Array.from(result.bandPixels[0]!)).toEqual([-0.5, 0.25, 1.5, 2]);
  });

  it("rejects a computation that returns a wrong-length band", () => {
    expect(() =>
      makeFloatRasterFromBandComputation(buildUint8Raster(), () => new Float32Array([1, 2])),
    ).toThrow(/produced 2 values but the source band has 4/);
  });
});

describe("mapBandPixelsToFloat32", () => {
  it("maps each value through the mapper into a Float32Array", () => {
    const out = mapBandPixelsToFloat32(new Uint8Array([10, 20, 30]), (value) => value / 4);
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([2.5, 5, 7.5]);
  });

  it("passes the pixel index to the mapper", () => {
    const out = mapBandPixelsToFloat32(new Uint8Array([0, 0, 0]), (_value, index) => index);
    expect(Array.from(out)).toEqual([0, 1, 2]);
  });
});

function halveEachValue(pixels: { length: number; [index: number]: number }): Float32Array {
  return mapBandPixelsToFloat32(pixels as never, (value) => value / 2);
}

function buildUint8Raster(): RasterImage {
  return {
    bandPixels: [new Uint8Array([0, 2, 4, 6]), new Uint8Array([10, 12, 14, 16])],
    width: 2,
    height: 2,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 2,
    bandLabels: ["A", "B"],
    bandWavelengths: [400, 500],
    bandOriginalNumbers: [1, 2],
  };
}
