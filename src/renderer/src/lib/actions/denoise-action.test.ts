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

async function transformRaster(
  parameterValues: Record<string, number | string | boolean>,
): Promise<RasterImage> {
  const result = await DENOISE_ACTION.transformSourceAsync!(
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
  it("median-denoises every band under the default full-stack scope into a float32 stack", async () => {
    const raster = await transformRaster({ method: "median", medianRadius: 1 });
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
    expect(raster.bandCount).toBe(2);
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(4);
    expect(Array.from(raster.bandPixels[0]!)).toEqual(Array.from(new Float32Array(16).fill(100)));
    expect(Array.from(raster.bandPixels[1]!)).toEqual(Array.from(new Float32Array(16).fill(40)));
  });

  it("Gaussian-denoises with a normalized kernel so a flat band stays flat", async () => {
    const raster = await transformRaster({ method: "gaussian", gaussianSigma: 1 });
    const spikedResult = raster.bandPixels[0]!;
    expect(spikedResult[5]).toBeGreaterThan(100);
    expect(spikedResult[5]).toBeLessThan(200);
    for (const value of raster.bandPixels[1]!) expect(value).toBeCloseTo(40, 4);
  });

  it("denoises only the entered bands under band-wise scope and carries the rest unchanged", async () => {
    const raster = await transformRaster({
      method: "median",
      medianRadius: 1,
      scope: "band-wise",
      bandRange: "1",
    });
    expect(Array.from(raster.bandPixels[0]!)).toEqual(Array.from(new Float32Array(16).fill(100)));
    expect(Array.from(raster.bandPixels[1]!)).toEqual(Array.from(new Float32Array(16).fill(40)));
  });

  it("denoises every band when band-wise scope has an empty range (CT-251)", async () => {
    const prepared = DENOISE_ACTION.prepareParameterValuesForApply!(
      { method: "median", medianRadius: 1, scope: "band-wise", bandRange: "" },
      { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 },
      "whole-image",
      makeSpikedTwoBandStack(),
    );
    const raster = await transformRaster({ ...prepared });
    expect(Array.from(raster.bandPixels[0]!)).toEqual(Array.from(new Float32Array(16).fill(100)));
    expect(Array.from(raster.bandPixels[1]!)).toEqual(Array.from(new Float32Array(16).fill(40)));
  });

  it("records the full band range for an empty-field band-wise apply (CT-251)", () => {
    const prepared = DENOISE_ACTION.prepareParameterValuesForApply!(
      { method: "median", medianRadius: 2, scope: "band-wise", bandRange: "" },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
      makeSpikedTwoBandStack(),
    );
    expect(DENOISE_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Denoise (median, radius 2, band-wise: bands 1-2)",
    );
  });

  it("rejects an invalid band range with a user-facing error", async () => {
    await expect(
      transformRaster({ method: "median", scope: "band-wise", bandRange: "9" }),
    ).rejects.toThrow(/band/i);
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

// CT-221 per-band completions plus CT-226 within-band row-chunk fractions: the
// sequence is monotonic 0..1 and crosses the between-bands boundary.
describe("DENOISE_ACTION progress (CT-221/CT-226)", () => {
  it("reports a monotonic 0-to-1 sequence with within-band fractions", async () => {
    const ticks: number[] = [];
    await DENOISE_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeSpikedTwoBandStack() },
      { method: "median", medianRadius: 1 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(1);
    expect(ticks).toContain(1 / 2);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });
});
