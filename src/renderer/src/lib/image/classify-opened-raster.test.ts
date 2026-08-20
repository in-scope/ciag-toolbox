import { describe, expect, it } from "vitest";

import {
  classifyDecodedViewportSourceForOpenImagesFlow,
  classifyOpenedRasterByShape,
} from "./classify-opened-raster";
import type { RasterImage } from "./raster-image";
import type { ViewportImageSource } from "../webgl/texture";

// CT-263: the open-review classification keys on the DECODED band count, not
// on the source kind. The fixtures below mirror what each real file decodes
// to: a grayscale PNG promotes to a single-band uint8 raster, a colour PNG to
// a 3-band rgb-tagged raster, TIFFs load as untagged uint16 rasters.

function buildPromotedGrayscalePhotoRaster(): RasterImage {
  return {
    bandPixels: [new Uint8Array(4)],
    width: 2,
    height: 2,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildPromotedColorPhotoRaster(): RasterImage {
  return {
    bandPixels: [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)],
    width: 2,
    height: 2,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    bandLabels: ["Red", "Green", "Blue"],
    colorInterpretation: "rgb",
  };
}

function buildSingleBandTiffRaster(): RasterImage {
  return {
    bandPixels: [new Uint16Array(4)],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function buildMultiBandTiffRaster(bandCount: number): RasterImage {
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
  it("classifies a promoted grayscale photo (single-band uint8) as stackable-plane", () => {
    expect(classifyOpenedRasterByShape(buildPromotedGrayscalePhotoRaster())).toEqual({
      kind: "stackable-plane",
    });
  });

  it("classifies a promoted colour photo (3-band rgb composite) as color-photo", () => {
    expect(classifyOpenedRasterByShape(buildPromotedColorPhotoRaster())).toEqual({
      kind: "color-photo",
    });
  });

  it("classifies a single-band TIFF raster as stackable-plane", () => {
    expect(classifyOpenedRasterByShape(buildSingleBandTiffRaster())).toEqual({
      kind: "stackable-plane",
    });
  });

  it("classifies a multi-band TIFF raster (bandCount=3, no rgb tag) as already-multi-band", () => {
    expect(classifyOpenedRasterByShape(buildMultiBandTiffRaster(3))).toEqual({
      kind: "already-multi-band",
      bandCount: 3,
    });
  });

  it("classifies a multi-band raster (bandCount=10) as already-multi-band with the correct count", () => {
    expect(classifyOpenedRasterByShape(buildMultiBandTiffRaster(10))).toEqual({
      kind: "already-multi-band",
      bandCount: 10,
    });
  });

  it("classifies a float32 single-band raster as stackable-plane regardless of sample format", () => {
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

describe("classifyDecodedViewportSourceForOpenImagesFlow", () => {
  it("classifies a raster source by its raster's shape", () => {
    const source: ViewportImageSource = {
      kind: "raster",
      raster: buildPromotedGrayscalePhotoRaster(),
    };
    expect(classifyDecodedViewportSourceForOpenImagesFlow(source)).toEqual({
      kind: "stackable-plane",
    });
  });

  it("classifies an unpromoted browser source as color-photo (never a 1-band raster)", () => {
    const source: ViewportImageSource = {
      kind: "pixels",
      pixels: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    };
    expect(classifyDecodedViewportSourceForOpenImagesFlow(source)).toEqual({
      kind: "color-photo",
    });
  });
});
