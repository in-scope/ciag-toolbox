import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { shouldRenderRasterAsRgbComposite } from "./raster-color-interpretation";
import { restoreSourceColorInterpretation } from "./restore-source-color-interpretation";

describe("restoreSourceColorInterpretation", () => {
  it("re-applies the rgb flag to a decoded raster source", () => {
    const restored = restoreSourceColorInterpretation(buildThreeBandRasterSource(), "rgb");
    expect(rasterOf(restored).colorInterpretation).toBe("rgb");
  });

  it("renders as an rgb composite once the flag is restored", () => {
    const restored = restoreSourceColorInterpretation(buildThreeBandRasterSource(), "rgb");
    expect(shouldRenderRasterAsRgbComposite(rasterOf(restored))).toBe(true);
  });

  it("leaves a raster untouched when no colour interpretation was persisted", () => {
    const source = buildThreeBandRasterSource();
    const restored = restoreSourceColorInterpretation(source, undefined);
    expect(restored).toBe(source);
  });

  it("returns a browser source unchanged because it renders in colour natively", () => {
    const source: ViewportImageSource = {
      kind: "pixels",
      pixels: new Uint8Array([1, 2, 3, 4]),
      width: 1,
      height: 1,
    };
    expect(restoreSourceColorInterpretation(source, "rgb")).toBe(source);
  });
});

function rasterOf(source: ViewportImageSource): RasterImage {
  if (source.kind !== "raster") throw new Error("expected a raster source");
  return source.raster;
}

function buildThreeBandRasterSource(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [new Uint8Array([10]), new Uint8Array([20]), new Uint8Array([30])],
    width: 1,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
  };
  return { kind: "raster", raster };
}
