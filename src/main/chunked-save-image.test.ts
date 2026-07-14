import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSaveImageSessionStore } from "./chunked-save-image";

let outputDir: string;
let fileCounter = 0;

beforeAll(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "chunked-save-image-test-"));
});

afterAll(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

function nextOutputPath(extension: string): string {
  fileCounter += 1;
  return join(outputDir, `saved-${fileCounter}.${extension}`);
}

function bytesOfLength(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i + seed) % 251);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("createSaveImageSessionStore", () => {
  it("writes multi-chunk primary and sidecar parts to the destination paths byte-identically", async () => {
    const store = createSaveImageSessionStore();
    const primaryPath = nextOutputPath("hdr");
    const sidecarPath = nextOutputPath("bin");
    const primaryBytes = bytesOfLength(10, 3);
    // 1,003 bytes uploaded in 64-byte chunks ends on a short final chunk.
    const sidecarBytes = bytesOfLength(1_003, 11);
    const token = await store.begin({
      primary: { filePath: primaryPath, byteLength: primaryBytes.byteLength },
      sidecar: { filePath: sidecarPath, byteLength: sidecarBytes.byteLength },
    });
    await store.appendChunk(token, "primary", primaryBytes);
    for (let offset = 0; offset < sidecarBytes.byteLength; offset += 64) {
      await store.appendChunk(token, "sidecar", sidecarBytes.slice(offset, offset + 64));
    }
    const finishedPath = await store.finishKeepingWrittenFiles(token);
    expect(finishedPath).toBe(primaryPath);
    expect(new Uint8Array(await readFile(primaryPath))).toEqual(primaryBytes);
    expect(new Uint8Array(await readFile(sidecarPath))).toEqual(sidecarBytes);
  });

  it("refuses to finish while described bytes are missing", async () => {
    const store = createSaveImageSessionStore();
    const token = await store.begin({
      primary: { filePath: nextOutputPath("tif"), byteLength: 20 },
    });
    await store.appendChunk(token, "primary", bytesOfLength(10, 1));
    await expect(store.finishKeepingWrittenFiles(token)).rejects.toThrow(
      /did not match the described size/,
    );
  });

  it("rejects chunks that overflow the described byte length", async () => {
    const store = createSaveImageSessionStore();
    const token = await store.begin({
      primary: { filePath: nextOutputPath("tif"), byteLength: 8 },
    });
    await expect(store.appendChunk(token, "primary", bytesOfLength(9, 1))).rejects.toThrow(
      /did not match the described size/,
    );
  });

  it("rejects chunks for a part the session never described", async () => {
    const store = createSaveImageSessionStore();
    const token = await store.begin({
      primary: { filePath: nextOutputPath("tif"), byteLength: 8 },
    });
    await expect(store.appendChunk(token, "sidecar", bytesOfLength(4, 1))).rejects.toThrow(
      /unknown file/,
    );
  });

  it("release deletes the partial destination files", async () => {
    const store = createSaveImageSessionStore();
    const primaryPath = nextOutputPath("hdr");
    const sidecarPath = nextOutputPath("bin");
    const token = await store.begin({
      primary: { filePath: primaryPath, byteLength: 10 },
      sidecar: { filePath: sidecarPath, byteLength: 10 },
    });
    await store.appendChunk(token, "primary", bytesOfLength(10, 5));
    await store.releaseDeletingPartialFiles(token);
    expect(await fileExists(primaryPath)).toBe(false);
    expect(await fileExists(sidecarPath)).toBe(false);
    await expect(store.appendChunk(token, "primary", bytesOfLength(1, 0))).rejects.toThrow(
      /Unknown image save token/,
    );
  });

  it("release after a successful finish keeps the written files", async () => {
    const store = createSaveImageSessionStore();
    const primaryPath = nextOutputPath("png");
    const primaryBytes = bytesOfLength(6, 9);
    const token = await store.begin({
      primary: { filePath: primaryPath, byteLength: primaryBytes.byteLength },
    });
    await store.appendChunk(token, "primary", primaryBytes);
    await store.finishKeepingWrittenFiles(token);
    await store.releaseDeletingPartialFiles(token);
    expect(new Uint8Array(await readFile(primaryPath))).toEqual(primaryBytes);
  });

  it("rejects a zero or negative described byte length", async () => {
    const store = createSaveImageSessionStore();
    await expect(
      store.begin({ primary: { filePath: nextOutputPath("tif"), byteLength: 0 } }),
    ).rejects.toThrow(/invalid encoded size/);
  });
});
