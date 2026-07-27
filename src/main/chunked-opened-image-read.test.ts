import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createChunkedOpenedImageFileReader } from "./chunked-opened-image-read";
import type { ChunkedOpenedImageReadTarget } from "../shared/chunked-opened-image-read-protocol";

const TEST_CHUNK_BYTES = 5;

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "chunked-read-test-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env["CT_MAX_OPENABLE_FILE_BYTES"];
});

function buildDistinctBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 251);
}

async function writeTemporaryFile(fileName: string, bytes: Uint8Array): Promise<string> {
  const filePath = join(temporaryDirectory, fileName);
  await writeFile(filePath, bytes);
  return filePath;
}

async function pullWholeTargetThroughReader(
  reader: ReturnType<typeof createChunkedOpenedImageFileReader>,
  token: string,
  target: ChunkedOpenedImageReadTarget,
  sizeBytes: number,
): Promise<Uint8Array> {
  const assembled = new Uint8Array(sizeBytes);
  let offset = 0;
  while (offset < sizeBytes) {
    const chunk = await reader.readNextChunk(token, target);
    assembled.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
    expect(chunk.done).toBe(offset >= sizeBytes);
  }
  return assembled;
}

describe("createChunkedOpenedImageFileReader", () => {
  it("streams a file in chunks that reassemble to the exact contents with the whole-file hash", async () => {
    const contents = buildDistinctBytes(23);
    const filePath = await writeTemporaryFile("plain.tif", contents);
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    const begun = await reader.begin(filePath);
    expect(begun.fileSizeBytes).toBe(23);
    expect(begun.sidecar).toBeNull();
    const assembled = await pullWholeTargetThroughReader(reader, begun.token, "file", 23);
    expect(assembled).toEqual(contents);
    const finished = await reader.finish(begun.token);
    expect(finished.contentHash).toBe(createHash("sha256").update(contents).digest("hex"));
  });

  it("chunks are capped at the configured chunk size and cover every byte exactly once", async () => {
    const contents = buildDistinctBytes(12);
    const filePath = await writeTemporaryFile("sizes.tif", contents);
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    const begun = await reader.begin(filePath);
    const chunkLengths: number[] = [];
    let done = false;
    while (!done) {
      const chunk = await reader.readNextChunk(begun.token, "file");
      chunkLengths.push(chunk.bytes.byteLength);
      done = chunk.done;
    }
    expect(chunkLengths).toEqual([5, 5, 2]);
    await reader.finish(begun.token);
  });

  it("discovers an ENVI binary sibling for a .hdr file and streams it as the sidecar", async () => {
    const headerBytes = buildDistinctBytes(7);
    const binaryBytes = buildDistinctBytes(17);
    const headerPath = await writeTemporaryFile("cube.hdr", headerBytes);
    await writeTemporaryFile("cube.bin", binaryBytes);
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    const begun = await reader.begin(headerPath);
    expect(begun.sidecar).toEqual({ fileName: "cube.bin", sizeBytes: 17 });
    const header = await pullWholeTargetThroughReader(reader, begun.token, "file", 7);
    const sidecar = await pullWholeTargetThroughReader(reader, begun.token, "sidecar", 17);
    expect(header).toEqual(headerBytes);
    expect(sidecar).toEqual(binaryBytes);
    const finished = await reader.finish(begun.token);
    expect(finished.contentHash).toBe(createHash("sha256").update(headerBytes).digest("hex"));
  });

  it("rejects a .hdr file with no binary sibling", async () => {
    const headerPath = await writeTemporaryFile("orphan.hdr", buildDistinctBytes(4));
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    await expect(reader.begin(headerPath)).rejects.toThrow(
      /Could not find ENVI binary sibling for orphan\.hdr/,
    );
  });

  it("rejects finishing before every byte was read", async () => {
    const filePath = await writeTemporaryFile("partial.tif", buildDistinctBytes(9));
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    const begun = await reader.begin(filePath);
    await reader.readNextChunk(begun.token, "file");
    await expect(reader.finish(begun.token)).rejects.toThrow(
      /finished before every byte was read/,
    );
    await reader.abort(begun.token);
  });

  it("forgets a session on abort", async () => {
    const filePath = await writeTemporaryFile("aborted.tif", buildDistinctBytes(6));
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    const begun = await reader.begin(filePath);
    await reader.abort(begun.token);
    await expect(reader.readNextChunk(begun.token, "file")).rejects.toThrow(
      /Unknown chunked file read token/,
    );
  });

  it("rejects an unknown token and a sidecar request on a sidecarless session", async () => {
    const filePath = await writeTemporaryFile("nosidecar.tif", buildDistinctBytes(3));
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    await expect(reader.readNextChunk("no-such-token", "file")).rejects.toThrow(
      /Unknown chunked file read token/,
    );
    const begun = await reader.begin(filePath);
    await expect(reader.readNextChunk(begun.token, "sidecar")).rejects.toThrow(
      /has no sidecar/,
    );
    await reader.abort(begun.token);
  });

  it("enforces the openable file size limit at begin with the in-vocabulary error", async () => {
    const filePath = await writeTemporaryFile("too-big.tif", buildDistinctBytes(10));
    process.env["CT_MAX_OPENABLE_FILE_BYTES"] = "4";
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    await expect(reader.begin(filePath)).rejects.toThrow(
      /exceeds the .* maximum openable file size/,
    );
  });
});
