// CT-236: a project bundle asset is resolved to file metadata and then read
// through the SAME chunked protocol as a normal open, so main never holds a
// whole asset. These tests pin the resolve rules and prove the resolved asset
// (including its ENVI .bin sidecar) streams byte-identically through the
// chunked reader, final short chunk included.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createChunkedOpenedImageFileReader } from "./chunked-opened-image-read";
import { resolveBundleAssetToFileMetadata } from "./resolve-bundle-asset";
import type { ChunkedOpenedImageReadTarget } from "../shared/chunked-opened-image-read-protocol";

const TEST_CHUNK_BYTES = 1000;
const HEADER_BYTE_COUNT = 137;
const SIDECAR_BYTE_COUNT = 2500;

let bundleDirectory: string;
let projectFilePath: string;
let headerBytes: Uint8Array;
let sidecarBytes: Uint8Array;

beforeAll(async () => {
  bundleDirectory = await mkdtemp(join(tmpdir(), "resolve-bundle-asset-test-"));
  projectFilePath = join(bundleDirectory, "project.json");
  headerBytes = buildDistinctBytes(HEADER_BYTE_COUNT);
  sidecarBytes = buildDistinctBytes(SIDECAR_BYTE_COUNT);
  await writeExtractedBundleLayout();
});

afterAll(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});

function buildDistinctBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 7) % 256);
}

async function writeExtractedBundleLayout(): Promise<void> {
  await writeFile(projectFilePath, JSON.stringify({ formatVersion: 2 }));
  await mkdir(join(bundleDirectory, "assets"));
  await writeFile(join(bundleDirectory, "assets", "cube.hdr"), headerBytes);
  await writeFile(join(bundleDirectory, "assets", "cube.bin"), sidecarBytes);
}

interface PulledTarget {
  readonly assembled: Uint8Array;
  readonly chunkLengths: ReadonlyArray<number>;
}

async function pullWholeTargetRecordingChunkLengths(
  reader: ReturnType<typeof createChunkedOpenedImageFileReader>,
  token: string,
  target: ChunkedOpenedImageReadTarget,
  sizeBytes: number,
): Promise<PulledTarget> {
  const assembled = new Uint8Array(sizeBytes);
  const chunkLengths: number[] = [];
  let offset = 0;
  while (offset < sizeBytes) {
    const chunk = await reader.readNextChunk(token, target);
    assembled.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
    chunkLengths.push(chunk.bytes.byteLength);
  }
  return { assembled, chunkLengths };
}

describe("resolveBundleAssetToFileMetadata (CT-236)", () => {
  it("resolves a relative asset path against the project file's directory", async () => {
    const result = await resolveBundleAssetToFileMetadata({
      projectFilePath,
      relativePath: "assets/cube.hdr",
    });
    expect(result).toEqual({
      kind: "found",
      file: {
        fileName: "cube.hdr",
        filePath: join(bundleDirectory, "assets", "cube.hdr"),
        fileSizeBytes: HEADER_BYTE_COUNT,
        mtimeMs: expect.any(Number),
      },
    });
  });

  it("passes an absolute asset path through unchanged", async () => {
    const absolutePath = join(bundleDirectory, "assets", "cube.bin");
    const result = await resolveBundleAssetToFileMetadata({
      projectFilePath,
      relativePath: absolutePath,
    });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.file.filePath).toBe(absolutePath);
    expect(result.file.fileSizeBytes).toBe(SIDECAR_BYTE_COUNT);
  });

  it("reports a nonexistent asset as missing, echoing the relative path", async () => {
    const result = await resolveBundleAssetToFileMetadata({
      projectFilePath,
      relativePath: "assets/vanished.tif",
    });
    expect(result).toEqual({ kind: "missing", relativePath: "assets/vanished.tif" });
  });

  it("streams the resolved ENVI asset and its .bin sidecar byte-identically through the chunked reader, final short chunk included", async () => {
    const resolved = await resolveBundleAssetToFileMetadata({
      projectFilePath,
      relativePath: "assets/cube.hdr",
    });
    if (resolved.kind !== "found") throw new Error("expected the asset to resolve");
    const reader = createChunkedOpenedImageFileReader(TEST_CHUNK_BYTES);
    const begun = await reader.begin(resolved.file.filePath);
    expect(begun.sidecar).toEqual({ fileName: "cube.bin", sizeBytes: SIDECAR_BYTE_COUNT });
    const header = await pullWholeTargetRecordingChunkLengths(
      reader,
      begun.token,
      "file",
      begun.fileSizeBytes,
    );
    const sidecar = await pullWholeTargetRecordingChunkLengths(
      reader,
      begun.token,
      "sidecar",
      SIDECAR_BYTE_COUNT,
    );
    expect(header.chunkLengths).toEqual([HEADER_BYTE_COUNT]);
    expect(sidecar.chunkLengths).toEqual([1000, 1000, 500]);
    expect(header.assembled).toEqual(headerBytes);
    expect(sidecar.assembled).toEqual(sidecarBytes);
    const finished = await reader.finish(begun.token);
    expect(finished.contentHash).toBe(createHash("sha256").update(headerBytes).digest("hex"));
  });
});
