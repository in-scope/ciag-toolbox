import { describe, expect, it } from "vitest";

import { classifyOpenedRasterByShape } from "./classify-opened-raster";
import type { RasterImage } from "./raster-image";

function buildSingleBandRasterFixture(): RasterImage {
  return {
    bandPixels: [new Uint16Array(4)],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandRasterFixture(bandCount: number): RasterImage {
  const bandPixels = Array.from({ length: bandCount }, () => new Uint16Array(4));
  return {
    bandPixels,
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount,
  };
}

describe("classifyOpenedRasterByShape", () => {
  it("classifies single-band raster as stackable-plane", () => {
    const raster = buildSingleBandRasterFixture();
    expect(classifyOpenedRasterByShape(raster)).toEqual({ kind: "stackable-plane" });
  });

  it("classifies multi-band raster (bandCount=3) as already-multi-band", () => {
    const raster = buildMultiBandRasterFixture(3);
    expect(classifyOpenedRasterByShape(raster)).toEqual({
      kind: "already-multi-band",
      bandCount: 3,
    });
  });

  it("classifies multi-band raster (bandCount=10) as already-multi-band with correct count", () => {
    const raster = buildMultiBandRasterFixture(10);
    expect(classifyOpenedRasterByShape(raster)).toEqual({
      kind: "already-multi-band",
      bandCount: 10,
    });
  });

  it("classifies float32 single-band raster as stackable-plane regardless of sample format", () => {
    const raster: RasterImage = {
      bandPixels: [new Float32Array(4)],
      width: 2,
      height: 2,
      bitsPerSample: 32,
      sampleFormat: "float",
      bandCount: 1,
    };
    expect(classifyOpenedRasterByShape(raster)).toEqual({ kind: "stackable-plane" });
  });
});
