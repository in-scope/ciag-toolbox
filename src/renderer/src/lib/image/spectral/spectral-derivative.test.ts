import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder,
  computeSpectralDerivative,
  describeSpectralDerivativeOrder,
} from "./spectral-derivative";

// A 2x2 cube whose spectrum at every pixel is linear along the band axis:
// value(band k) = base + k * slope, with a different base and slope per pixel.
// The first-order derivative of a linear spectrum is the constant slope at
// every band; the second-order derivative is zero everywhere.
const PIXEL_BASES = [10, 20, 30, 40];
const PIXEL_SLOPES = [5, -3, 0, 100];
const LINEAR_CUBE_BAND_COUNT = 4;

function makeLinearSpectrumCube(): RasterImage {
  const bandPixels = Array.from({ length: LINEAR_CUBE_BAND_COUNT }, (_unused, bandIndex) =>
    Float32Array.from(PIXEL_BASES.map((base, pixel) => base + bandIndex * (PIXEL_SLOPES[pixel] ?? 0))),
  );
  return {
    bandPixels,
    width: 2,
    height: 2,
    bandCount: LINEAR_CUBE_BAND_COUNT,
    sampleFormat: "float",
    bitsPerSample: 32,
  };
}

function makeTwoBandUint16Cube(): RasterImage {
  return {
    bandPixels: [Uint16Array.from([100, 800]), Uint16Array.from([50, 1600])],
    width: 2,
    height: 1,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

describe("computeSpectralDerivative", () => {
  it("returns the constant per-pixel slope in every band for a first-order derivative of a linear spectrum", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 1);
    expect(result.bandCount).toBe(LINEAR_CUBE_BAND_COUNT - 1);
    for (const band of result.bandPixels) {
      expect(Array.from(band)).toEqual(PIXEL_SLOPES);
    }
  });

  it("returns zero everywhere for a second-order derivative of a linear spectrum", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 2);
    expect(result.bandCount).toBe(LINEAR_CUBE_BAND_COUNT - 2);
    for (const band of result.bandPixels) {
      expect(Array.from(band)).toEqual([0, 0, 0, 0]);
    }
  });

  it("defaults to the first order when no order is given", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube());
    expect(result.bandCount).toBe(LINEAR_CUBE_BAND_COUNT - 1);
    expect(Array.from(result.bandPixels[0]!)).toEqual(PIXEL_SLOPES);
  });

  it("outputs float32 with the source's spatial dimensions", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 1);
    expect(result.sampleFormat).toBe("float");
    expect(result.bitsPerSample).toBe(32);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("preserves negative differences from an integer cube through the float path", () => {
    const result = computeSpectralDerivative(makeTwoBandUint16Cube(), 1);
    expect(result.bandCount).toBe(1);
    expect(Array.from(result.bandPixels[0]!)).toEqual([-50, 800]);
  });

  it("labels first-order bands as the difference of the source band labels", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 1);
    expect(result.bandLabels).toEqual([
      "d(Band 2 - Band 1)",
      "d(Band 3 - Band 2)",
      "d(Band 4 - Band 3)",
    ]);
  });

  it("labels second-order bands by their center source band", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 2);
    expect(result.bandLabels).toEqual(["d2(Band 2)", "d2(Band 3)"]);
  });

  it("rejects a single-band stack for the first order with a user-facing error", () => {
    const singleBand = { ...makeTwoBandUint16Cube(), bandPixels: [Uint16Array.from([1, 2])], bandCount: 1 };
    expect(() => computeSpectralDerivative(singleBand, 1)).toThrow(/at least 2 bands/);
  });

  it("rejects a two-band stack for the second order with a user-facing error", () => {
    expect(() => computeSpectralDerivative(makeTwoBandUint16Cube(), 2)).toThrow(/at least 3 bands/);
  });
});

describe("assertCubeHasEnoughBandsForSpectralDerivativeOrder", () => {
  it("accepts a stack with exactly order + 1 bands", () => {
    expect(() =>
      assertCubeHasEnoughBandsForSpectralDerivativeOrder(makeTwoBandUint16Cube(), 1),
    ).not.toThrow();
  });

  it("names the order and the actual band count in the error", () => {
    expect(() => assertCubeHasEnoughBandsForSpectralDerivativeOrder(makeTwoBandUint16Cube(), 2)).toThrow(
      /2nd order.*at least 3 bands.*has 2/,
    );
  });
});

describe("describeSpectralDerivativeOrder", () => {
  it("names both orders", () => {
    expect(describeSpectralDerivativeOrder(1)).toBe("1st order");
    expect(describeSpectralDerivativeOrder(2)).toBe("2nd order");
  });
});
