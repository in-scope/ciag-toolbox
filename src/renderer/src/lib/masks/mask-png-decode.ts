import {
  INTERLACED_PNG_REFUSAL_MESSAGE,
  parseIhdrChunkData,
  startsWithPngSignature,
  type PngFileHeaderSummary,
} from "@shared/png-header";
import { reconstructScanlineBytesInPlace } from "@shared/png-scanline-filters";

import { concatenateByteArrays } from "@/lib/bytes/concatenate-byte-arrays";
import { decompressZlibBytes } from "@/lib/compression/zlib-web-streams";
import { listPngChunksAfterSignature } from "@/lib/masks/png-chunks";

// CT-303: reads an imported mask PNG back to the category indexes it stores.
// Grayscale samples ARE the indexes; an INDEXED (palette) PNG stores the same
// indexes and its palette is deliberately ignored, so a mask written by PIL in
// either "L" or "P" mode imports with the same values. Anything else refuses
// rather than guessing which channel carried the labels.

export interface DecodedMaskPng {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
}

export const MASK_PNG_NOT_A_PNG_MESSAGE =
  "That file is not a PNG image. Choose a PNG mask file.";

export const MASK_PNG_BIT_DEPTH_MESSAGE =
  "Mask PNGs must be 1-, 2-, 4- or 8-bit. Re-export the mask as a grayscale or indexed PNG.";

export const MASK_PNG_COLOR_TYPE_MESSAGE =
  "Mask PNGs must be grayscale or indexed. Re-export the mask without color channels.";

export const MASK_PNG_TRUNCATED_MESSAGE =
  "The mask PNG's pixel data ended before every row was decoded.";

const PNG_COLOR_TYPE_GRAYSCALE = 0;
const PNG_COLOR_TYPE_INDEXED = 3;
const MASK_BYTES_PER_PIXEL = 1;
const VALID_MASK_PNG_BIT_DEPTHS = [1, 2, 4, 8];

export async function decodeMaskPngBytes(fileBytes: Uint8Array): Promise<DecodedMaskPng> {
  const header = readMaskPngHeaderOrThrow(fileBytes);
  const scanlines = await decompressZlibBytes(collectIdatData(fileBytes));
  return {
    width: header.width,
    height: header.height,
    values: unfilterEveryScanlineIntoValues(
      scanlines,
      header.width,
      header.height,
      header.bitDepth,
    ),
  };
}

function readMaskPngHeaderOrThrow(fileBytes: Uint8Array): PngFileHeaderSummary {
  if (!startsWithPngSignature(fileBytes)) throw new Error(MASK_PNG_NOT_A_PNG_MESSAGE);
  const header = parseIhdrChunkData(findChunkDataOrThrow(fileBytes, "IHDR"));
  assertMaskPngHeaderIsDecodable(header);
  return header;
}

function assertMaskPngHeaderIsDecodable(header: PngFileHeaderSummary): void {
  if (header.interlaceMethod !== 0) throw new Error(INTERLACED_PNG_REFUSAL_MESSAGE);
  if (!VALID_MASK_PNG_BIT_DEPTHS.includes(header.bitDepth)) {
    throw new Error(MASK_PNG_BIT_DEPTH_MESSAGE);
  }
  if (!isGrayscaleOrIndexedColorType(header.colorType)) {
    throw new Error(MASK_PNG_COLOR_TYPE_MESSAGE);
  }
  if (header.width <= 0 || header.height <= 0) throw new Error(MASK_PNG_TRUNCATED_MESSAGE);
}

function isGrayscaleOrIndexedColorType(colorType: number): boolean {
  return colorType === PNG_COLOR_TYPE_GRAYSCALE || colorType === PNG_COLOR_TYPE_INDEXED;
}

function findChunkDataOrThrow(fileBytes: Uint8Array, chunkType: string): Uint8Array {
  const found = listPngChunksAfterSignature(fileBytes).find(
    (chunk) => chunk.chunkType === chunkType,
  );
  if (found === undefined) throw new Error(MASK_PNG_NOT_A_PNG_MESSAGE);
  return found.data;
}

function collectIdatData(fileBytes: Uint8Array): Uint8Array {
  const parts = listPngChunksAfterSignature(fileBytes)
    .filter((chunk) => chunk.chunkType === "IDAT")
    .map((chunk) => chunk.data);
  if (parts.length === 0) throw new Error(MASK_PNG_TRUNCATED_MESSAGE);
  return concatenateByteArrays(parts);
}

// Each PNG scanline is one filter-type byte followed by the row's packed
// bytes; the previous RECONSTRUCTED row feeds the up/average/paeth filters.
// Bit depths under 8 pack several samples per byte, so the filter math (which
// always uses bytesPerPixel 1 for a sub-byte sample, per the PNG spec) works
// over ROW BYTES, and the packed row is unpacked to one value per pixel only
// after reconstruction.
function unfilterEveryScanlineIntoValues(
  scanlines: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
): Uint8Array {
  const rowByteWidth = computeRowByteWidth(width, bitDepth);
  assertEveryScanlineArrived(scanlines, rowByteWidth, height);
  const values = new Uint8Array(width * height);
  let previousRow: Uint8Array | null = null;
  for (let row = 0; row < height; row += 1) {
    previousRow = reconstructRowAtIndex(scanlines, rowByteWidth, row, previousRow);
    values.set(unpackSubByteSamples(previousRow, bitDepth, width), row * width);
  }
  return values;
}

function computeRowByteWidth(width: number, bitDepth: number): number {
  return Math.ceil((width * bitDepth) / 8);
}

// Expands one reconstructed row of PACKED bytes to one value per pixel, most
// significant bits first, ignoring any padding bits past the last pixel.
export function unpackSubByteSamples(
  rowBytes: Uint8Array,
  bitDepth: number,
  width: number,
): Uint8Array {
  if (bitDepth === 8) return rowBytes.slice(0, width);
  const samplesPerByte = 8 / bitDepth;
  const sampleMask = (1 << bitDepth) - 1;
  const values = new Uint8Array(width);
  for (let pixel = 0; pixel < width; pixel += 1) {
    const byte = rowBytes[Math.floor(pixel / samplesPerByte)]!;
    const shiftFromMsb = 8 - bitDepth * ((pixel % samplesPerByte) + 1);
    values[pixel] = (byte >> shiftFromMsb) & sampleMask;
  }
  return values;
}

function assertEveryScanlineArrived(
  scanlines: Uint8Array,
  rowByteWidth: number,
  height: number,
): void {
  if (scanlines.byteLength < height * (rowByteWidth + 1)) {
    throw new Error(MASK_PNG_TRUNCATED_MESSAGE);
  }
}

function reconstructRowAtIndex(
  scanlines: Uint8Array,
  rowByteWidth: number,
  row: number,
  previousRow: Uint8Array | null,
): Uint8Array {
  const rowStart = row * (rowByteWidth + 1);
  const reconstructed = scanlines.slice(rowStart + 1, rowStart + 1 + rowByteWidth);
  reconstructScanlineBytesInPlace(
    scanlines[rowStart]!,
    reconstructed,
    previousRow,
    MASK_BYTES_PER_PIXEL,
  );
  return reconstructed;
}
