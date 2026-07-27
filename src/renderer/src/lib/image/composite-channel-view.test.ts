import { describe, expect, it } from "vitest";

import {
  canViewCompositeChannelsSeparately,
  resolveImageSourceForChannelView,
} from "./composite-channel-view";
import type { RasterImage } from "./raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

function makeRaster(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    bandPixels: [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])],
    width: 2,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    bandLabels: ["Red", "Green", "Blue"],
    colorInterpretation: "rgb",
    ...overrides,
  };
}

function makeCompositeSource(overrides: Partial<RasterImage> = {}): ViewportImageSource {
  return { kind: "raster", raster: makeRaster(overrides) };
}

describe("canViewCompositeChannelsSeparately", () => {
  it("offers the channel view only for a true-color composite raster", () => {
    expect(canViewCompositeChannelsSeparately(makeCompositeSource())).toBe(true);
  });

  it("refuses a scientific stack without the rgb tag", () => {
    expect(
      canViewCompositeChannelsSeparately(makeCompositeSource({ colorInterpretation: undefined })),
    ).toBe(false);
  });

  it("refuses an empty panel", () => {
    expect(canViewCompositeChannelsSeparately(null)).toBe(false);
  });
});

describe("resolveImageSourceForChannelView", () => {
  it("returns the original source untouched when the view is off", () => {
    const source = makeCompositeSource();
    expect(resolveImageSourceForChannelView(source, false)).toBe(source);
  });

  it("returns the original source for a non-composite even when the view is on", () => {
    const source = makeCompositeSource({ colorInterpretation: undefined });
    expect(resolveImageSourceForChannelView(source, true)).toBe(source);
  });

  it("derives a channel-view raster that drops only the color tag", () => {
    const source = makeCompositeSource();
    const derived = resolveImageSourceForChannelView(source, true);
    if (derived?.kind !== "raster" || source.kind !== "raster") throw new Error("expected rasters");
    expect(derived).not.toBe(source);
    expect(derived.raster.colorInterpretation).toBeUndefined();
    expect(derived.raster.bandCount).toBe(3);
    expect(derived.raster.bandLabels).toEqual(["Red", "Green", "Blue"]);
    expect(derived.raster.width).toBe(source.raster.width);
    expect(derived.raster.height).toBe(source.raster.height);
  });

  it("shares every band array with the composite by reference (no pixel copy)", () => {
    const source = makeCompositeSource();
    const derived = resolveImageSourceForChannelView(source, true);
    if (derived?.kind !== "raster" || source.kind !== "raster") throw new Error("expected rasters");
    derived.raster.bandPixels.forEach((band, index) => {
      expect(band).toBe(source.raster.bandPixels[index]);
    });
  });

  it("memoizes the derived source per composite raster so its identity is stable", () => {
    const source = makeCompositeSource();
    const first = resolveImageSourceForChannelView(source, true);
    const second = resolveImageSourceForChannelView(source, true);
    expect(second).toBe(first);
  });

  it("derives a fresh view for a different composite raster", () => {
    const first = resolveImageSourceForChannelView(makeCompositeSource(), true);
    const second = resolveImageSourceForChannelView(makeCompositeSource(), true);
    expect(second).not.toBe(first);
  });
});
