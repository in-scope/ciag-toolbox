import { describe, expect, it } from "vitest";

import {
  applyGeometricTransformToRasterImage,
  applyGeometricTransformToRasterImageReportingProgress,
  GEOMETRIC_TRANSFORMS,
  isGeometricTransform,
  type GeometricTransform,
} from "./apply-geometric-transform";
import type { RasterImage, RasterTypedArray } from "./raster-image";

function makeSingleBandRaster(
  values: ReadonlyArray<number>,
  width: number,
  height: number,
  band: RasterTypedArray = Uint8Array.from(values),
): RasterImage {
  return { bandPixels: [band], width, height, bandCount: 1, sampleFormat: "uint", bitsPerSample: 8 };
}

// A 3-wide, 2-tall band: row0 = 1 2 3, row1 = 4 5 6.
const THREE_BY_TWO = [1, 2, 3, 4, 5, 6];

describe("applyGeometricTransformToRasterImage", () => {
  it("rotates 90 degrees clockwise and swaps width and height", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "rotate-90-cw");
    expect([result.width, result.height]).toEqual([2, 3]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([4, 1, 5, 2, 6, 3]);
  });

  it("rotates 180 degrees keeping the dimensions and reversing every pixel", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "rotate-180");
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("rotates 270 degrees clockwise and swaps width and height", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "rotate-270-cw");
    expect([result.width, result.height]).toEqual([2, 3]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([3, 6, 2, 5, 1, 4]);
  });

  it("flips horizontally by reversing each row", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "flip-horizontal");
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it("flips vertically by swapping rows top to bottom", () => {
    const result = applyGeometricTransformToRasterImage(makeSingleBandRaster(THREE_BY_TWO, 3, 2), "flip-vertical");
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Array.from(result.bandPixels[0]!)).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it("transforms every band of a multi-band cube together", () => {
    const raster: RasterImage = {
      bandPixels: [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([10, 20, 30, 40])],
      width: 2,
      height: 2,
      bandCount: 2,
      sampleFormat: "uint",
      bitsPerSample: 8,
    };
    const result = applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(Array.from(result.bandPixels[0]!)).toEqual([3, 1, 4, 2]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([30, 10, 40, 20]);
  });

  it("preserves the source typed-array type", () => {
    const raster = makeSingleBandRaster(THREE_BY_TWO, 3, 2, Float32Array.from(THREE_BY_TWO));
    const result = applyGeometricTransformToRasterImage({ ...raster, sampleFormat: "float", bitsPerSample: 32 }, "rotate-180");
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
  });

  it("preserves the rgb colour interpretation so a rotated colour image stays colour", () => {
    const raster: RasterImage = {
      bandPixels: [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([5, 6, 7, 8]), Uint8Array.from([9, 10, 11, 12])],
      width: 2,
      height: 2,
      bandCount: 3,
      sampleFormat: "uint",
      bitsPerSample: 8,
      colorInterpretation: "rgb",
    };
    const result = applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(result.colorInterpretation).toBe("rgb");
  });

  it("does not mutate the source raster", () => {
    const raster = makeSingleBandRaster(THREE_BY_TWO, 3, 2);
    applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(Array.from(raster.bandPixels[0]!)).toEqual(THREE_BY_TWO);
    expect([raster.width, raster.height]).toEqual([3, 2]);
  });
});

// CT-267: the pre-CT-267 implementation mapped every pixel through a per-pixel
// closure returning a {dx, dy} object. It is reproduced here verbatim as the
// pure-output oracle for the tight-loop rewrite.
const REFERENCE_PIXEL_MAPPINGS: Record<
  GeometricTransform,
  (x: number, y: number, w: number, h: number) => { dx: number; dy: number }
> = {
  "rotate-90-cw": (x, y, _w, h) => ({ dx: h - 1 - y, dy: x }),
  "rotate-180": (x, y, w, h) => ({ dx: w - 1 - x, dy: h - 1 - y }),
  "rotate-270-cw": (x, y, w, _h) => ({ dx: y, dy: w - 1 - x }),
  "flip-horizontal": (x, y, w, _h) => ({ dx: w - 1 - x, dy: y }),
  "flip-vertical": (x, y, _w, h) => ({ dx: x, dy: h - 1 - y }),
};

