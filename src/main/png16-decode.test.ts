import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  INTERLACED_PNG_REFUSAL_MESSAGE,
  PNG16_ALPHA_UNSUPPORTED_MESSAGE,
} from "../shared/png-header";
import { createStreamingPng16GrayscaleEncoder } from "./png16-encode";
import { reconstructScanlineBytesInPlace } from "../shared/png-scanline-filters";
import { createStreamingPng16Decoder } from "./png16-decode";

// CT-272 round-trip oracles: (1) the CT-271 encoder (filter 0), (2) hand-built
// PNGs whose scanlines are filtered with a verbatim reference implementation of
// each of the five PNG filter functions, and (3) the committed
// e2e/fixtures/gradient-gray16.png written by sharp/libvips (an external
// reference encoder with adaptive filtering). Every decode must return the
// original uint16 samples EXACTLY.

async function decodeWholePngFeedingSlices(
  pngBytes: Uint8Array,
  sliceBytes: number,
): Promise<{ width: number; height: number; channelCount: number; samples: number[] }> {
  const decoder = createStreamingPng16Decoder();
  const pieces: Uint8Array[] = [];
  for (let offset = 0; offset < pngBytes.length; offset += sliceBytes) {
    await decoder.consumeFileBytes(pngBytes.subarray(offset, Math.min(offset + sliceBytes, pngBytes.length)));
    pieces.push(...decoder.takePendingDecodedBytes());
  }
  await decoder.finishAssertingEveryRowDecoded();
  pieces.push(...decoder.takePendingDecodedBytes());
  return { ...decoder.headerOrNull()!, samples: parseBigEndianSamples(pieces) };
}

function parseBigEndianSamples(pieces: ReadonlyArray<Uint8Array>): number[] {
  const joined = concatBytes(pieces);
  const samples: number[] = [];
  for (let index = 0; index + 1 < joined.length; index += 2) {
    samples.push((joined[index]! << 8) | joined[index + 1]!);
  }
  return samples;
}

function concatBytes(pieces: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0));
  let offset = 0;
  for (const piece of pieces) {
    joined.set(piece, offset);
    offset += piece.byteLength;
  }
  return joined;
}

function buildBigEndianBytesFromSamples(samples: ReadonlyArray<number>): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  samples.forEach((value, index) => {
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

async function encodeWithCt271Encoder(
  samples: ReadonlyArray<number>,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const blocks: Uint8Array[] = [];
  const encoder = createStreamingPng16GrayscaleEncoder({ width, height }, async (bytes) => {
    blocks.push(bytes.slice());
  });
  await encoder.consumeRawBigEndianSampleBytes(buildBigEndianBytesFromSamples(samples));
  await encoder.finishWritingPngTrailer();
  return concatBytes(blocks);
}

// --- Hand-built PNGs with a chosen filter type per scanline ------------------

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface HandBuiltPngShape {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly bitDepth?: number;
  readonly interlaceMethod?: number;
}

function buildPngChunkBytes(chunkType: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(chunkType, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(data, crc32(typeBytes)));
  return chunk;
}

function buildIhdrChunkData(shape: HandBuiltPngShape): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, shape.width);
  view.setUint32(4, shape.height);
  data[8] = shape.bitDepth ?? 16;
  data[9] = shape.colorType;
  data[12] = shape.interlaceMethod ?? 0;
  return data;
}

function buildHandFilteredPng(
  shape: HandBuiltPngShape,
  samples: ReadonlyArray<number>,
  filterTypePerRow: (rowIndex: number) => number,
): Uint8Array {
  const channelCount = shape.colorType === 2 ? 3 : 1;
  const bytesPerPixel = channelCount * 2;
  const rowByteLength = shape.width * bytesPerPixel;
  const raw = buildBigEndianBytesFromSamples(samples);
  const filtered = filterEveryScanline(raw, shape.height, rowByteLength, bytesPerPixel, filterTypePerRow);
  return concatBytes([
    PNG_SIGNATURE,
    buildPngChunkBytes("IHDR", buildIhdrChunkData(shape)),
    buildPngChunkBytes("IDAT", deflateSync(filtered)),
    buildPngChunkBytes("IEND", new Uint8Array(0)),
  ]);
}

function filterEveryScanline(
  raw: Uint8Array,
  height: number,
  rowByteLength: number,
  bytesPerPixel: number,
  filterTypePerRow: (rowIndex: number) => number,
): Uint8Array {
  const filtered = new Uint8Array(height * (1 + rowByteLength));
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const row = raw.subarray(rowIndex * rowByteLength, (rowIndex + 1) * rowByteLength);
    const previousRow = rowIndex === 0 ? null : raw.subarray((rowIndex - 1) * rowByteLength, rowIndex * rowByteLength);
    const filterType = filterTypePerRow(rowIndex);
    filtered[rowIndex * (1 + rowByteLength)] = filterType;
    filtered.set(
      applyReferenceFilterToScanline(filterType, row, previousRow, bytesPerPixel),
      rowIndex * (1 + rowByteLength) + 1,
    );
  }
  return filtered;
}

