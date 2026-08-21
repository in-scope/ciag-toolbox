import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import {
  assertCubeHasEnoughBandsForSpectralDerivativeOrder,
  computeSpectralDerivative,
  computeSpectralDerivativeReportingProgress,
  describeSpectralDerivativeOrder,
} from "./spectral-derivative";

// A 2x2 cube whose spectrum at every pixel is linear along the band axis:
// value(band k) = base + k * slope, with a different base and slope per pixel.
// The first-order derivative of a linear spectrum is the constant slope at
// every band (edge bands included, since one-sided differences of a linear
// spectrum equal the slope too); the second-order derivative is zero everywhere.
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

// A one-pixel, five-band cube whose spectrum is deliberately NOT polynomial, so
// every finite difference (interior and one-sided edge) has a distinct exact
// value that pins the locked CT-285 edge scheme.
const CURVED_SPECTRUM_VALUES = [2, 3, 7, 20, 21];
const CURVED_SPECTRUM_WAVELENGTHS = [400, 450, 500, 550, 600];
const CURVED_SPECTRUM_LABELS = ["b400", "b450", "b500", "b550", "b600"];

function makeCurvedSpectrumCube(): RasterImage {
  return {
    bandPixels: CURVED_SPECTRUM_VALUES.map((value) => Float32Array.from([value])),
    width: 1,
    height: 1,
    bandCount: CURVED_SPECTRUM_VALUES.length,
    sampleFormat: "float",
    bitsPerSample: 32,
    bandLabels: CURVED_SPECTRUM_LABELS,
    bandWavelengths: CURVED_SPECTRUM_WAVELENGTHS,
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

function readSinglePixelPerBand(raster: RasterImage): number[] {
  return raster.bandPixels.map((band) => band[0] ?? Number.NaN);
}

describe("computeSpectralDerivative", () => {
  it("keeps the source band count for both orders", () => {
    expect(computeSpectralDerivative(makeCurvedSpectrumCube(), 1).bandCount).toBe(5);
    expect(computeSpectralDerivative(makeCurvedSpectrumCube(), 2).bandCount).toBe(5);
  });

  it("computes forward differences with a one-sided backward difference for the last band", () => {
    const result = computeSpectralDerivative(makeCurvedSpectrumCube(), 1);
    // Forward: 3-2, 7-3, 20-7, 21-20; last band backward: 21-20.
    expect(readSinglePixelPerBand(result)).toEqual([1, 4, 13, 1, 1]);
  });

  it("computes centered second differences with one-sided second-order edges", () => {
    const result = computeSpectralDerivative(makeCurvedSpectrumCube(), 2);
    // Interior centered: 2-6+7=3, 3-14+20=9, 7-40+21=-12; each edge takes the
    // one-sided second difference over its nearest three bands.
    expect(readSinglePixelPerBand(result)).toEqual([3, 3, 9, -12, -12]);
  });

  it("returns the constant per-pixel slope in every band for a first-order derivative of a linear spectrum", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 1);
    expect(result.bandCount).toBe(LINEAR_CUBE_BAND_COUNT);
    for (const band of result.bandPixels) {
      expect(Array.from(band)).toEqual(PIXEL_SLOPES);
    }
  });

  it("returns zero everywhere for a second-order derivative of a linear spectrum", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 2);
    expect(result.bandCount).toBe(LINEAR_CUBE_BAND_COUNT);
    for (const band of result.bandPixels) {
      expect(Array.from(band)).toEqual([0, 0, 0, 0]);
    }
  });

  it("defaults to the first order when no order is given", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube());
    expect(result.bandCount).toBe(LINEAR_CUBE_BAND_COUNT);
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
    expect(result.bandCount).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([-50, 800]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([-50, 800]);
  });

  it("carries band wavelengths and labels through one-to-one for both orders", () => {
    for (const order of [1, 2] as const) {
      const result = computeSpectralDerivative(makeCurvedSpectrumCube(), order);
      expect(result.bandWavelengths).toEqual(CURVED_SPECTRUM_WAVELENGTHS);
      expect(result.bandLabels).toEqual(CURVED_SPECTRUM_LABELS);
    }
  });

  it("leaves band wavelengths and labels undefined when the source has none", () => {
    const result = computeSpectralDerivative(makeLinearSpectrumCube(), 1);
    expect(result.bandWavelengths).toBeUndefined();
    expect(result.bandLabels).toBeUndefined();
  });

  it("rejects a single-band stack for the first order with a user-facing error", () => {
    const singleBand = { ...makeTwoBandUint16Cube(), bandPixels: [Uint16Array.from([1, 2])], bandCount: 1 };
    expect(() => computeSpectralDerivative(singleBand, 1)).toThrow(/at least 2 bands/);
  });

  it("rejects a two-band stack for the second order with a user-facing error", () => {
    expect(() => computeSpectralDerivative(makeTwoBandUint16Cube(), 2)).toThrow(/at least 3 bands/);
  });
});

describe("computeSpectralDerivativeReportingProgress", () => {
  it("matches the sync computation exactly, edge bands and metadata included", async () => {
    for (const order of [1, 2] as const) {
      const asyncResult = await computeSpectralDerivativeReportingProgress(
        makeCurvedSpectrumCube(),
        order,
      );
      expect(asyncResult).toEqual(computeSpectralDerivative(makeCurvedSpectrumCube(), order));
    }
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
