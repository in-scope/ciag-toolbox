import {
  INTERLACED_PNG_REFUSAL_MESSAGE,
  parseIhdrChunkData,
  startsWithPngSignature,
  type PngFileHeaderSummary,
} from "@shared/png-header";
import { reconstructScanlineBytesInPlace } from "@shared/png-scanline-filters";

import { decompressZlibBytes } from "@/lib/compression/zlib-web-streams";
import { concatenateByteArrays, listPngChunksAfterSignature } from "@/lib/masks/png-chunks";

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
  "Mask PNGs must be 8-bit. Re-export the mask as an 8-bit grayscale or indexed PNG.";

export const MASK_PNG_COLOR_TYPE_MESSAGE =
  "Mask PNGs must be grayscale or indexed. Re-export the mask without color channels.";

export const MASK_PNG_TRUNCATED_MESSAGE =
  "The mask PNG's pixel data ended before every row was decoded.";

const PNG_COLOR_TYPE_GRAYSCALE = 0;
const PNG_COLOR_TYPE_INDEXED = 3;
const MASK_BYTES_PER_PIXEL = 1;

export async function decodeMaskPngBytes(fileBytes: Uint8Array): Promise<DecodedMaskPng> {
  const header = readMaskPngHeaderOrThrow(fileBytes);
  const scanlines = await decompressZlibBytes(collectIdatData(fileBytes));
  return {
    width: header.width,
    height: header.height,
    values: unfilterEveryScanlineIntoValues(scanlines, header.width, header.height),
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
  if (header.bitDepth !== 8) throw new Error(MASK_PNG_BIT_DEPTH_MESSAGE);
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

// Each PNG scanline is one filter-type byte followed by the row's samples; the
// previous RECONSTRUCTED row feeds the up/average/paeth filters.
function unfilterEveryScanlineIntoValues(
  scanlines: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  assertEveryScanlineArrived(scanlines, width, height);
  const values = new Uint8Array(width * height);
  let previousRow: Uint8Array | null = null;
  for (let row = 0; row < height; row += 1) {
    previousRow = reconstructRowAtIndex(scanlines, width, row, previousRow);
    values.set(previousRow, row * width);
  }
  return values;
}

function assertEveryScanlineArrived(
  scanlines: Uint8Array,
  width: number,
  height: number,
): void {
  if (scanlines.byteLength < height * (width + 1)) throw new Error(MASK_PNG_TRUNCATED_MESSAGE);
}

function reconstructRowAtIndex(
  scanlines: Uint8Array,
  width: number,
  row: number,
  previousRow: Uint8Array | null,
): Uint8Array {
  const rowStart = row * (width + 1);
  const reconstructed = scanlines.slice(rowStart + 1, rowStart + 1 + width);
  reconstructScanlineBytesInPlace(
    scanlines[rowStart]!,
    reconstructed,
    previousRow,
    MASK_BYTES_PER_PIXEL,
  );
  return reconstructed;
}