// A verbatim implementation of the PNG spec's FILTER functions (the forward
// direction, spec 4.5) - deliberately independent of the decoder's
// reconstruction code so a shared bug cannot cancel itself out.
function applyReferenceFilterToScanline(
  filterType: number,
  row: Uint8Array,
  previousRow: Uint8Array | null,
  bytesPerPixel: number,
): Uint8Array {
  const filtered = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
    const above = previousRow === null ? 0 : previousRow[index]!;
    const upperLeft = previousRow !== null && index >= bytesPerPixel ? previousRow[index - bytesPerPixel]! : 0;
    filtered[index] = (row[index]! - referenceFilterPrediction(filterType, left, above, upperLeft)) & 0xff;
  }
  return filtered;
}

function referenceFilterPrediction(
  filterType: number,
  left: number,
  above: number,
  upperLeft: number,
): number {
  if (filterType === 0) return 0;
  if (filterType === 1) return left;
  if (filterType === 2) return above;
  if (filterType === 3) return (left + above) >> 1;
  return referencePaethPredictor(left, above, upperLeft);
}

function referencePaethPredictor(left: number, above: number, upperLeft: number): number {
  const initial = left + above - upperLeft;
  const distanceLeft = Math.abs(initial - left);
  const distanceAbove = Math.abs(initial - above);
  const distanceUpperLeft = Math.abs(initial - upperLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft) return left;
  if (distanceAbove <= distanceUpperLeft) return above;
  return upperLeft;
}

const GRAY_SAMPLES_5X3 = [
  0, 1, 255, 256, 800,
  4095, 12345, 30000, 65534, 65535,
  100, 250, 950, 1750, 32768,
];

const RGB_SAMPLES_3X2 = [
  300, 40000, 7, 65535, 0, 511, 1024, 2048, 4096,
  12345, 54321, 500, 260, 270, 280, 30000, 20000, 10000,
];

