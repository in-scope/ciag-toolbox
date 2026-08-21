import { describe, expect, it } from "vitest";

import {
  buildBigEndianUint16BytesForBandRange,
  clampSampleValueToUint16ByValue,
  planRasterBandAsRawPng16SampleUpload,
} from "@/lib/image/encode-png16-raw-samples";
import type { RasterImage } from "@/lib/image/raster-image";

function buildUint16Raster(): RasterImage {
  return {
    width: 3,
    height: 2,
    bandCount: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandPixels: [
      new Uint16Array([10, 20, 30, 40, 50, 60]),
      new Uint16Array([100, 800, 4095, 250, 950, 65535]),
    ],
  };
}

async function collectEmittedChunks(
  plan: ReturnType<typeof planRasterBandAsRawPng16SampleUpload>,
  maxChunkBytes: number,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  await plan.emitChunksInOrder(maxChunkBytes, async (bytes) => {
    chunks.push(bytes);
  });
  return chunks;
}

function concatChunks(chunks: ReadonlyArray<Uint8Array>): number[] {
  return chunks.flatMap((chunk) => Array.from(chunk));
}

describe("clampSampleValueToUint16ByValue", () => {
  it("keeps in-range integer values as-is (12-in-16 containers save unchanged)", () => {
    expect(clampSampleValueToUint16ByValue(0)).toBe(0);
    expect(clampSampleValueToUint16ByValue(800)).toBe(800);
    expect(clampSampleValueToUint16ByValue(4095)).toBe(4095);
    expect(clampSampleValueToUint16ByValue(65535)).toBe(65535);
  });

  it("narrows values above the uint16 range by value", () => {
    expect(clampSampleValueToUint16ByValue(65536)).toBe(65535);
    expect(clampSampleValueToUint16ByValue(1_000_000)).toBe(65535);
  });

  it("clamps negative signed-integer values to zero", () => {
    expect(clampSampleValueToUint16ByValue(-1)).toBe(0);
    expect(clampSampleValueToUint16ByValue(-32768)).toBe(0);
  });
});

describe("buildBigEndianUint16BytesForBandRange", () => {
  it("lays samples out big-endian per the PNG spec", () => {
    const bytes = buildBigEndianUint16BytesForBandRange(new Uint16Array([0x1234, 0x00ff]), 0, 2);
    expect(Array.from(bytes)).toEqual([0x12, 0x34, 0x00, 0xff]);
  });

  it("widens uint8 samples by value", () => {
    const bytes = buildBigEndianUint16BytesForBandRange(new Uint8Array([7, 255]), 0, 2);
    expect(Array.from(bytes)).toEqual([0, 7, 0, 255]);
  });

  it("narrows uint32 samples and clamps negative int16 samples by value", () => {
    expect(Array.from(buildBigEndianUint16BytesForBandRange(new Uint32Array([70_000]), 0, 1))).toEqual([0xff, 0xff]);
    expect(Array.from(buildBigEndianUint16BytesForBandRange(new Int16Array([-5]), 0, 1))).toEqual([0, 0]);
  });
});

describe("planRasterBandAsRawPng16SampleUpload", () => {
  it("describes two bytes per pixel of the selected band", () => {
    const plan = planRasterBandAsRawPng16SampleUpload(buildUint16Raster(), 1);
    expect(plan.byteLength).toBe(12);
  });

  it("emits the selected band's samples big-endian across bounded chunks", async () => {
    const plan = planRasterBandAsRawPng16SampleUpload(buildUint16Raster(), 1);
    const chunks = await collectEmittedChunks(plan, 5);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteLength <= 5)).toBe(true);
    expect(concatChunks(chunks)).toEqual([
      0, 100, 3, 32, 15, 255, 0, 250, 3, 182, 255, 255,
    ]);
  });
});
