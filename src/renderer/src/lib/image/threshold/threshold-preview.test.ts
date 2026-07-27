import { describe, expect, it } from "vitest";

import type { RasterImage } from "../raster-image";
import { buildThresholdPreviewLutOrNull } from "./threshold-preview";

function makeSingleBandUint8Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: [Uint8Array.from(values)],
    width: values.length,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("buildThresholdPreviewLutOrNull", () => {
  it("returns null without a raster or bounds", () => {
    expect(buildThresholdPreviewLutOrNull(null, 0, { lower: 0, upper: 1 })).toBeNull();
    expect(buildThresholdPreviewLutOrNull(makeSingleBandUint8Raster([0, 255]), 0, null)).toBeNull();
  });

  it("builds a step LUT: in-range entries are white (1) and out-of-range black (0)", () => {
    const raster = makeSingleBandUint8Raster([0, 255]);
    const lut = buildThresholdPreviewLutOrNull(raster, 0, { lower: 100, upper: 160 });
    expect(lut).not.toBeNull();
    const entries = lut!;
    const lastIndex = entries.length - 1;
    const entryForValue = (value: number) => entries[Math.round((value / 255) * lastIndex)]!;
    expect(entryForValue(50)).toBe(0);
    expect(entryForValue(130)).toBe(1);
    expect(entryForValue(200)).toBe(0);
  });

  it("marks the whole LUT white for full-range bounds", () => {
    const raster = makeSingleBandUint8Raster([0, 255]);
    const lut = buildThresholdPreviewLutOrNull(raster, 0, { lower: 0, upper: 255 });
    expect(lut!.every((entry) => entry === 1)).toBe(true);
  });
});
