import { describe, expect, it } from "vitest";

import { buildLuminanceRasterFromRgbComposite } from "@/lib/image/rgb-composite-luminance";
import type { RasterImage } from "@/lib/image/raster-image";

function buildRgbCompositeFixture(): RasterImage {
  return {
    width: 2,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    colorInterpretation: "rgb",
    bandLabels: ["Red", "Green", "Blue"],
    bandPixels: [new Uint8Array([255, 0]), new Uint8Array([0, 255]), new Uint8Array([0, 0])],
  };
}

describe("buildLuminanceRasterFromRgbComposite", () => {
  it("weights the three channels by the Rec. 709 luma coefficients", () => {
    const luminance = buildLuminanceRasterFromRgbComposite(buildRgbCompositeFixture());
    expect(Array.from(luminance.bandPixels[0]!)).toEqual([54, 182]);
  });

  it("returns a single-band raster with no colour interpretation or band metadata", () => {
    const luminance = buildLuminanceRasterFromRgbComposite(buildRgbCompositeFixture());
    expect(luminance.bandCount).toBe(1);
    expect(luminance.bandPixels).toHaveLength(1);
    expect(luminance.colorInterpretation).toBeUndefined();
    expect(luminance.bandLabels).toBeUndefined();
  });

  it("keeps the source data type so the histogram bins over the same container range", () => {
    const luminance = buildLuminanceRasterFromRgbComposite(buildRgbCompositeFixture());
    expect(luminance.sampleFormat).toBe("uint");
    expect(luminance.bitsPerSample).toBe(8);
    expect(luminance.bandPixels[0]).toBeInstanceOf(Uint8Array);
  });
});
