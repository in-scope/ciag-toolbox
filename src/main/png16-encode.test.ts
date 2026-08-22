import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  createStreamingPng16GrayscaleEncoder,
  rawPng16SampleByteLengthForDimensions,
  type Png16GrayscaleDimensions,
} from "./png16-encode";

// CT-271 round-trip oracle: every encode is decoded with sharp (libvips/libspng),
// an independent reference PNG implementation, and the samples must match EXACTLY.

interface CollectedEncode {
  readonly encoder: ReturnType<typeof createStreamingPng16GrayscaleEncoder>;
  readonly collectEncodedBytes: () => Uint8Array;
}

function createEncoderCollectingOutput(dimensions: Png16GrayscaleDimensions): CollectedEncode {
  const blocks: Uint8Array[] = [];
  const encoder = createStreamingPng16GrayscaleEncoder(dimensions, async (bytes) => {
    blocks.push(bytes.slice());
  });
  return { encoder, collectEncodedBytes: () => concatBytes(blocks) };
}

function concatBytes(blocks: ReadonlyArray<Uint8Array>): Uint8Array {
  const joined = new Uint8Array(blocks.reduce((sum, block) => sum + block.byteLength, 0));
  let offset = 0;
  for (const block of blocks) {
    joined.set(block, offset);
    offset += block.byteLength;
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

// toColourspace("grey16") keeps libvips in its 16-bit grayscale space; the
// default pipeline converts to 8-bit sRGB and would silently downscale values.
async function decodeSamplesWithReferenceDecoder(pngBytes: Uint8Array): Promise<number[]> {
  const { data, info } = await sharp(Buffer.from(pngBytes))
    .toColourspace("grey16")
    .raw({ depth: "ushort" })
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(1);
  const samples = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  return Array.from(samples);
}

const SAMPLES_5X3 = [
  0, 1, 255, 256, 800,
  4095, 12345, 30000, 65534, 65535,
  100, 250, 950, 1750, 32768,
];

describe("createStreamingPng16GrayscaleEncoder", () => {
  it("encodes a known uint16 band that the reference decoder reads back exactly", async () => {
    const { encoder, collectEncodedBytes } = createEncoderCollectingOutput({ width: 5, height: 3 });
    await encoder.consumeRawBigEndianSampleBytes(buildBigEndianBytesFromSamples(SAMPLES_5X3));
    await encoder.finishWritingPngTrailer();
    expect(await decodeSamplesWithReferenceDecoder(collectEncodedBytes())).toEqual(SAMPLES_5X3);
  });

  it("declares 16-bit grayscale dimensions in the signature and IHDR chunk", async () => {
    const { encoder, collectEncodedBytes } = createEncoderCollectingOutput({ width: 5, height: 3 });
    await encoder.consumeRawBigEndianSampleBytes(buildBigEndianBytesFromSamples(SAMPLES_5X3));
    await encoder.finishWritingPngTrailer();
    const bytes = collectEncodedBytes();
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(16)).toBe(5);
    expect(view.getUint32(20)).toBe(3);
    expect(bytes[24]).toBe(16);
    expect(bytes[25]).toBe(0);
    const metadata = await sharp(Buffer.from(bytes)).metadata();
    expect(metadata.depth).toBe("ushort");
    expect(metadata.width).toBe(5);
    expect(metadata.height).toBe(3);
  });

  it("decodes identically when the raw bytes arrive split mid-sample and mid-row", async () => {
    const raw = buildBigEndianBytesFromSamples(SAMPLES_5X3);
    const { encoder, collectEncodedBytes } = createEncoderCollectingOutput({ width: 5, height: 3 });
    for (let offset = 0; offset < raw.byteLength; offset += 7) {
      await encoder.consumeRawBigEndianSampleBytes(raw.subarray(offset, Math.min(offset + 7, raw.byteLength)));
    }
    await encoder.finishWritingPngTrailer();
    expect(await decodeSamplesWithReferenceDecoder(collectEncodedBytes())).toEqual(SAMPLES_5X3);
  });

  it("rejects raw bytes beyond the described sample payload", async () => {
    const { encoder } = createEncoderCollectingOutput({ width: 2, height: 1 });
    await encoder.consumeRawBigEndianSampleBytes(new Uint8Array(4));
    await expect(encoder.consumeRawBigEndianSampleBytes(new Uint8Array(1))).rejects.toThrow(
      /did not match the described size/,
    );
  });

  it("refuses to finish while raw sample bytes are missing", async () => {
    const { encoder } = createEncoderCollectingOutput({ width: 2, height: 2 });
    await encoder.consumeRawBigEndianSampleBytes(new Uint8Array(4));
    await expect(encoder.finishWritingPngTrailer()).rejects.toThrow(/did not match the described size/);
  });

  it("rejects non-positive or fractional dimensions", () => {
    for (const dimensions of [
      { width: 0, height: 2 },
      { width: 2, height: 0 },
      { width: 1.5, height: 2 },
    ]) {
      expect(() => createEncoderCollectingOutput(dimensions)).toThrow(/invalid encoded size/);
    }
  });
});

describe("rawPng16SampleByteLengthForDimensions", () => {
  it("describes two bytes per pixel", () => {
    expect(rawPng16SampleByteLengthForDimensions({ width: 5, height: 3 })).toBe(30);
  });
});
