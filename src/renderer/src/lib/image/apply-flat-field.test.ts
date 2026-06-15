import { describe, expect, it } from "vitest";

import { applyFlatFieldToRasterImage } from "@/lib/image/apply-flat-field";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

describe("applyFlatFieldToRasterImage", () => {
  it("computes C = m * (R - D) / (F - D) per band with no dark reference (D = 0)", () => {
    const target = buildRaster([new Uint8Array([4, 8])]);
    const light = buildRaster([new Uint8Array([2, 6])]);
    const result = applyFlatFieldToRasterImage(target, light);
    // F - D = [2, 6], mean m = 4. C = 4 * R / F = [4*4/2, 4*8/6] = [8, 16/3].
    expect(result.bandPixels[0]![0]!).toBeCloseTo(8);
    expect(result.bandPixels[0]![1]!).toBeCloseTo(16 / 3);
  });

  it("treats an omitted dark reference identically to an all-zeros dark reference", () => {
    const target = buildRaster([new Uint8Array([4, 8])]);
    const light = buildRaster([new Uint8Array([2, 6])]);
    const zeroDark = buildRaster([new Uint8Array([0, 0])]);
    const withoutDark = applyFlatFieldToRasterImage(target, light);
    const withZeroDark = applyFlatFieldToRasterImage(target, light, zeroDark);
    expect(Array.from(withZeroDark.bandPixels[0]!)).toEqual(Array.from(withoutDark.bandPixels[0]!));
  });

  it("subtracts the dark reference from both target and light", () => {
    const target = buildRaster([new Uint8Array([5, 9])]);
    const light = buildRaster([new Uint8Array([3, 7])]);
    const dark = buildRaster([new Uint8Array([1, 1])]);
    const result = applyFlatFieldToRasterImage(target, light, dark);
    // F - D = [2, 6], m = 4. C = 4 * (R - D) / (F - D) = [4*4/2, 4*8/6] = [8, 16/3].
    expect(result.bandPixels[0]![0]!).toBeCloseTo(8);
    expect(result.bandPixels[0]![1]!).toBeCloseTo(16 / 3);
  });

  it("produces a float32 raster so fractional results survive", () => {
    const target = buildRaster([new Uint8Array([4, 8])]);
    const light = buildRaster([new Uint8Array([2, 6])]);
    const result = applyFlatFieldToRasterImage(target, light);
    expect(result.sampleFormat).toBe("float");
    expect(result.bandPixels[0]!).toBeInstanceOf(Float32Array);
  });

  it("rejects a light reference whose spatial size does not match the target (CT-111 case b)", () => {
    const target = buildRaster([new Uint8Array([1, 2, 3, 4])], 2, 2);
    const light = buildRaster([new Uint8Array([1, 2])], 2, 1);
    expect(() => applyFlatFieldToRasterImage(target, light)).toThrow(/Light reference size \(2x1\)/);
    expect(() => applyFlatFieldToRasterImage(target, light)).toThrow(/stack size \(2x2\)/);
  });

  it("rejects a multi-band reference whose band count is neither equal nor one (CT-111 case a)", () => {
    const target = buildRaster([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    const light = buildRaster([
      new Uint8Array([1, 1]),
      new Uint8Array([1, 1]),
      new Uint8Array([1, 1]),
    ]);
    expect(() => applyFlatFieldToRasterImage(target, light)).toThrow(/Light reference has 3 bands/);
  });

  it("rejects a multi-band dark reference whose band count is neither equal nor one", () => {
    const target = buildRaster([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    const light = buildRaster([new Uint8Array([1, 1]), new Uint8Array([1, 1])]);
    const dark = buildRaster([
      new Uint8Array([0, 0]),
      new Uint8Array([0, 0]),
      new Uint8Array([0, 0]),
    ]);
    expect(() => applyFlatFieldToRasterImage(target, light, dark)).toThrow(/Dark reference has 3 bands/);
  });

  it("broadcasts a single-band reference across every band of a multi-band target (CT-111 case c)", () => {
    const target = buildRaster([new Uint8Array([4, 8]), new Uint8Array([10, 20])]);
    const light = buildRaster([new Uint8Array([2, 6])]);
    const result = applyFlatFieldToRasterImage(target, light);
    // F - D = [2, 6], m = 4 for both bands. Band 0: 4*[4,8]/[2,6] = [8, 16/3].
    expect(result.bandPixels[0]![0]!).toBeCloseTo(8);
    expect(result.bandPixels[0]![1]!).toBeCloseTo(16 / 3);
    // Band 1: 4*[10,20]/[2,6] = [20, 40/3].
    expect(result.bandPixels[1]![0]!).toBeCloseTo(20);
    expect(result.bandPixels[1]![1]!).toBeCloseTo(40 / 3);
  });

  it("aborts naming the failing band when light minus dark is zero anywhere", () => {
    const target = buildRaster([new Uint8Array([1, 2])]);
    const light = buildRaster([new Uint8Array([3, 0])]);
    expect(() => applyFlatFieldToRasterImage(target, light)).toThrow(/divide by zero/);
  });
});

function buildRaster(
  bandPixels: ReadonlyArray<RasterTypedArray>,
  width = bandPixels[0]!.length,
  height = 1,
): RasterImage {
  return {
    bandPixels,
    width,
    height,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: bandPixels.length,
  };
}
