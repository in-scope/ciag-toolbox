import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { INTERLACED_PNG_REFUSAL_MESSAGE } from "@shared/png-header";

import {
  decodeMaskPngBytes,
  MASK_PNG_BIT_DEPTH_MESSAGE,
  MASK_PNG_COLOR_TYPE_MESSAGE,
  MASK_PNG_NOT_A_PNG_MESSAGE,
  MASK_PNG_TRUNCATED_MESSAGE,
} from "@/lib/masks/mask-png-decode";
import { encodeMaskValuesAsGrayscalePngBytes } from "@/lib/masks/mask-png-encode";

// CT-303 round-trip oracles: (1) this module's own encoder, (2) hand-built
// PNGs (deflated with Node zlib, an independent compressor) covering the
// adaptive scanline filters, an INDEXED mask, and every refusal, and (3) the
// committed e2e fixture mask-multiband.png, written by generate-fixtures.mjs.

const MASK_FIXTURE_PATH = join(__dirname, "../../../../../e2e/fixtures/mask-multiband.png");

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("encodeMaskValuesAsGrayscalePngBytes", () => {
  it("round-trips the category indexes it was given", async () => {
    const values = Uint8Array.from([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    const encoded = await encodeMaskValuesAsGrayscalePngBytes(4, 3, values);
    const decoded = await decodeMaskPngBytes(encoded);
    expect(decoded).toEqual({ width: 4, height: 3, values });
  });

  it("writes an 8-bit grayscale header", async () => {
    const encoded = await encodeMaskValuesAsGrayscalePngBytes(2, 2, new Uint8Array(4));
    expect(Array.from(encoded.subarray(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
    expect(encoded[24]).toBe(8);
    expect(encoded[25]).toBe(0);
  });

  it("refuses values that do not cover the described size", async () => {
    await expect(
      encodeMaskValuesAsGrayscalePngBytes(4, 4, new Uint8Array(9)),
    ).rejects.toThrow("The mask does not cover the described size.");
  });
});

describe("decodeMaskPngBytes", () => {
  it("reads the committed mask fixture's known category assignments", async () => {
    const decoded = await decodeMaskPngBytes(new Uint8Array(readFileSync(MASK_FIXTURE_PATH)));
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 4, height: 4 });
    expect(Array.from(decoded.values)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2]);
  });

  it("reconstructs scanlines written with the sub and up filters", async () => {
    const rows = [
      [1, 1, 1, 1, 0, 0], // filter 1 (Sub): each byte is the delta from its left
      [2, 1, 0, 0, 0, 0], // filter 2 (Up): each byte is the delta from the row above
    ];
    const decoded = await decodeMaskPngBytes(buildGrayscaleMaskPng(5, 2, rows));
    expect(Array.from(decoded.values)).toEqual([1, 2, 3, 3, 3, 2, 2, 3, 3, 3]);
  });

  it("reads an INDEXED mask's palette indexes, not its palette colours", async () => {
    const rows = [
      [0, 0, 1, 2],
      [0, 2, 1, 0],
    ];
    const decoded = await decodeMaskPngBytes(buildIndexedMaskPng(3, 2, rows));
    expect(Array.from(decoded.values)).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it("refuses a file that is not a PNG", async () => {
    await expect(decodeMaskPngBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow(
      MASK_PNG_NOT_A_PNG_MESSAGE,
    );
  });

  it("refuses a 16-bit PNG", async () => {
    const bytes = buildMaskPngWithHeaderOverrides(2, 1, [[0, 0, 0, 0, 0]], { bitDepth: 16 });
    await expect(decodeMaskPngBytes(bytes)).rejects.toThrow(MASK_PNG_BIT_DEPTH_MESSAGE);
  });

  it("refuses a colour PNG", async () => {
    const bytes = buildMaskPngWithHeaderOverrides(1, 1, [[0, 0, 0, 0]], { colorType: 2 });
    await expect(decodeMaskPngBytes(bytes)).rejects.toThrow(MASK_PNG_COLOR_TYPE_MESSAGE);
  });

  it("refuses an interlaced PNG", async () => {
    const bytes = buildMaskPngWithHeaderOverrides(2, 1, [[0, 0, 0]], { interlaceMethod: 1 });
    await expect(decodeMaskPngBytes(bytes)).rejects.toThrow(INTERLACED_PNG_REFUSAL_MESSAGE);
  });

  it("refuses pixel data that ends before every row", async () => {
    const bytes = buildGrayscaleMaskPng(3, 3, [[0, 1, 1, 1]]);
    await expect(decodeMaskPngBytes(bytes)).rejects.toThrow(MASK_PNG_TRUNCATED_MESSAGE);
  });
});

interface MaskPngHeaderOverrides {
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlaceMethod?: number;
}

// Each row is [filterType, ...sampleBytes], deflated with Node zlib so the
// decoder is exercised against a compressor it does not own.
function buildGrayscaleMaskPng(
  width: number,
  height: number,
  rows: ReadonlyArray<ReadonlyArray<number>>,
): Uint8Array {
  return buildMaskPngWithHeaderOverrides(width, height, rows, {});
}

function buildIndexedMaskPng(
  width: number,
  height: number,
  rows: ReadonlyArray<ReadonlyArray<number>>,
): Uint8Array {
  const palette = buildPngChunk("PLTE", Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 0, 255]));
  return concatenate([
    PNG_SIGNATURE,
    buildIhdrChunk(width, height, { colorType: 3 }),
    palette,
    buildIdatChunk(rows),
    buildPngChunk("IEND", new Uint8Array(0)),
  ]);
}

function buildMaskPngWithHeaderOverrides(
  width: number,
  height: number,
  rows: ReadonlyArray<ReadonlyArray<number>>,
  overrides: MaskPngHeaderOverrides,
): Uint8Array {
  return concatenate([
    PNG_SIGNATURE,
    buildIhdrChunk(width, height, overrides),
    buildIdatChunk(rows),
    buildPngChunk("IEND", new Uint8Array(0)),
  ]);
}

function buildIhdrChunk(
  width: number,
  height: number,
  overrides: MaskPngHeaderOverrides,
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = overrides.bitDepth ?? 8;
  data[9] = overrides.colorType ?? 0;
  data[12] = overrides.interlaceMethod ?? 0;
  return buildPngChunk("IHDR", data);
}

function buildIdatChunk(rows: ReadonlyArray<ReadonlyArray<number>>): Uint8Array {
  const scanlines = Uint8Array.from(rows.flatMap((row) => [...row]));
  return buildPngChunk("IDAT", new Uint8Array(deflateSync(scanlines)));
}

function buildPngChunk(chunkType: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(chunkType, (character) => character.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(data, crc32(typeBytes)));
  return chunk;
}

function concatenate(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}
