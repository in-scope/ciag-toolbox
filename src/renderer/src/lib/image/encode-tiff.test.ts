import { fromArrayBuffer } from "geotiff";
import { describe, expect, it } from "vitest";

import {
  encodeRasterBandAsSingleChannelTiffBytes,
  encodeRgbaBytesAsRgbTiffBytes,
} from "@/lib/image/encode-tiff";
import type { RasterImage } from "@/lib/image/raster-image";

describe("encodeRasterBandAsSingleChannelTiffBytes", () => {
  it("round-trips a uint16 raster band as a 16-bit TIFF preserving values", async () => {
    const raster = buildSingleBandUint16Raster([0, 1024, 32768, 65535]);
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 16);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(Array.from(decoded)).toEqual([0, 1024, 32768, 65535]);
  });

  it("downsamples 16-bit values to 8-bit when the chosen bit depth is 8", async () => {
    const raster = buildSingleBandUint16Raster([0, 32768, 65535, 16384]);
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 8);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([0, 128, 255, 64]);
  });

  it("upsamples 8-bit values to 16-bit when the chosen bit depth is 16", async () => {
    const raster = buildSingleBandUint8Raster([0, 128, 255]);
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 16);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(decoded).toBeInstanceOf(Uint16Array);
    expect(Array.from(decoded)).toEqual([0, 32896, 65535]);
  });

  it("encodes the chosen band only when the raster has multiple bands", async () => {
    const raster: RasterImage = {
      width: 2,
      height: 1,
      bitsPerSample: 8,
      sampleFormat: "uint",
      bandCount: 2,
      bandPixels: [Uint8Array.from([10, 20]), Uint8Array.from([200, 201])],
    };
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 1, 8);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(Array.from(decoded)).toEqual([200, 201]);
  });
});

describe("encodeRgbaBytesAsRgbTiffBytes", () => {
  it("strips alpha and writes 8-bit RGB values directly when the chosen bit depth is 8", async () => {
    const rgba = Uint8Array.from([255, 128, 0, 255, 0, 64, 192, 255]);
    const tiffBytes = encodeRgbaBytesAsRgbTiffBytes(rgba, 2, 1, 8);
    const samples = await decodeRgbTiffBytesAsInterleavedTypedArray(tiffBytes);
    expect(Array.from(samples)).toEqual([255, 128, 0, 0, 64, 192]);
  });

  it("scales 8-bit RGB up to 16-bit when the chosen bit depth is 16", async () => {
    const rgba = Uint8ClampedArray.from([0, 128, 255, 255]);
    const tiffBytes = encodeRgbaBytesAsRgbTiffBytes(rgba, 1, 1, 16);
    const samples = await decodeRgbTiffBytesAsInterleavedTypedArray(tiffBytes);
    expect(samples).toBeInstanceOf(Uint16Array);
    expect(Array.from(samples)).toEqual([0, 32896, 65535]);
  });
});

function buildSingleBandUint16Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    width: values.length,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
    bandPixels: [Uint16Array.from(values)],
  };
}

function buildSingleBandUint8Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    width: values.length,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 1,
    bandPixels: [Uint8Array.from(values)],
  };
}

async function decodeSingleBandTiffBytesAsTypedArray(
  bytes: Uint8Array,
): Promise<Uint8Array | Uint16Array> {
  const buffer = bytes.slice().buffer;
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage(0);
  const rasters = (await image.readRasters({ interleave: false })) as ReadonlyArray<
    Uint8Array | Uint16Array
  >;
  return rasters[0]!;
}

async function decodeRgbTiffBytesAsInterleavedTypedArray(
  bytes: Uint8Array,
): Promise<Uint8Array | Uint16Array> {
  const buffer = bytes.slice().buffer;
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage(0);
  const rasters = (await image.readRasters({ interleave: true })) as Uint8Array | Uint16Array;
  return rasters;
}
