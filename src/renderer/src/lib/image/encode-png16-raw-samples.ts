import type { SaveImageUploadPartPlan } from "@/lib/image/encode-saved-image";
import { allocateUint8ArrayOrThrow } from "@/lib/image/raster-allocation";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-271: the renderer side of 16-bit PNG export. The PNG itself is encoded in
// the MAIN process (png16-encode.ts, Node zlib); the renderer only streams the
// selected band's RAW samples, widened/narrowed to uint16 BY VALUE and laid out
// big-endian per the PNG spec, through the chunked save-image protocol. Each
// chunk is converted on demand, so no whole big-endian copy of the band exists.

const BYTES_PER_SIXTEEN_BIT_SAMPLE = 2;

export function clampSampleValueToUint16ByValue(value: number): number {
  if (value <= 0) return 0;
  if (value >= 65535) return 65535;
  return Math.round(value);
}

export function buildBigEndianUint16BytesForBandRange(
  band: RasterTypedArray,
  startSample: number,
  endSample: number,
): Uint8Array {
  const bytes = allocateUint8ArrayOrThrow((endSample - startSample) * BYTES_PER_SIXTEEN_BIT_SAMPLE);
  let written = 0;
  for (let index = startSample; index < endSample; index += 1) {
    const value = clampSampleValueToUint16ByValue(band[index]!);
    bytes[written] = value >>> 8;
    bytes[written + 1] = value & 0xff;
    written += BYTES_PER_SIXTEEN_BIT_SAMPLE;
  }
  return bytes;
}

export function planRasterBandAsRawPng16SampleUpload(
  raster: RasterImage,
  bandIndex: number,
): SaveImageUploadPartPlan {
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  const sampleCount = raster.width * raster.height;
  return {
    byteLength: sampleCount * BYTES_PER_SIXTEEN_BIT_SAMPLE,
    emitChunksInOrder: (maxChunkBytes, onChunk) =>
      emitBigEndianSampleChunksInOrder(band, sampleCount, maxChunkBytes, onChunk),
  };
}

async function emitBigEndianSampleChunksInOrder(
  band: RasterTypedArray,
  sampleCount: number,
  maxChunkBytes: number,
  onChunk: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const samplesPerChunk = Math.max(1, Math.floor(maxChunkBytes / BYTES_PER_SIXTEEN_BIT_SAMPLE));
  for (let start = 0; start < sampleCount; start += samplesPerChunk) {
    await onChunk(buildBigEndianUint16BytesForBandRange(band, start, Math.min(start + samplesPerChunk, sampleCount)));
  }
}