describe("createStreamingPng16Decoder", () => {
  it("round-trips the CT-271 encoder's output exactly", async () => {
    const pngBytes = await encodeWithCt271Encoder(GRAY_SAMPLES_5X3, 5, 3);
    const decoded = await decodeWholePngFeedingSlices(pngBytes, pngBytes.length);
    expect(decoded).toEqual({ width: 5, height: 3, channelCount: 1, samples: GRAY_SAMPLES_5X3 });
  });

  it("decodes identically when file bytes arrive in slices splitting chunks and samples", async () => {
    const pngBytes = await encodeWithCt271Encoder(GRAY_SAMPLES_5X3, 5, 3);
    for (const sliceBytes of [1, 7, 13]) {
      const decoded = await decodeWholePngFeedingSlices(pngBytes, sliceBytes);
      expect(decoded.samples).toEqual(GRAY_SAMPLES_5X3);
    }
  });

  for (const filterType of [0, 1, 2, 3, 4]) {
    it(`reconstructs grayscale scanlines filtered with type ${filterType}`, async () => {
      const pngBytes = buildHandFilteredPng(
        { width: 5, height: 3, colorType: 0 },
        GRAY_SAMPLES_5X3,
        () => filterType,
      );
      const decoded = await decodeWholePngFeedingSlices(pngBytes, 7);
      expect(decoded).toEqual({ width: 5, height: 3, channelCount: 1, samples: GRAY_SAMPLES_5X3 });
    });
  }

  it("reconstructs a mix of filter types across the rows of one image", async () => {
    const samples = Array.from({ length: 5 * 5 }, (_, index) => (index * 2654) % 65536);
    const pngBytes = buildHandFilteredPng(
      { width: 5, height: 5, colorType: 0 },
      samples,
      (rowIndex) => rowIndex,
    );
    const decoded = await decodeWholePngFeedingSlices(pngBytes, 11);
    expect(decoded.samples).toEqual(samples);
  });

  it("decodes 16-bit color scanlines as three interleaved channels under every filter", async () => {
    for (const filterType of [0, 1, 2, 3, 4]) {
      const pngBytes = buildHandFilteredPng(
        { width: 3, height: 2, colorType: 2 },
        RGB_SAMPLES_3X2,
        () => filterType,
      );
      const decoded = await decodeWholePngFeedingSlices(pngBytes, 7);
      expect(decoded).toEqual({ width: 3, height: 2, channelCount: 3, samples: RGB_SAMPLES_3X2 });
    }
  });

  it("decodes the committed reference-tool fixture exactly as sharp reads it", async () => {
    const pngBytes = readFileSync(join(__dirname, "../../e2e/fixtures/gradient-gray16.png"));
    const decoded = await decodeWholePngFeedingSlices(pngBytes, 17);
    const expected = Array.from({ length: 6 * 4 }, (_, index) => 300 + index * 500);
    expect(decoded).toEqual({ width: 6, height: 4, channelCount: 1, samples: expected });
    const { data } = await sharp(pngBytes)
      .toColourspace("grey16")
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    expect(Array.from(new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2))).toEqual(expected);
  });

  it("refuses interlaced PNGs with the locked re-export message", async () => {
    const pngBytes = buildHandFilteredPng(
      { width: 5, height: 3, colorType: 0, interlaceMethod: 1 },
      GRAY_SAMPLES_5X3,
      () => 0,
    );
    await expect(decodeWholePngFeedingSlices(pngBytes, 64)).rejects.toThrow(
      INTERLACED_PNG_REFUSAL_MESSAGE,
    );
  });

  it("refuses 16-bit PNGs with an alpha channel", async () => {
    const pngBytes = buildHandFilteredPng(
      { width: 5, height: 3, colorType: 4 },
      GRAY_SAMPLES_5X3,
      () => 0,
    );
    await expect(decodeWholePngFeedingSlices(pngBytes, 64)).rejects.toThrow(
      PNG16_ALPHA_UNSUPPORTED_MESSAGE,
    );
  });

  it("refuses non-16-bit PNGs", async () => {
    const pngBytes = buildHandFilteredPng(
      { width: 5, height: 3, colorType: 0, bitDepth: 8 },
      GRAY_SAMPLES_5X3,
      () => 0,
    );
    await expect(decodeWholePngFeedingSlices(pngBytes, 64)).rejects.toThrow(
      "only reads 16-bit",
    );
  });

  it("refuses an unknown scanline filter type", async () => {
    const pngBytes = buildHandFilteredPng(
      { width: 5, height: 3, colorType: 0 },
      GRAY_SAMPLES_5X3,
      () => 0,
    );
    const withBadFilter = corruptFirstScanlineFilterByte(pngBytes, 5);
    await expect(decodeWholePngFeedingSlices(withBadFilter, 64)).rejects.toThrow(
      "unknown scanline filter type 5",
    );
  });

  it("refuses bytes that are not a PNG at all", async () => {
    const decoder = createStreamingPng16Decoder();
    await expect(decoder.consumeFileBytes(new Uint8Array(16))).rejects.toThrow(
      "not a valid PNG",
    );
  });

  it("reports truncated pixel data when scanlines are missing", async () => {
    const pngBytes = buildHandFilteredPngMissingLastRow();
    await expect(decodeWholePngFeedingSlices(pngBytes, 64)).rejects.toThrow(
      "ended before every row was decoded",
    );
  });
});

function corruptFirstScanlineFilterByte(pngBytes: Uint8Array, filterType: number): Uint8Array {
  const idatDataStart = 8 + 12 + 13 + 8;
  const idatDataLength = new DataView(pngBytes.buffer, pngBytes.byteOffset).getUint32(8 + 12 + 13);
  const filtered = Buffer.from(
    inflateSync(pngBytes.subarray(idatDataStart, idatDataStart + idatDataLength)),
  );
  filtered[0] = filterType;
  return concatBytes([
    pngBytes.subarray(0, 8 + 12 + 13),
    buildPngChunkBytes("IDAT", deflateSync(filtered)),
    buildPngChunkBytes("IEND", new Uint8Array(0)),
  ]);
}

function buildHandFilteredPngMissingLastRow(): Uint8Array {
  const rowByteLength = 5 * 2;
  const filtered = new Uint8Array(2 * (1 + rowByteLength));
  return concatBytes([
    PNG_SIGNATURE,
    buildPngChunkBytes("IHDR", buildIhdrChunkData({ width: 5, height: 3, colorType: 0 })),
    buildPngChunkBytes("IDAT", deflateSync(filtered)),
    buildPngChunkBytes("IEND", new Uint8Array(0)),
  ]);
}

describe("reconstructScanlineBytesInPlace", () => {
  it("treats the missing previous row of the first scanline as zeroes", () => {
    const row = Uint8Array.from([10, 20, 30, 40]);
    reconstructScanlineBytesInPlace(2, row, null, 2);
    expect(Array.from(row)).toEqual([10, 20, 30, 40]);
  });
});
