import { describe, expect, it, vi } from "vitest";

import {
  createBigEndianUint16SampleScatter,
  loadPng16RasterThroughChunkedDecode,
  type Png16DecodeApi,
} from "@/lib/image/load-png16";

// CT-272: the renderer side of the chunked 16-bit PNG decode - the big-endian
// sample scatter (chunk boundaries can split a sample) and the raster assembly
// (grayscale -> one untagged band, color -> a 3-band rgb-tagged raster).

function buildBigEndianBytesFromSamples(samples: ReadonlyArray<number>): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  samples.forEach((value, index) => {
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

describe("createBigEndianUint16SampleScatter", () => {
  it("scatters grayscale samples into one band whatever the chunk boundaries", () => {
    const samples = [300, 65535, 0, 4096, 255, 256];
    const raw = buildBigEndianBytesFromSamples(samples);
    for (const sliceBytes of [1, 3, 5, raw.byteLength]) {
      const scatter = createBigEndianUint16SampleScatter({ width: 3, height: 2, channelCount: 1 });
      for (let offset = 0; offset < raw.byteLength; offset += sliceBytes) {
        scatter.consumeChunk(raw.subarray(offset, Math.min(offset + sliceBytes, raw.byteLength)));
      }
      const bands = scatter.takeBands();
      expect(bands).toHaveLength(1);
      expect(Array.from(bands[0]!)).toEqual(samples);
    }
  });

  it("deinterleaves color samples into three channel bands", () => {
    const interleaved = [300, 40000, 7, 65535, 0, 511];
    const raw = buildBigEndianBytesFromSamples(interleaved);
    const scatter = createBigEndianUint16SampleScatter({ width: 2, height: 1, channelCount: 3 });
    scatter.consumeChunk(raw.subarray(0, 5));
    scatter.consumeChunk(raw.subarray(5));
    const bands = scatter.takeBands();
    expect(bands.map((band) => Array.from(band))).toEqual([
      [300, 65535],
      [40000, 0],
      [7, 511],
    ]);
  });

  it("refuses to hand out bands while samples are missing or split", () => {
    const scatter = createBigEndianUint16SampleScatter({ width: 2, height: 1, channelCount: 1 });
    scatter.consumeChunk(buildBigEndianBytesFromSamples([300]));
    expect(() => scatter.takeBands()).toThrow("unexpected amount of data");
    scatter.consumeChunk(Uint8Array.of(1));
    expect(() => scatter.takeBands()).toThrow("unexpected amount of data");
  });
});

interface FakeDecodeCalls {
  readonly finished: string[];
  readonly aborted: string[];
}

function buildFakeApiServingSamples(
  shape: { width: number; height: number; channelCount: number },
  samples: ReadonlyArray<number>,
  chunkByteLength: number,
): { api: Png16DecodeApi; calls: FakeDecodeCalls } {
  const raw = buildBigEndianBytesFromSamples(samples);
  const calls: FakeDecodeCalls = { finished: [], aborted: [] };
  let offset = 0;
  return {
    calls,
    api: {
      begin: vi.fn(async () => ({ token: "fake-token", ...shape })),
      readChunk: async () => {
        const bytes = raw.subarray(offset, Math.min(offset + chunkByteLength, raw.byteLength));
        offset += bytes.byteLength;
        return { done: offset >= raw.byteLength, bytes };
      },
      finish: async ({ token }) => {
        calls.finished.push(token);
      },
      abort: async ({ token }) => {
        calls.aborted.push(token);
      },
    },
  };
}

describe("loadPng16RasterThroughChunkedDecode", () => {
  it("builds an untagged single-band uint16 raster from a grayscale decode", async () => {
    const samples = [300, 65535, 0, 4096, 255, 256];
    const { api } = buildFakeApiServingSamples(
      { width: 3, height: 2, channelCount: 1 },
      samples,
      5,
    );
    const raster = await loadPng16RasterThroughChunkedDecode(api, "C:/pictures/depth.png");
    expect(raster).toMatchObject({
      width: 3,
      height: 2,
      bandCount: 1,
      bitsPerSample: 16,
      sampleFormat: "uint",
    });
    expect(raster.colorInterpretation).toBeUndefined();
    expect(Array.from(raster.bandPixels[0] as Uint16Array)).toEqual(samples);
  });

  it("tags a three-channel decode as an rgb composite with channel labels", async () => {
    const interleaved = [300, 40000, 7, 65535, 0, 511];
    const { api } = buildFakeApiServingSamples(
      { width: 2, height: 1, channelCount: 3 },
      interleaved,
      1024,
    );
    const raster = await loadPng16RasterThroughChunkedDecode(api, "C:/pictures/photo.png");
    expect(raster).toMatchObject({
      bandCount: 3,
      colorInterpretation: "rgb",
      bandLabels: ["Red", "Green", "Blue"],
      bandOriginalNumbers: [1, 2, 3],
    });
    expect(Array.from(raster.bandPixels[0] as Uint16Array)).toEqual([300, 65535]);
    expect(Array.from(raster.bandPixels[2] as Uint16Array)).toEqual([7, 511]);
  });

  it("finishes the protocol session after a complete decode", async () => {
    const { api, calls } = buildFakeApiServingSamples(
      { width: 2, height: 1, channelCount: 1 },
      [300, 400],
      1024,
    );
    await loadPng16RasterThroughChunkedDecode(api, "any.png");
    expect(calls.finished).toEqual(["fake-token"]);
    expect(calls.aborted).toEqual([]);
  });

  it("aborts the protocol session when a chunk read fails mid-decode", async () => {
    const { api, calls } = buildFakeApiServingSamples(
      { width: 2, height: 1, channelCount: 1 },
      [300, 400],
      1024,
    );
    api.readChunk = async () => {
      throw new Error("main-process decode failed");
    };
    await expect(loadPng16RasterThroughChunkedDecode(api, "any.png")).rejects.toThrow(
      "main-process decode failed",
    );
    expect(calls.aborted).toEqual(["fake-token"]);
    expect(calls.finished).toEqual([]);
  });

  it("rejects a chunk stream that overshoots the described payload", async () => {
    const { api, calls } = buildFakeApiServingSamples(
      { width: 2, height: 1, channelCount: 1 },
      [300, 400, 500],
      1024,
    );
    await expect(loadPng16RasterThroughChunkedDecode(api, "any.png")).rejects.toThrow(
      "unexpected amount of data",
    );
    expect(calls.aborted).toEqual(["fake-token"]);
  });
});
