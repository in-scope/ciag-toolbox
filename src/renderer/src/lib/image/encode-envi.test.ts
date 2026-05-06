import { describe, expect, it } from "vitest";

import { encodeRasterImageAsEnviFiles } from "@/lib/image/encode-envi";
import { loadEnviAsRaster } from "@/lib/image/load-envi";
import { parseEnviHeaderText } from "@/lib/image/parse-envi-header";
import type { RasterImage, RasterSourceInterleave } from "@/lib/image/raster-image";

describe("encodeRasterImageAsEnviFiles", () => {
  it("preserves the source interleave when the raster came from ENVI", () => {
    const raster = buildRasterFixture({ sourceInterleave: "bsq" });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    expect(encoded.interleave).toBe("bsq");
    expect(parseEnviHeaderText(decodeBytes(encoded.headerBytes)).interleave).toBe("bsq");
  });

  it("defaults to BIL interleave for sources without source interleave metadata", () => {
    const raster = buildRasterFixture({ sourceInterleave: undefined });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    expect(encoded.interleave).toBe("bil");
  });

  it("writes core dimensions and data type into the header", () => {
    const raster = buildRasterFixture({ sourceInterleave: "bil" });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.samples).toBe(raster.width);
    expect(header.lines).toBe(raster.height);
    expect(header.bands).toBe(raster.bandCount);
    expect(header.dataType).toBe(12);
    expect(header.byteOrder).toBe(0);
  });

  it("writes wavelength metadata when the source raster has it", () => {
    const raster = buildRasterFixture({
      sourceInterleave: "bsq",
      bandWavelengths: [450, 550],
    });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.wavelengths).toEqual([450, 550]);
  });

  it("writes band names when the labels match the band count", () => {
    const raster = buildRasterFixture({
      sourceInterleave: "bsq",
      bandLabels: ["Red", "Green"],
    });
    const encoded = encodeRasterImageAsEnviFiles(raster);
    const header = parseEnviHeaderText(decodeBytes(encoded.headerBytes));
    expect(header.bandNames).toEqual(["Red", "Green"]);
  });

  it("rejects non-raster typed-array formats with a clear error", () => {
    const raster: RasterImage = {
      bandPixels: [new Float64Array([1])],
      width: 1,
      height: 1,
      bandCount: 1,
      bitsPerSample: 64,
      sampleFormat: "float",
    };
    expect(() => encodeRasterImageAsEnviFiles(raster)).toThrow(
      /ENVI write does not support raster format/,
    );
  });

  it("round-trips an ENVI BIP raster (read -> write -> read) producing identical pixels", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bip" });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    assertRastersHaveIdenticalCorePixelData(reloaded, originalRaster);
    expect(reloaded.sourceInterleave).toBe("bip");
  });

  it("round-trips an ENVI BSQ raster (read -> write -> read) producing identical pixels", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bsq" });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    assertRastersHaveIdenticalCorePixelData(reloaded, originalRaster);
    expect(reloaded.sourceInterleave).toBe("bsq");
  });

  it("round-trips an ENVI BIL raster (read -> write -> read) producing identical pixels", () => {
    const originalRaster = buildRasterFixture({ sourceInterleave: "bil" });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    assertRastersHaveIdenticalCorePixelData(reloaded, originalRaster);
    expect(reloaded.sourceInterleave).toBe("bil");
  });

  it("round-trips a float32 ENVI cube without precision loss", () => {
    const originalRaster: RasterImage = {
      bandPixels: [new Float32Array([1.5, 2.25, 3.5, 4.0])],
      width: 2,
      height: 2,
      bandCount: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      sourceInterleave: "bsq",
    };
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    expect(Array.from(reloaded.bandPixels[0]!)).toEqual([1.5, 2.25, 3.5, 4.0]);
  });

  it("round-trips wavelength + band-name metadata across a write/read cycle", () => {
    const originalRaster = buildRasterFixture({
      sourceInterleave: "bsq",
      bandLabels: ["Red", "Green"],
      bandWavelengths: [620, 540],
    });
    const encoded = encodeRasterImageAsEnviFiles(originalRaster);
    const reloaded = loadEnviAsRaster(encoded.headerBytes, encoded.binaryBytes);
    expect(reloaded.bandLabels).toEqual(["Red", "Green"]);
    expect(reloaded.bandWavelengths).toEqual([620, 540]);
  });
});

interface RasterFixtureOverrides {
  readonly sourceInterleave: RasterSourceInterleave | undefined;
  readonly bandLabels?: ReadonlyArray<string>;
  readonly bandWavelengths?: ReadonlyArray<number>;
}

function buildRasterFixture(overrides: RasterFixtureOverrides): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([110, 120, 130, 140, 150, 160]),
    ],
    width: 2,
    height: 3,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    sourceInterleave: overrides.sourceInterleave,
    bandLabels: overrides.bandLabels,
    bandWavelengths: overrides.bandWavelengths,
  };
}

function decodeBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function assertRastersHaveIdenticalCorePixelData(
  reloaded: RasterImage,
  original: RasterImage,
): void {
  expect(reloaded.width).toBe(original.width);
  expect(reloaded.height).toBe(original.height);
  expect(reloaded.bandCount).toBe(original.bandCount);
  expect(reloaded.bitsPerSample).toBe(original.bitsPerSample);
  expect(reloaded.sampleFormat).toBe(original.sampleFormat);
  for (let bandIndex = 0; bandIndex < original.bandCount; bandIndex++) {
    expect(Array.from(reloaded.bandPixels[bandIndex]!)).toEqual(
      Array.from(original.bandPixels[bandIndex]!),
    );
  }
}
