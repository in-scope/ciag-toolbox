import { writeArrayBuffer } from "geotiff";

import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterSampleFormat,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import { buildRgbaBytesFromRgbRaster } from "@/lib/image/rgb-raster-to-rgba";
import {
  runInChunksReportingProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

export type TargetBitDepth = 8 | 16;

// CT-219f: samples written per main-thread slice in the chunked encoders; ~8M big-endian
// sample writes cost tens of milliseconds, so the busy bar paints between chunks.
const DEFAULT_TIFF_SAMPLES_PER_CHUNK = 8_000_000;

const TIFF_PHOTOMETRIC_BLACK_IS_ZERO = 1;
const TIFF_PHOTOMETRIC_RGB = 2;
const TIFF_SAMPLE_FORMAT_UINT = 1;
const TIFF_SAMPLE_FORMAT_FLOAT = 3;
const FLOAT_BITS_PER_SAMPLE = 32;

// CT-196: scientific integer data never fills more than a 16-bit container in this app, so a
// wider integer container (e.g. a uint32 TIFF holding 12-bit-packed, bit-shifted values) is
// treated as 16-bit when computing the export rescale. Scaling such a band by its true 2^32
// type range collapsed every real value into the 0..1 band, where rounding produced a constant
// output of 1. Capping at 16 makes a 16-bit save of a >=16-bit integer container a value-preserving
// pass-through (scale 1) instead.
const MAX_SCIENTIFIC_INTEGER_CONTAINER_BITS = 16;
const BITS_PER_BYTE = 8;

interface TiffWriteMetadata {
  width: number;
  height: number;
  BitsPerSample: number[];
  SampleFormat: number[];
  SamplesPerPixel: number;
  PhotometricInterpretation: number;
  ImageLength: number;
  ImageWidth: number;
  StripByteCounts?: number[];
}

export function encodeRasterBandAsSingleChannelTiffBytes(
  raster: RasterImage,
  bandIndex: number,
  targetBitDepth: TargetBitDepth,
): Uint8Array {
  const sourcePixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const targetPixels = convertSourcePixelsToTargetBitDepth(
    sourcePixels,
    raster.sampleFormat,
    targetBitDepth,
  );
  const metadata = buildSingleBandTiffMetadata(raster.width, raster.height, targetBitDepth);
  return convertArrayBufferToBytes(writeArrayBuffer(targetPixels, metadata));
}

export function encodeRasterBandAsFloat32TiffBytes(
  raster: RasterImage,
  bandIndex: number,
): Uint8Array {
  const sourcePixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const targetPixels = copySourcePixelsToFloat32(sourcePixels);
  const metadata = buildSingleBandFloat32TiffMetadata(raster.width, raster.height);
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

// CT-173: a true-colour raster (a promoted photo) writes a 3-sample RGB TIFF carrying
// PhotometricInterpretation RGB, so it reopens (CT-160) as a colour composite, not a grey band.
export function encodeRgbRasterAsRgbTiffBytes(
  raster: RasterImage,
  targetBitDepth: TargetBitDepth,
): Uint8Array {
  const rgba = buildRgbaBytesFromRgbRaster(raster);
  return encodeRgbaBytesAsRgbTiffBytes(rgba, raster.width, raster.height, targetBitDepth);
}

// CT-219f: async twins of the encoders above. Byte-identical output (equivalence-tested),
// but the sample section is written in chunks with paint yields so a reference-scale band
// no longer freezes the renderer for the whole encode.
export async function encodeRasterBandAsSingleChannelTiffBytesReportingProgress(
  raster: RasterImage,
  bandIndex: number,
  targetBitDepth: TargetBitDepth,
  onProgress?: UnitProgressCallback,
  samplesPerChunk: number = DEFAULT_TIFF_SAMPLES_PER_CHUNK,
): Promise<Uint8Array> {
  const sourcePixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const targetPixels = convertSourcePixelsToTargetBitDepth(
    sourcePixels,
    raster.sampleFormat,
    targetBitDepth,
  );
  const metadata = buildSingleBandTiffMetadata(raster.width, raster.height, targetBitDepth);
  return writeTiffSamplesInChunksReportingProgress(targetPixels, metadata, onProgress, samplesPerChunk);
}

export async function encodeRasterBandAsFloat32TiffBytesReportingProgress(
  raster: RasterImage,
  bandIndex: number,
  onProgress?: UnitProgressCallback,
  samplesPerChunk: number = DEFAULT_TIFF_SAMPLES_PER_CHUNK,
): Promise<Uint8Array> {
  const sourcePixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const targetPixels = copySourcePixelsToFloat32(sourcePixels);
  const metadata = buildSingleBandFloat32TiffMetadata(raster.width, raster.height);
  return writeTiffSamplesInChunksReportingProgress(targetPixels, metadata, onProgress, samplesPerChunk);
}

export async function encodeRgbaBytesAsRgbTiffBytesReportingProgress(
  rgbaBytes: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  targetBitDepth: TargetBitDepth,
  onProgress?: UnitProgressCallback,
  samplesPerChunk: number = DEFAULT_TIFF_SAMPLES_PER_CHUNK,
): Promise<Uint8Array> {
  const rgbPixels = convertRgbaBytesToRgbAtTargetBitDepth(rgbaBytes, targetBitDepth);
  const metadata = buildRgbTiffMetadata(width, height, targetBitDepth);
  return writeTiffSamplesInChunksReportingProgress(rgbPixels, metadata, onProgress, samplesPerChunk);
}

export async function encodeRgbRasterAsRgbTiffBytesReportingProgress(
  raster: RasterImage,
  targetBitDepth: TargetBitDepth,
  onProgress?: UnitProgressCallback,
  samplesPerChunk: number = DEFAULT_TIFF_SAMPLES_PER_CHUNK,
): Promise<Uint8Array> {
  const rgba = buildRgbaBytesFromRgbRaster(raster);
  return encodeRgbaBytesAsRgbTiffBytesReportingProgress(
    rgba,
    raster.width,
    raster.height,
    targetBitDepth,
    onProgress,
    samplesPerChunk,
  );
}

type TiffSampleArray = Uint8Array | Uint16Array | Float32Array;

async function writeTiffSamplesInChunksReportingProgress(
  samples: TiffSampleArray,
  metadata: TiffWriteMetadata,
  onProgress: UnitProgressCallback | undefined,
  samplesPerChunk: number,
): Promise<Uint8Array> {
  const headerBytes = buildTiffHeaderBytesMatchingWriteArrayBuffer(samples, metadata);
  const output = new Uint8Array(headerBytes.length + samples.length * samples.BYTES_PER_ELEMENT);
  output.set(headerBytes);
  const writeChunk = pickBigEndianSampleChunkWriter(samples, output, headerBytes.length);
  await runInChunksReportingProgress(samples.length, samplesPerChunk, writeChunk, onProgress);
  return output;
}

// geotiff's writeArrayBuffer allocates a fresh ArrayBuffer + DataView PER SAMPLE, which
// costs ~14 s for a 48 MP band (CT-219f). Its IFD block depends only on the metadata once
// StripByteCounts is pinned to the real sample byte length (the value geotiff would derive
// itself), so a one-sample write yields the exact header and the sample section is filled
// here big-endian, exactly as geotiff's encodeImage would have written it.
function buildTiffHeaderBytesMatchingWriteArrayBuffer(
  samples: TiffSampleArray,
  metadata: TiffWriteMetadata,
): Uint8Array {
  const elementSize = samples.BYTES_PER_ELEMENT;
  const headerMetadata: TiffWriteMetadata = {
    ...metadata,
    StripByteCounts: [samples.length * elementSize],
  };
  const headerBuffer = writeArrayBuffer(buildOneSampleDummyMatchingType(samples), headerMetadata);
  return new Uint8Array(headerBuffer, 0, headerBuffer.byteLength - elementSize);
}

function buildOneSampleDummyMatchingType(samples: TiffSampleArray): TiffSampleArray {
  if (samples instanceof Uint16Array) return new Uint16Array(1);
  if (samples instanceof Float32Array) return new Float32Array(1);
  return new Uint8Array(1);
}

type SampleChunkWriter = (startSample: number, endSample: number) => void;

function pickBigEndianSampleChunkWriter(
  samples: TiffSampleArray,
  output: Uint8Array,
  sampleSectionOffset: number,
): SampleChunkWriter {
  if (samples instanceof Uint16Array) {
    return buildUint16BigEndianChunkWriter(samples, output, sampleSectionOffset);
  }
  if (samples instanceof Float32Array) {
    return buildFloat32BigEndianChunkWriter(samples, output, sampleSectionOffset);
  }
  return (start, end) => output.set(samples.subarray(start, end), sampleSectionOffset + start);
}

function buildUint16BigEndianChunkWriter(
  samples: Uint16Array,
  output: Uint8Array,
  sampleSectionOffset: number,
): SampleChunkWriter {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  return (start, end) => {
    for (let i = start; i < end; i += 1) {
      view.setUint16(sampleSectionOffset + i * 2, samples[i] ?? 0, false);
    }
  };
}

function buildFloat32BigEndianChunkWriter(
  samples: Float32Array,
  output: Uint8Array,
  sampleSectionOffset: number,
): SampleChunkWriter {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  return (start, end) => {
    for (let i = start; i < end; i += 1) {
      view.setFloat32(sampleSectionOffset + i * 4, samples[i] ?? 0, false);
    }
  };
}

function convertSourcePixelsToTargetBitDepth(
  pixels: RasterTypedArray,
  sourceSampleFormat: RasterSampleFormat,
  targetBitDepth: TargetBitDepth,
): Uint8Array | Uint16Array {
  const scaleFactor = computeBitDepthScaleFactor(
    sourceSampleFormat,
    readEffectiveIntegerContainerBits(pixels),
    targetBitDepth,
  );
  if (targetBitDepth === 8) {
    return rescalePixelsToUint8(pixels, scaleFactor);
  }
  return rescalePixelsToUint16(pixels, scaleFactor);
}

function readEffectiveIntegerContainerBits(pixels: RasterTypedArray): number {
  const containerBits = pixels.BYTES_PER_ELEMENT * BITS_PER_BYTE;
  return Math.min(containerBits, MAX_SCIENTIFIC_INTEGER_CONTAINER_BITS);
}

function computeBitDepthScaleFactor(
  sourceSampleFormat: RasterSampleFormat,
  sourceContainerBits: number,
  targetBitDepth: TargetBitDepth,
): number {
  const targetMax = Math.pow(2, targetBitDepth) - 1;
  if (sourceSampleFormat === "float") return targetMax;
  const sourceMax = Math.pow(2, sourceContainerBits) - 1;
  if (sourceMax <= 0) return 1;
  return targetMax / sourceMax;
}

function copySourcePixelsToFloat32(pixels: ArrayLike<number>): Float32Array {
  const output = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 1) {
    output[i] = pixels[i] ?? 0;
  }
  return output;
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

function buildSingleBandFloat32TiffMetadata(
  width: number,
  height: number,
): TiffWriteMetadata {
  return {
    width,
    height,
    ImageWidth: width,
    ImageLength: height,
    BitsPerSample: [FLOAT_BITS_PER_SAMPLE],
    SampleFormat: [TIFF_SAMPLE_FORMAT_FLOAT],
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