function transformWithReferenceImplementation(
  raster: RasterImage,
  transform: GeometricTransform,
): number[][] {
  const swapsDimensions = transform === "rotate-90-cw" || transform === "rotate-270-cw";
  const destinationWidth = swapsDimensions ? raster.height : raster.width;
  return raster.bandPixels.map((band) =>
    remapBandWithReferenceMapping(band, raster, destinationWidth, REFERENCE_PIXEL_MAPPINGS[transform]),
  );
}

function remapBandWithReferenceMapping(
  band: RasterTypedArray,
  raster: RasterImage,
  destinationWidth: number,
  mapPixel: (x: number, y: number, w: number, h: number) => { dx: number; dy: number },
): number[] {
  const destination = new Array<number>(band.length).fill(0);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const { dx, dy } = mapPixel(x, y, raster.width, raster.height);
      destination[dy * destinationWidth + dx] = band[y * raster.width + x] ?? 0;
    }
  }
  return destination;
}

function makePseudoRandomTwoBandRaster(width: number, height: number): RasterImage {
  const valueAt = (bandIndex: number, index: number) => ((index * 2654435761 + bandIndex * 40503) >>> 16) % 4096;
  const bandPixels = [0, 1].map((bandIndex) =>
    Uint16Array.from({ length: width * height }, (_unused, index) => valueAt(bandIndex, index)),
  );
  return { bandPixels, width, height, bandCount: 2, sampleFormat: "uint", bitsPerSample: 16 };
}

describe("tight-loop remap equivalence with the pre-CT-267 per-pixel-closure implementation", () => {
  // A tile-boundary-crossing non-square shape: 133 x 71 spans two 128-wide
  // rotation tiles with ragged edges on both axes.
  const raster = makePseudoRandomTwoBandRaster(133, 71);

  it.each(GEOMETRIC_TRANSFORMS.map((transform) => [transform] as const))(
    "produces byte-identical output for %s",
    (transform) => {
      const result = applyGeometricTransformToRasterImage(raster, transform);
      const reference = transformWithReferenceImplementation(raster, transform);
      result.bandPixels.forEach((band, bandIndex) => {
        expect(Array.from(band)).toEqual(reference[bandIndex]);
      });
    },
  );

  it("matches the reference for a float32 band too", () => {
    const floatRaster: RasterImage = {
      bandPixels: [Float32Array.from({ length: 35 }, (_unused, index) => index * 1.5 - 20)],
      width: 7,
      height: 5,
      bandCount: 1,
      sampleFormat: "float",
      bitsPerSample: 32,
    };
    const result = applyGeometricTransformToRasterImage(floatRaster, "rotate-270-cw");
    expect(Array.from(result.bandPixels[0]!)).toEqual(
      transformWithReferenceImplementation(floatRaster, "rotate-270-cw")[0],
    );
  });
});

describe("applyGeometricTransformToRasterImageReportingProgress", () => {
  const raster = makePseudoRandomTwoBandRaster(9, 4);

  it("produces the same output as the synchronous transform", async () => {
    const result = await applyGeometricTransformToRasterImageReportingProgress(raster, "rotate-90-cw");
    const synchronous = applyGeometricTransformToRasterImage(raster, "rotate-90-cw");
    expect(result.bandPixels.map((band) => Array.from(band))).toEqual(
      synchronous.bandPixels.map((band) => Array.from(band)),
    );
    expect([result.width, result.height]).toEqual([synchronous.width, synchronous.height]);
  });

  it("reports determinate progress once per band", async () => {
    const fractions: number[] = [];
    await applyGeometricTransformToRasterImageReportingProgress(raster, "flip-horizontal", (fraction) =>
      fractions.push(fraction),
    );
    expect(fractions).toEqual([0, 1 / 2, 1]);
  });
});

describe("isGeometricTransform", () => {
  it("accepts the five supported transforms and rejects anything else", () => {
    expect(isGeometricTransform("rotate-90-cw")).toBe(true);
    expect(isGeometricTransform("flip-vertical")).toBe(true);
    expect(isGeometricTransform("rotate-45")).toBe(false);
    expect(isGeometricTransform(90)).toBe(false);
  });
});
