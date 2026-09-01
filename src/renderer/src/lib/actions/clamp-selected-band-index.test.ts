import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import { clampSelectedBandIndexToRaster } from "./clamp-selected-band-index";
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  type ViewportRenderingState,
} from "./viewport-action";

describe("clampSelectedBandIndexToRaster", () => {
  it("clamps a 300-band index against a one-band result raster to 0", () => {
    const state = buildStateSelectingBandIndex(300);
    const clamped = clampSelectedBandIndexToRaster(state, buildRasterSourceWithBandCount(1));
    expect(clamped.selectedBandIndex).toBe(0);
  });

  it("preserves an index the result raster still has", () => {
    const state = buildStateSelectingBandIndex(2);
    const clamped = clampSelectedBandIndexToRaster(state, buildRasterSourceWithBandCount(3));
    expect(clamped).toBe(state);
  });

  it("clamps the first index past the last band", () => {
    const state = buildStateSelectingBandIndex(3);
    const clamped = clampSelectedBandIndexToRaster(state, buildRasterSourceWithBandCount(3));
    expect(clamped.selectedBandIndex).toBe(0);
  });

  it("leaves the index alone when the result is not a raster", () => {
    const state = buildStateSelectingBandIndex(279);
    const clamped = clampSelectedBandIndexToRaster(state, buildSinglePixelSource());
    expect(clamped).toBe(state);
  });

  it("leaves the index alone when the action produced no result source", () => {
    const state = buildStateSelectingBandIndex(279);
    expect(clampSelectedBandIndexToRaster(state, null)).toBe(state);
  });

  it("keeps every other field of the state it clamps", () => {
    const state = { ...buildStateSelectingBandIndex(279), normalizationEnabled: true };
    const clamped = clampSelectedBandIndexToRaster(state, buildRasterSourceWithBandCount(1));
    expect(clamped).toEqual({ ...state, selectedBandIndex: 0 });
  });
});

function buildStateSelectingBandIndex(selectedBandIndex: number): ViewportRenderingState {
  return { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex };
}

function buildRasterSourceWithBandCount(bandCount: number): ViewportImageSource {
  return { kind: "raster", raster: buildUint16RasterWithBandCount(bandCount) };
}

function buildUint16RasterWithBandCount(bandCount: number): RasterImage {
  return {
    bandPixels: Array.from({ length: bandCount }, () => new Uint16Array([1])),
    width: 1,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount,
  };
}

function buildSinglePixelSource(): ViewportImageSource {
  return { kind: "pixels", pixels: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 };
}
