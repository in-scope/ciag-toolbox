import { fromArrayBuffer } from "geotiff";
import { describe, expect, it } from "vitest";

import {
  encodeRasterBandAsFloat32TiffBytes,
  encodeRasterBandAsSingleChannelTiffBytes,
  encodeRgbaBytesAsRgbTiffBytes,
  encodeRgbRasterAsRgbTiffBytes,
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

  it("maps a float32 [0,1] band to non-zero uint16 samples (CT-102 reproduction)", async () => {
    const raster = buildSingleBandFloat32Raster([0, 0.5, 1]);
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 16);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(Array.from(decoded)).toEqual([0, 32768, 65535]);
  });

  it("maps a float32 [0,1] band to non-zero uint8 samples", async () => {
    const raster = buildSingleBandFloat32Raster([0, 0.5, 1]);
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 8);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(Array.from(decoded)).toEqual([0, 128, 255]);
  });

  it("clips out-of-range float values when exporting to uint16 (lossy path)", async () => {
    const raster = buildSingleBandFloat32Raster([-0.5, 0, 1, 1.5]);
    const tiffBytes = encodeRasterBandAsSingleChannelTiffBytes(raster, 0, 16);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(Array.from(decoded)).toEqual([0, 0, 65535, 65535]);
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

describe("encodeRasterBandAsFloat32TiffBytes", () => {
  it("round-trips a float32 band including out-of-range values losslessly", async () => {
    const raster = buildSingleBandFloat32Raster([-1.5, 0, 0.25, 2.75]);
    const tiffBytes = encodeRasterBandAsFloat32TiffBytes(raster, 0);
    const decoded = await decodeSingleBandTiffBytesAsTypedArray(tiffBytes);
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded)).toEqual([-1.5, 0, 0.25, 2.75]);
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

describe("encodeRgbRasterAsRgbTiffBytes", () => {
  // CT-173: a promoted colour photo (3 uint8 bands tagged "rgb") must export as a 3-sample RGB
  // TIFF so it reopens in colour, not as the single grey band a scientific stack would write.
  it("interleaves the three bands into an 8-bit RGB TIFF", async () => {
    const raster = buildThreeBandRgbUint8Raster([200, 10], [100, 20], [50, 30]);
    const tiffBytes = encodeRgbRasterAsRgbTiffBytes(raster, 8);
    const samples = await decodeRgbTiffBytesAsInterleavedTypedArray(tiffBytes);
    expect(Array.from(samples)).toEqual([200, 100, 50, 10, 20, 30]);
  });

  it("scales the bands up to 16-bit when the chosen bit depth is 16", async () => {
    const raster = buildThreeBandRgbUint8Raster([0], [128], [255]);
    const tiffBytes = encodeRgbRasterAsRgbTiffBytes(raster, 16);
    const samples = await decodeRgbTiffBytesAsInterleavedTypedArray(tiffBytes);
    expect(samples).toBeInstanceOf(Uint16Array);
    expect(Array.from(samples)).toEqual([0, 32896, 65535]);
  });
});

function buildThreeBandRgbUint8Raster(
  red: ReadonlyArray<number>,
  green: ReadonlyArray<number>,
  blue: ReadonlyArray<number>,
): RasterImage {
  return {
    width: red.length,
    height: 1,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    bandPixels: [Uint8Array.from(red), Uint8Array.from(green), Uint8Array.from(blue)],
    colorInterpretation: "rgb",
  };
}

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

function buildSingleBandFloat32Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    width: values.length,
    height: 1,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: 1,
    bandPixels: [Float32Array.from(values)],
  };
}

async function decodeSingleBandTiffBytesAsTypedArray(
  bytes: Uint8Array,
): Promise<Uint8Array | Uint16Array | Float32Array> {
  const buffer = bytes.slice().buffer;
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage(0);
  const rasters = (await image.readRasters({ interleave: false })) as ReadonlyArray<
    Uint8Array | Uint16Array | Float32Array
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
