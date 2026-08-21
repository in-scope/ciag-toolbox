import { describe, expect, it } from "vitest";

import {
  INTERLACED_PNG_REFUSAL_MESSAGE,
  PNG16_ALPHA_UNSUPPORTED_MESSAGE,
  assertSixteenBitPngHeaderIsDecodable,
  channelCountForSixteenBitPngColorTypeOrThrow,
  isSixteenBitPngFileHeader,
  parsePngFileHeaderOrNull,
} from "./png-header";

interface IhdrFields {
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlaceMethod?: number;
}

function buildPngFilePrefix(fields: IhdrFields = {}): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, fields.width ?? 5);
  view.setUint32(20, fields.height ?? 4);
  bytes[24] = fields.bitDepth ?? 16;
  bytes[25] = fields.colorType ?? 0;
  bytes[28] = fields.interlaceMethod ?? 0;
  return bytes;
}

describe("parsePngFileHeaderOrNull", () => {
  it("parses width, height, bit depth, color type and interlace method", () => {
    const summary = parsePngFileHeaderOrNull(
      buildPngFilePrefix({ width: 640, height: 480, bitDepth: 16, colorType: 2, interlaceMethod: 1 }),
    );
    expect(summary).toEqual({
      width: 640,
      height: 480,
      bitDepth: 16,
      colorType: 2,
      interlaceMethod: 1,
    });
  });

  it("returns null for bytes that do not start with the PNG signature", () => {
    const notPng = buildPngFilePrefix();
    notPng[0] = 0x4d;
    expect(parsePngFileHeaderOrNull(notPng)).toBeNull();
  });

  it("returns null for a byte prefix too short to hold the IHDR", () => {
    expect(parsePngFileHeaderOrNull(buildPngFilePrefix().subarray(0, 20))).toBeNull();
  });

  it("returns null when the first chunk is not a well-formed IHDR", () => {
    const wrongFirstChunk = buildPngFilePrefix();
    wrongFirstChunk.set([116, 69, 88, 116], 12);
    expect(parsePngFileHeaderOrNull(wrongFirstChunk)).toBeNull();
  });
});

describe("isSixteenBitPngFileHeader", () => {
  it("is true only for bit depth 16", () => {
    expect(isSixteenBitPngFileHeader(parsePngFileHeaderOrNull(buildPngFilePrefix()))).toBe(true);
    expect(
      isSixteenBitPngFileHeader(parsePngFileHeaderOrNull(buildPngFilePrefix({ bitDepth: 8 }))),
    ).toBe(false);
    expect(isSixteenBitPngFileHeader(null)).toBe(false);
  });
});

describe("channelCountForSixteenBitPngColorTypeOrThrow", () => {
  it("maps grayscale to 1 channel and rgb to 3", () => {
    expect(channelCountForSixteenBitPngColorTypeOrThrow(0)).toBe(1);
    expect(channelCountForSixteenBitPngColorTypeOrThrow(2)).toBe(3);
  });

  it("refuses alpha color types with the locked message", () => {
    expect(() => channelCountForSixteenBitPngColorTypeOrThrow(4)).toThrow(
      PNG16_ALPHA_UNSUPPORTED_MESSAGE,
    );
    expect(() => channelCountForSixteenBitPngColorTypeOrThrow(6)).toThrow(
      PNG16_ALPHA_UNSUPPORTED_MESSAGE,
    );
  });

  it("refuses other color types by number", () => {
    expect(() => channelCountForSixteenBitPngColorTypeOrThrow(3)).toThrow(
      "16-bit PNGs with color type 3 are not supported",
    );
  });
});

describe("assertSixteenBitPngHeaderIsDecodable", () => {
  it("refuses interlaced PNGs with the locked re-export message", () => {
    const interlaced = parsePngFileHeaderOrNull(buildPngFilePrefix({ interlaceMethod: 1 }))!;
    expect(() => assertSixteenBitPngHeaderIsDecodable(interlaced)).toThrow(
      INTERLACED_PNG_REFUSAL_MESSAGE,
    );
  });

  it("accepts non-interlaced grayscale and rgb headers", () => {
    const gray = parsePngFileHeaderOrNull(buildPngFilePrefix())!;
    const rgb = parsePngFileHeaderOrNull(buildPngFilePrefix({ colorType: 2 }))!;
    expect(() => assertSixteenBitPngHeaderIsDecodable(gray)).not.toThrow();
    expect(() => assertSixteenBitPngHeaderIsDecodable(rgb)).not.toThrow();
  });
});
