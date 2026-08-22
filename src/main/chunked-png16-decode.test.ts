import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChunkedPng16DecodeSessions } from "./chunked-png16-decode";
import { createStreamingPng16GrayscaleEncoder } from "./png16-encode";

// CT-272: the session store reads the PNG from disk in small slices and serves
// bounded chunks of DECODED big-endian samples; tiny slice/chunk sizes here
// force multiple pump-and-serve rounds over a kilobyte-scale file.

const WIDTH = 8;
const HEIGHT = 6;
const SAMPLES = Array.from({ length: WIDTH * HEIGHT }, (_, index) => 256 + index * 700);

let temporaryDirectory: string;
let pngFilePath: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "png16-decode-test-"));
  pngFilePath = join(temporaryDirectory, "gradient.png");
  await writeFile(pngFilePath, await encodeSamplesAsPng16(SAMPLES, WIDTH, HEIGHT));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function encodeSamplesAsPng16(
  samples: ReadonlyArray<number>,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const blocks: Uint8Array[] = [];
  const encoder = createStreamingPng16GrayscaleEncoder({ width, height }, async (bytes) => {
    blocks.push(bytes.slice());
  });
  const raw = new Uint8Array(samples.length * 2);
  samples.forEach((value, index) => {
    raw[index * 2] = value >>> 8;
    raw[index * 2 + 1] = value & 0xff;
  });
  await encoder.consumeRawBigEndianSampleBytes(raw);
  await encoder.finishWritingPngTrailer();
  return concatBytes(blocks);
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

function parseBigEndianSamples(bytes: Uint8Array): number[] {
  const samples: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    samples.push((bytes[index]! << 8) | bytes[index + 1]!);
  }
  return samples;
}

const TINY_FILE_SLICE_BYTES = 16;
const TINY_DECODED_CHUNK_BYTES = 10;

describe("createChunkedPng16DecodeSessions", () => {
  it("serves every decoded byte across bounded chunks and finishes cleanly", async () => {
    const sessions = createChunkedPng16DecodeSessions(TINY_FILE_SLICE_BYTES, TINY_DECODED_CHUNK_BYTES);
    const begun = await sessions.begin(pngFilePath);
    expect(begun).toMatchObject({ width: WIDTH, height: HEIGHT, channelCount: 1 });
    const pieces: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const chunk = await sessions.readNextDecodedChunk(begun.token);
      expect(chunk.bytes.byteLength).toBeLessThanOrEqual(TINY_DECODED_CHUNK_BYTES);
      pieces.push(chunk.bytes);
      done = chunk.done;
    }
    expect(pieces.length).toBeGreaterThan(1);
    expect(parseBigEndianSamples(concatBytes(pieces))).toEqual(SAMPLES);
    await expect(sessions.finish(begun.token)).resolves.toBeUndefined();
  });

  it("refuses to finish before every decoded byte was read", async () => {
    const sessions = createChunkedPng16DecodeSessions(TINY_FILE_SLICE_BYTES, TINY_DECODED_CHUNK_BYTES);
    const begun = await sessions.begin(pngFilePath);
    await sessions.readNextDecodedChunk(begun.token);
    await expect(sessions.finish(begun.token)).rejects.toThrow(
      "before every decoded byte was read",
    );
    await expect(sessions.readNextDecodedChunk(begun.token)).rejects.toThrow(
      "Unknown chunked PNG decode token",
    );
  });

  it("abort discards the session so its token stops resolving", async () => {
    const sessions = createChunkedPng16DecodeSessions(TINY_FILE_SLICE_BYTES, TINY_DECODED_CHUNK_BYTES);
    const begun = await sessions.begin(pngFilePath);
    await expect(sessions.abort(begun.token)).resolves.toBeUndefined();
    await expect(sessions.readNextDecodedChunk(begun.token)).rejects.toThrow(
      "Unknown chunked PNG decode token",
    );
    await expect(sessions.abort(begun.token)).resolves.toBeUndefined();
  });

  it("rejects begin for a file that is not a PNG", async () => {
    const notPngPath = join(temporaryDirectory, "not-a-png.bin");
    await writeFile(notPngPath, new Uint8Array(64));
    const sessions = createChunkedPng16DecodeSessions();
    await expect(sessions.begin(notPngPath)).rejects.toThrow("not a valid PNG");
  });

  it("rejects an unknown token on every channel", async () => {
    const sessions = createChunkedPng16DecodeSessions();
    await expect(sessions.readNextDecodedChunk("missing")).rejects.toThrow(
      "Unknown chunked PNG decode token",
    );
    await expect(sessions.finish("missing")).rejects.toThrow("Unknown chunked PNG decode token");
  });
});
