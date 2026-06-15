import { describe, expect, it } from "vitest";

import { shouldRenderRasterAsRgbComposite } from "./raster-color-interpretation";
import type { RasterImage } from "./raster-image";

function makeRaster(overrides: Partial<RasterImage>): RasterImage {
  return {
    bandPixels: [new Uint8Array([1]), new Uint8Array([1]), new Uint8Array([1])],
    width: 1,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    ...overrides,
  };
}

describe("shouldRenderRasterAsRgbComposite", () => {
  it("is true for a 3-band raster tagged rgb", () => {
    expect(shouldRenderRasterAsRgbComposite(makeRaster({ colorInterpretation: "rgb" }))).toBe(true);
  });

  it("is false for a 3-band raster with no colour interpretation (a scientific stack)", () => {
    expect(shouldRenderRasterAsRgbComposite(makeRaster({ colorInterpretation: undefined }))).toBe(false);
  });

  it("is false for an rgb-tagged raster that does not have exactly three bands", () => {
    const oneBand = makeRaster({ colorInterpretation: "rgb", bandCount: 1, bandPixels: [new Uint8Array([1])] });
    expect(shouldRenderRasterAsRgbComposite(oneBand)).toBe(false);
  });
});
