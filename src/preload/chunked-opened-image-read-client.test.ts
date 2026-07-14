import { describe, expect, it } from "vitest";

import {
  readOpenedImageFileThroughChunkedProtocol,
  type ChunkedReadInvoker,
} from "./chunked-opened-image-read-client";
import {
  OPENED_IMAGE_READ_ABORT_CHANNEL,
  OPENED_IMAGE_READ_BEGIN_CHANNEL,
  OPENED_IMAGE_READ_CHUNK_CHANNEL,
  OPENED_IMAGE_READ_FINISH_CHANNEL,
  type ChunkedOpenedImageReadBeginResult,
} from "../shared/chunked-opened-image-read-protocol";
import type { OpenImagesDialogFileMetadataEntry } from "./index";

const METADATA: OpenImagesDialogFileMetadataEntry = {
  fileName: "stack.tif",
  filePath: "C:\\captures\\stack.tif",
  fileSizeBytes: 9,
  mtimeMs: 1234.5,
};

interface FakeMainProcessOptions {
  readonly fileBytes: Uint8Array;
  readonly sidecar?: { fileName: string; bytes: Uint8Array };
  readonly chunkBytes: number;
  readonly reportedFileSizeBytes?: number;
  readonly failChunkAtIndex?: number;
}

interface FakeMainProcess {
  readonly invoke: ChunkedReadInvoker;
  readonly calls: string[];
}

function createFakeMainProcess(options: FakeMainProcessOptions): FakeMainProcess {
  const calls: string[] = [];
  const offsets = { file: 0, sidecar: 0 };
  let chunkIndex = 0;
  const invoke: ChunkedReadInvoker = async (channel, payload) => {
    calls.push(channel);
    if (channel === OPENED_IMAGE_READ_BEGIN_CHANNEL) return describeBegin(options);
    if (channel === OPENED_IMAGE_READ_CHUNK_CHANNEL) {
      if (options.failChunkAtIndex === chunkIndex) throw new Error("chunk read blew up");
      chunkIndex += 1;
      return serveNextChunk(options, offsets, payload as { target: "file" | "sidecar" });
    }
    if (channel === OPENED_IMAGE_READ_FINISH_CHANNEL) return { contentHash: "hash-of-file" };
    return undefined;
  };
  return { invoke, calls };
}

function describeBegin(options: FakeMainProcessOptions): ChunkedOpenedImageReadBeginResult {
  return {
    token: "token-1",
    fileSizeBytes: options.reportedFileSizeBytes ?? options.fileBytes.byteLength,
    sidecar: options.sidecar
      ? { fileName: options.sidecar.fileName, sizeBytes: options.sidecar.bytes.byteLength }
      : null,
  };
}

function serveNextChunk(
  options: FakeMainProcessOptions,
  offsets: { file: number; sidecar: number },
  payload: { target: "file" | "sidecar" },
): { done: boolean; bytes: Uint8Array } {
  const source = payload.target === "file" ? options.fileBytes : options.sidecar!.bytes;
  const offset = offsets[payload.target];
  const bytes = source.subarray(offset, offset + options.chunkBytes);
  offsets[payload.target] = offset + bytes.byteLength;
  return { done: offsets[payload.target] >= source.byteLength, bytes };
}

function buildDistinctBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 7) % 251);
}

describe("readOpenedImageFileThroughChunkedProtocol", () => {
  it("assembles the whole file across chunks into the entry the renderer expects", async () => {
    const fileBytes = buildDistinctBytes(9);
    const fake = createFakeMainProcess({ fileBytes, chunkBytes: 4 });
    const entry = await readOpenedImageFileThroughChunkedProtocol(fake.invoke, METADATA);
    expect(entry.bytes).toEqual(fileBytes);
    expect(entry.contentHash).toBe("hash-of-file");
    expect(entry.fileName).toBe("stack.tif");
    expect(entry.fileSizeBytes).toBe(9);
    expect(entry.mtimeMs).toBe(1234.5);
    expect(fake.calls).toEqual([
      OPENED_IMAGE_READ_BEGIN_CHANNEL,
      OPENED_IMAGE_READ_CHUNK_CHANNEL,
      OPENED_IMAGE_READ_CHUNK_CHANNEL,
      OPENED_IMAGE_READ_CHUNK_CHANNEL,
      OPENED_IMAGE_READ_FINISH_CHANNEL,
    ]);
  });

  // CT-231: ENVI binaries stream through the renderer's chunk-fed decoder; the
  // whole-sidecar reassembly was removed, so a sidecar-bearing session here is
  // a routing bug and must abort loudly instead of allocating the whole binary.
  it("refuses to assemble an ENVI sidecar and aborts the session", async () => {
    const fake = createFakeMainProcess({
      fileBytes: buildDistinctBytes(3),
      sidecar: { fileName: "stack.bin", bytes: buildDistinctBytes(10) },
      chunkBytes: 4,
    });
    await expect(
      readOpenedImageFileThroughChunkedProtocol(fake.invoke, METADATA),
    ).rejects.toThrow(/streaming ENVI decode path/);
    expect(fake.calls[fake.calls.length - 1]).toBe(OPENED_IMAGE_READ_ABORT_CHANNEL);
  });

  it("aborts the read and rethrows when a chunk request fails", async () => {
    const fake = createFakeMainProcess({
      fileBytes: buildDistinctBytes(9),
      chunkBytes: 4,
      failChunkAtIndex: 1,
    });
    await expect(
      readOpenedImageFileThroughChunkedProtocol(fake.invoke, METADATA),
    ).rejects.toThrow("chunk read blew up");
    expect(fake.calls[fake.calls.length - 1]).toBe(OPENED_IMAGE_READ_ABORT_CHANNEL);
  });

  it("treats an empty chunk as a protocol error instead of looping forever", async () => {
    const fake = createFakeMainProcess({
      fileBytes: buildDistinctBytes(4),
      chunkBytes: 4,
      reportedFileSizeBytes: 8,
    });
    await expect(
      readOpenedImageFileThroughChunkedProtocol(fake.invoke, METADATA),
    ).rejects.toThrow(/returned an unexpected amount of data/);
    expect(fake.calls[fake.calls.length - 1]).toBe(OPENED_IMAGE_READ_ABORT_CHANNEL);
  });

  it("surfaces an impossible allocation as a clear out-of-memory error naming the file", async () => {
    const fake = createFakeMainProcess({
      fileBytes: buildDistinctBytes(1),
      chunkBytes: 4,
      reportedFileSizeBytes: Number.MAX_SAFE_INTEGER,
    });
    await expect(
      readOpenedImageFileThroughChunkedProtocol(fake.invoke, METADATA),
    ).rejects.toThrow(/stack\.tif is .* GB and there is not enough memory to open it/);
    expect(fake.calls[fake.calls.length - 1]).toBe(OPENED_IMAGE_READ_ABORT_CHANNEL);
  });
});
