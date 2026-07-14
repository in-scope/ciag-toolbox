import { describe, expect, it } from "vitest";

import type { EnviHeader, EnviInterleave } from "@/lib/image/parse-envi-header";
import { readEnviBinaryAsBandPixels } from "@/lib/image/read-envi-binary";
import { createChunkFedEnviBandDecoder } from "@/lib/image/read-envi-binary-from-chunks";
import type { RasterTypedArray } from "@/lib/image/raster-image";

const ENVI_DATA_TYPE_FLOAT32 = 4;
const ENVI_DATA_TYPE_UINT16 = 12;

// CT-231 equivalence contract: feeding the binary through the chunk-fed
// decoder in ANY chunking must match the whole-buffer decoder byte-for-byte.
// The chunk sizes below are chosen against a 4x3x3 uint16 cube (row = 8
// bytes, band = 24 bytes) so boundaries split a sample (1, 3, 5, 7), a row
// (5, 7), land exactly on a row (8), exactly on a band (24), and split a
// band just past its boundary (25).
const CHUNK_SIZES_TO_SWEEP = [1, 2, 3, 5, 7, 8, 24, 25, 999];
const ALL_INTERLEAVES: ReadonlyArray<EnviInterleave> = ["bsq", "bil", "bip"];

describe("createChunkFedEnviBandDecoder", () => {
  for (const interleave of ALL_INTERLEAVES) {
    for (const chunkSize of CHUNK_SIZES_TO_SWEEP) {
      it(`matches the whole-buffer ${interleave.toUpperCase()} decode with ${chunkSize}-byte chunks`, () => {
        const header = buildUint16Header(interleave);
        const binary = buildDeterministicBinaryForHeader(header);
        expectChunkFedDecodeMatchesWholeBufferDecode(header, binary, chunkSize);
      });
    }
  }

  it("honors a non-zero header offset that misaligns every following sample", () => {
    const header = { ...buildUint16Header("bil"), headerOffset: 7 };
    const binary = buildDeterministicBinaryForHeader(header);
    expectChunkFedDecodeMatchesWholeBufferDecode(header, binary, 4);
  });

  it("decodes big-endian uint16 identically to the whole-buffer decoder", () => {
    const header: EnviHeader = { ...buildUint16Header("bsq"), byteOrder: 1 };
    const binary = buildDeterministicBinaryForHeader(header);
    expectChunkFedDecodeMatchesWholeBufferDecode(header, binary, 3);
  });

  it("decodes float32 samples split across chunk boundaries identically", () => {
    const header = buildFloat32Header("bip");
    const binary = buildDeterministicBinaryForHeader(header);
    expectChunkFedDecodeMatchesWholeBufferDecode(header, binary, 3);
  });

  it("ignores surplus trailing bytes exactly like the whole-buffer decoder", () => {
    const header = buildUint16Header("bsq");
    const binary = buildDeterministicBinaryForHeader(header);
    const padded = new Uint8Array(binary.byteLength + 5);
    padded.set(binary, 0);
    padded.fill(0xab, binary.byteLength);
    expectChunkFedDecodeMatchesWholeBufferDecode(header, padded, 7);
  });

  it("rejects a declared binary size smaller than the cube needs", () => {
    const header = buildUint16Header("bsq");
    expect(() => createChunkFedEnviBandDecoder(header, 10)).toThrow(
      /smaller than expected \(10 bytes, need 72\)/,
    );
  });

  it("refuses to finish when the stream starved before every sample arrived", () => {
    const header = buildUint16Header("bsq");
    const binary = buildDeterministicBinaryForHeader(header);
    const decoder = createChunkFedEnviBandDecoder(header, binary.byteLength);
    decoder.consumeChunk(binary.subarray(0, 30));
    expect(() => decoder.finishAndTakeBandPixels()).toThrow(/before every sample arrived/);
  });
});

function expectChunkFedDecodeMatchesWholeBufferDecode(
  header: EnviHeader,
  binary: Uint8Array,
  chunkSize: number,
): void {
  const expected = readEnviBinaryAsBandPixels(header, binary);
  const actual = decodeFeedingChunksOfSize(header, binary, chunkSize);
  expect(actual.length).toBe(expected.length);
  for (let bandIndex = 0; bandIndex < expected.length; bandIndex++) {
    expect(Array.from(actual[bandIndex]!)).toEqual(Array.from(expected[bandIndex]!));
  }
}

function decodeFeedingChunksOfSize(
  header: EnviHeader,
  binary: Uint8Array,
  chunkSize: number,
): ReadonlyArray<RasterTypedArray> {
  const decoder = createChunkFedEnviBandDecoder(header, binary.byteLength);
  for (let offset = 0; offset < binary.byteLength; offset += chunkSize) {
    decoder.consumeChunk(binary.subarray(offset, Math.min(offset + chunkSize, binary.byteLength)));
  }
  return decoder.finishAndTakeBandPixels();
}

function buildUint16Header(interleave: EnviInterleave): EnviHeader {
  return {
    samples: 4,
    lines: 3,
    bands: 3,
    dataType: ENVI_DATA_TYPE_UINT16,
    byteOrder: 0,
    interleave,
    headerOffset: 0,
  };
}

function buildFloat32Header(interleave: EnviInterleave): EnviHeader {
  return { ...buildUint16Header(interleave), dataType: ENVI_DATA_TYPE_FLOAT32 };
}

function buildDeterministicBinaryForHeader(header: EnviHeader): Uint8Array {
  const bytesPerSample = header.dataType === ENVI_DATA_TYPE_FLOAT32 ? 4 : 2;
  const totalSamples = header.samples * header.lines * header.bands;
  const bytes = new Uint8Array(header.headerOffset + totalSamples * bytesPerSample);
  bytes.fill(0xee, 0, header.headerOffset);
  writeDeterministicSamples(header, bytes, bytesPerSample);
  return bytes;
}

function writeDeterministicSamples(
  header: EnviHeader,
  bytes: Uint8Array,
  bytesPerSample: number,
): void {
  const totalSamples = header.samples * header.lines * header.bands;
  const view = new DataView(bytes.buffer, header.headerOffset);
  for (let index = 0; index < totalSamples; index++) {
    writeOneDeterministicSample(header, view, index, bytesPerSample);
  }
}

function writeOneDeterministicSample(
  header: EnviHeader,
  view: DataView,
  index: number,
  bytesPerSample: number,
): void {
  const isLittleEndian = header.byteOrder === 0;
  if (header.dataType === ENVI_DATA_TYPE_FLOAT32) {
    view.setFloat32(index * bytesPerSample, index * 1.5 - 3.25, isLittleEndian);
    return;
  }
  view.setUint16(index * bytesPerSample, (index * 2654435761) % 65536, isLittleEndian);
}
