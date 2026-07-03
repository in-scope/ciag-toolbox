import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import { DENOISE_ACTION, readDenoiseSettings } from "./denoise-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

// Band 1 carries an isolated 255 spike in a field of 100s: the exact median
// oracle (radius 1 restores 100 everywhere) and an easy Gaussian one (the
// spike pixel drops far below 255). Band 2 is flat 40 so carry-through under
// band-wise scope is visible.
function makeSpikedTwoBandStack(): RasterImage {
  const spiked = new Uint8Array(16).fill(100);
  spiked[5] = 255;
  return {
    bandPixels: [spiked, new Uint8Array(16).fill(40)],
    width: 4,
    height: 4,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function transformRaster(parameterValues: Record<string, number | string | boolean>): RasterImage {
  const result = DENOISE_ACTION.transformSource!(
    { kind: "raster", raster: makeSpikedTwoBandStack() },
    parameterValues,
  );
  return (result as { raster: RasterImage }).raster;
}

describe("readDenoiseSettings", () => {
  it("defaults to Gaussian with sigma 1", () => {
    expect(readDenoiseSettings({})).toEqual({ method: "gaussian", sigma: 1 });
  });

  it("reads each method's own parameter field", () => {
    expect(readDenoiseSettings({ method: "gaussian", gaussianSigma: 2.5 })).toEqual({
      method: "gaussian",
      sigma: 2.5,
    });
    expect(readDenoiseSettings({ method: "median", medianRadius: 2 })).toEqual({
      method: "median",
      radius: 2,
    });
  });
});

describe("DENOISE_ACTION", () => {
  it("median-denoises every band under the default full-stack scope into a float32 stack", () => {
    const raster = transformRaster({ method: "median", medianRadius: 1 });
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
    expect(raster.bandCount).toBe(2);
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(4);
    expect(Array.from(raster.bandPixels[0]!)).toEqual(Array.from(new Float32Array(16).fill(100)));
    expect(Array.from(raster.bandPixels[1]!)).toEqual(Array.from(new Float32Array(16).fill(40)));
  });

  it("Gaussian-denoises with a normalized kernel so a flat band stays flat", () => {
    const raster = transformRaster({ method: "gaussian", gaussianSigma: 1 });
    const spikedResult = raster.bandPixels[0]!;
    expect(spikedResult[5]).toBeGreaterThan(100);
    expect(spikedResult[5]).toBeLessThan(200);
    for (const value of raster.bandPixels[1]!) expect(value).toBeCloseTo(40, 4);
  });

  it("denoises only the entered bands under band-wise scope and carries the rest unchanged", () => {
    const raster = transformRaster({
      method: "median",
      medianRadius: 1,
      scope: "band-wise",
      bandRange: "1",
    });
    expect(Array.from(raster.bandPixels[0]!)).toEqual(Array.from(new Float32Array(16).fill(100)));
    expect(Array.from(raster.bandPixels[1]!)).toEqual(Array.from(new Float32Array(16).fill(40)));
  });

  it("falls back to the viewed band when band-wise scope has no entered range", () => {
    const prepared = DENOISE_ACTION.prepareParameterValuesForApply!(
      { method: "median", medianRadius: 1, scope: "band-wise" },
      { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 },
      "whole-image",
    );
    const raster = transformRaster({ ...prepared });
    const spikedCarriedThrough = raster.bandPixels[0]!;
    expect(spikedCarriedThrough[5]).toBe(255);
    expect(Array.from(raster.bandPixels[1]!)).toEqual(Array.from(new Float32Array(16).fill(40)));
  });

  it("rejects an invalid band range with a user-facing error", () => {
    expect(() =>
      transformRaster({ method: "median", scope: "band-wise", bandRange: "9" }),
    ).toThrow(/band/i);
  });

  it("records method, parameter, and scope in the applied label for the audit trail", () => {
    expect(DENOISE_ACTION.formatAppliedLabel!({ method: "gaussian", gaussianSigma: 1.5 })).toBe(
      "Denoise (Gaussian, sigma 1.5, full stack)",
    );
    expect(
      DENOISE_ACTION.formatAppliedLabel!({
        method: "median",
        medianRadius: 2,
        scope: "band-wise",
        bandRange: "1-2",
      }),
    ).toBe("Denoise (median, radius 2, band-wise: bands 1-2)");
  });
});
