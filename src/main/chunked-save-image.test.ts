import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
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

// CT-271: a part carrying a png-16-bit-grayscale encoding receives RAW
// big-endian uint16 samples as chunks and writes an encoded PNG to disk.
describe("createSaveImageSessionStore png-16-bit-grayscale encoding", () => {
  const SAMPLES_3X2 = [100, 800, 4095, 250, 950, 65535];

  function bigEndianSampleBytes(samples: ReadonlyArray<number>): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2);
    samples.forEach((value, index) => {
      bytes[index * 2] = value >>> 8;
      bytes[index * 2 + 1] = value & 0xff;
    });
    return bytes;
  }

  async function decodeGrey16SamplesWithReferenceDecoder(filePath: string): Promise<number[]> {
    const { data, info } = await sharp(filePath)
      .toColourspace("grey16")
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(1);
    return Array.from(new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2));
  }

  it("writes a decodable 16-bit PNG from raw sample chunks split mid-sample", async () => {
    const store = createSaveImageSessionStore();
    const filePath = nextOutputPath("png");
    const raw = bigEndianSampleBytes(SAMPLES_3X2);
    const token = await store.begin({
      primary: {
        filePath,
        byteLength: raw.byteLength,
        encoding: { kind: "png-16-bit-grayscale", width: 3, height: 2 },
      },
    });
    for (let offset = 0; offset < raw.byteLength; offset += 5) {
      await store.appendChunk(token, "primary", raw.slice(offset, offset + 5));
    }
    expect(await store.finishKeepingWrittenFiles(token)).toBe(filePath);
    expect(await decodeGrey16SamplesWithReferenceDecoder(filePath)).toEqual(SAMPLES_3X2);
  });

  it("rejects an encoding whose described byte length disagrees with its dimensions", async () => {
    const store = createSaveImageSessionStore();
    await expect(
      store.begin({
        primary: {
          filePath: nextOutputPath("png"),
          byteLength: 11,
          encoding: { kind: "png-16-bit-grayscale", width: 3, height: 2 },
        },
      }),
    ).rejects.toThrow(/invalid encoded size/);
  });

  it("refuses to finish an encoded part while raw sample bytes are missing", async () => {
    const store = createSaveImageSessionStore();
    const token = await store.begin({
      primary: {
        filePath: nextOutputPath("png"),
        byteLength: 12,
        encoding: { kind: "png-16-bit-grayscale", width: 3, height: 2 },
      },
    });
    await store.appendChunk(token, "primary", new Uint8Array(6));
    await expect(store.finishKeepingWrittenFiles(token)).rejects.toThrow(
      /did not match the described size/,
    );
  });

  it("release deletes a partially encoded PNG", async () => {
    const store = createSaveImageSessionStore();
    const filePath = nextOutputPath("png");
    const token = await store.begin({
      primary: {
        filePath,
        byteLength: 12,
        encoding: { kind: "png-16-bit-grayscale", width: 3, height: 2 },
      },
    });
    await store.appendChunk(token, "primary", new Uint8Array(6));
    await store.releaseDeletingPartialFiles(token);
    expect(await fileExists(filePath)).toBe(false);
  });
});

// CT-273: a folder export (PNG stack) opens one writable part per described
// file inside the chosen folder, finish reports the FOLDER, and release
// deletes every partial file.
describe("createSaveImageSessionStore folder export", () => {
  let folderCounter = 0;

  async function nextExportFolder(): Promise<string> {
    folderCounter += 1;
    const folderPath = join(outputDir, `stack-folder-${folderCounter}`);
    await mkdir(folderPath, { recursive: true });
    return folderPath;
  }

  function bigEndianSampleBytes(samples: ReadonlyArray<number>): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2);
    samples.forEach((value, index) => {
      bytes[index * 2] = value >>> 8;
      bytes[index * 2 + 1] = value & 0xff;
    });
    return bytes;
  }

  it("writes every described file into the folder and finish reports the folder path", async () => {
    const store = createSaveImageSessionStore();
    const folderPath = await nextExportFolder();
    const rawBytes = bytesOfLength(9, 4);
    const samples = [300, 800, 4095, 250, 950, 65535];
    const encodedRaw = bigEndianSampleBytes(samples);
    const token = await store.beginFilesInFolder(folderPath, [
      { fileName: "cube_band_001.png", byteLength: rawBytes.byteLength },
      {
        fileName: "cube_band_002.png",
        byteLength: encodedRaw.byteLength,
        encoding: { kind: "png-16-bit-grayscale", width: 3, height: 2 },
      },
    ]);
    await store.appendChunk(token, "file-0", rawBytes);
    for (let offset = 0; offset < encodedRaw.byteLength; offset += 5) {
      await store.appendChunk(token, "file-1", encodedRaw.slice(offset, offset + 5));
    }
    expect(await store.finishKeepingWrittenFiles(token)).toBe(folderPath);
    expect(new Uint8Array(await readFile(join(folderPath, "cube_band_001.png")))).toEqual(rawBytes);
    const decoded = await sharp(join(folderPath, "cube_band_002.png"))
      .toColourspace("grey16")
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    expect(
      Array.from(new Uint16Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength / 2)),
    ).toEqual(samples);
  });

  it("release deletes every partially written folder file", async () => {
    const store = createSaveImageSessionStore();
    const folderPath = await nextExportFolder();
    const token = await store.beginFilesInFolder(folderPath, [
      { fileName: "a_band_001.png", byteLength: 8 },
      { fileName: "a_band_002.png", byteLength: 8 },
    ]);
    await store.appendChunk(token, "file-0", bytesOfLength(8, 2));
    await store.appendChunk(token, "file-1", bytesOfLength(4, 3));
    await store.releaseDeletingPartialFiles(token);
    expect(await fileExists(join(folderPath, "a_band_001.png"))).toBe(false);
    expect(await fileExists(join(folderPath, "a_band_002.png"))).toBe(false);
  });

  it("refuses to finish while any folder file is missing bytes", async () => {
    const store = createSaveImageSessionStore();
    const token = await store.beginFilesInFolder(await nextExportFolder(), [
      { fileName: "a_band_001.png", byteLength: 8 },
      { fileName: "a_band_002.png", byteLength: 8 },
    ]);
    await store.appendChunk(token, "file-0", bytesOfLength(8, 2));
    await expect(store.finishKeepingWrittenFiles(token)).rejects.toThrow(
      /did not match the described size/,
    );
  });

  it("refuses file names that could escape the chosen folder", async () => {
    const store = createSaveImageSessionStore();
    const folderPath = await nextExportFolder();
    for (const fileName of ["../escape.png", "a/b.png", "a\\\\b.png", ""]) {
      await expect(
        store.beginFilesInFolder(folderPath, [{ fileName, byteLength: 8 }]),
      ).rejects.toThrow(/invalid file name/);
    }
  });

  it("refuses a folder export describing no files", async () => {
    const store = createSaveImageSessionStore();
    await expect(store.beginFilesInFolder(await nextExportFolder(), [])).rejects.toThrow(
      /described no files/,
    );
  });
});
