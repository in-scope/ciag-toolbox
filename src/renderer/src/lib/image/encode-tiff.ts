import { writeArrayBuffer } from "geotiff";

import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";

export type TargetBitDepth = 8 | 16;

const TIFF_PHOTOMETRIC_BLACK_IS_ZERO = 1;
const TIFF_PHOTOMETRIC_RGB = 2;
const TIFF_SAMPLE_FORMAT_UINT = 1;

interface TiffWriteMetadata {
  width: number;
  height: number;
  BitsPerSample: number[];
  SampleFormat: number[];
  SamplesPerPixel: number;
  PhotometricInterpretation: number;
  ImageLength: number;
  ImageWidth: number;
}

export function encodeRasterBandAsSingleChannelTiffBytes(
  raster: RasterImage,
  bandIndex: number,
  targetBitDepth: TargetBitDepth,
): Uint8Array {
  const sourcePixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const targetPixels = convertSourcePixelsToTargetBitDepth(
    sourcePixels,
    raster.bitsPerSample,
    targetBitDepth,
  );
  const metadata = buildSingleBandTiffMetadata(raster.width, raster.height, targetBitDepth);
  return convertArrayBufferToBytes(writeArrayBuffer(targetPixels, metadata));
}

export function encodeRgbaBytesAsRgbTiffBytes(
  rgbaBytes: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  targetBitDepth: TargetBitDepth,
): Uint8Array {
  const rgbPixels = convertRgbaBytesToRgbAtTargetBitDepth(rgbaBytes, targetBitDepth);
  const metadata = buildRgbTiffMetadata(width, height, targetBitDepth);
  return convertArrayBufferToBytes(writeArrayBuffer(rgbPixels, metadata));
}

function convertSourcePixelsToTargetBitDepth(
  pixels: ArrayLike<number>,
  sourceBitsPerSample: number,
  targetBitDepth: TargetBitDepth,
): Uint8Array | Uint16Array {
  const scaleFactor = computeBitDepthScaleFactor(sourceBitsPerSample, targetBitDepth);
  if (targetBitDepth === 8) {
    return rescalePixelsToUint8(pixels, scaleFactor);
  }
  return rescalePixelsToUint16(pixels, scaleFactor);
}

function computeBitDepthScaleFactor(
  sourceBitsPerSample: number,
  targetBitDepth: TargetBitDepth,
): number {
  const sourceMax = Math.pow(2, sourceBitsPerSample) - 1;
  const targetMax = Math.pow(2, targetBitDepth) - 1;
  if (sourceMax <= 0) return 1;
  return targetMax / sourceMax;
}

function rescalePixelsToUint8(pixels: ArrayLike<number>, scaleFactor: number): Uint8Array {
  const output = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) {
    output[i] = clampToUint8Range((pixels[i] ?? 0) * scaleFactor);
  }
  return output;
}

function rescalePixelsToUint16(pixels: ArrayLike<number>, scaleFactor: number): Uint16Array {
  const output = new Uint16Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) {
    output[i] = clampToUint16Range((pixels[i] ?? 0) * scaleFactor);
  }
  return output;
}

function clampToUint8Range(value: number): number {
  if (value <= 0) return 0;
  if (value >= 0xff) return 0xff;
  return Math.round(value);
}

function clampToUint16Range(value: number): number {
  if (value <= 0) return 0;
  if (value >= 0xffff) return 0xffff;
  return Math.round(value);
}

function convertRgbaBytesToRgbAtTargetBitDepth(
  rgba: Uint8Array | Uint8ClampedArray,
  targetBitDepth: TargetBitDepth,
): Uint8Array | Uint16Array {
  const pixelCount = rgba.length / 4;
  if (targetBitDepth === 8) return convertRgbaBytesToRgbUint8(rgba, pixelCount);
  return convertRgbaBytesToRgbUint16(rgba, pixelCount);
}

function convertRgbaBytesToRgbUint8(
  rgba: Uint8Array | Uint8ClampedArray,
  pixelCount: number,
): Uint8Array {
  const output = new Uint8Array(pixelCount * 3);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    output[pixelIndex * 3 + 0] = rgba[pixelIndex * 4 + 0] ?? 0;
    output[pixelIndex * 3 + 1] = rgba[pixelIndex * 4 + 1] ?? 0;
    output[pixelIndex * 3 + 2] = rgba[pixelIndex * 4 + 2] ?? 0;
  }
  return output;
}

function convertRgbaBytesToRgbUint16(
  rgba: Uint8Array | Uint8ClampedArray,
  pixelCount: number,
): Uint16Array {
  const output = new Uint16Array(pixelCount * 3);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    output[pixelIndex * 3 + 0] = scaleByteValueToUint16(rgba[pixelIndex * 4 + 0] ?? 0);
    output[pixelIndex * 3 + 1] = scaleByteValueToUint16(rgba[pixelIndex * 4 + 1] ?? 0);
    output[pixelIndex * 3 + 2] = scaleByteValueToUint16(rgba[pixelIndex * 4 + 2] ?? 0);
  }
  return output;
}

function scaleByteValueToUint16(byteValue: number): number {
  return Math.round((byteValue / 0xff) * 0xffff);
}

function buildSingleBandTiffMetadata(
  width: number,
  height: number,
  targetBitDepth: TargetBitDepth,
): TiffWriteMetadata {
  return {
    width,
    height,
    ImageWidth: width,
    ImageLength: height,
    BitsPerSample: [targetBitDepth],
    SampleFormat: [TIFF_SAMPLE_FORMAT_UINT],
    SamplesPerPixel: 1,
    PhotometricInterpretation: TIFF_PHOTOMETRIC_BLACK_IS_ZERO,
  };
}

function buildRgbTiffMetadata(
  width: number,
  height: number,
  targetBitDepth: TargetBitDepth,
): TiffWriteMetadata {
  return {
    width,
    height,
    ImageWidth: width,
    ImageLength: height,
    BitsPerSample: [targetBitDepth, targetBitDepth, targetBitDepth],
    SampleFormat: [TIFF_SAMPLE_FORMAT_UINT, TIFF_SAMPLE_FORMAT_UINT, TIFF_SAMPLE_FORMAT_UINT],
    SamplesPerPixel: 3,
    PhotometricInterpretation: TIFF_PHOTOMETRIC_RGB,
  };
}

function convertArrayBufferToBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}
