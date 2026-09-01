import { describe, expect, it } from "vitest";
import yauzl from "yauzl";

import { buildStoredZipArchiveBytes, type ZipEntryToStore } from "@/lib/masks/zip-store-writer";

// CT-327: the ORACLE for the renderer's zip writer is a real zip reader -
// yauzl, imported only here in the test (the renderer never gains a zip
// dependency). If yauzl opens the archive and hands back the same names and
// bytes, so will Explorer, Finder, and Python's zipfile.

interface ReadZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function readZipEntriesWithYauzl(
  archiveBytes: Uint8Array,
): Promise<ReadonlyArray<ReadZipEntry>> {
  const zipFile = await openZipFromBuffer(Buffer.from(archiveBytes));
  return collectEveryEntry(zipFile);
}

function openZipFromBuffer(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) reject(error ?? new Error("The archive did not open."));
      else resolve(zipFile);
    });
  });
}

function collectEveryEntry(zipFile: yauzl.ZipFile): Promise<ReadonlyArray<ReadZipEntry>> {
  const entries: ReadZipEntry[] = [];
  return new Promise((resolve, reject) => {
    zipFile.on("entry", (entry: yauzl.Entry) => {
      void readOneEntry(zipFile, entry)
        .then((bytes) => entries.push({ name: entry.fileName, bytes }))
        .then(() => zipFile.readEntry())
        .catch(reject);
    });
    zipFile.on("end", () => resolve(entries));
    zipFile.on("error", reject);
    zipFile.readEntry();
  });
}

function readOneEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error("The entry did not open."));
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", reject);
    });
  });
}

const ENTRIES: ReadonlyArray<ZipEntryToStore> = [
  { name: "Parchment.png", bytes: Uint8Array.from([137, 80, 78, 71, 0, 255, 7]) },
  { name: "Parchment mask.json", bytes: encodeText('{"formatVersion":1}\n') },
];

describe("buildStoredZipArchiveBytes", () => {
  it("writes an archive yauzl reads back name for name and byte for byte", async () => {
    const read = await readZipEntriesWithYauzl(buildStoredZipArchiveBytes(ENTRIES));
    expect(read.map((entry) => entry.name)).toEqual(["Parchment.png", "Parchment mask.json"]);
    expect(Array.from(read[0]!.bytes)).toEqual(Array.from(ENTRIES[0]!.bytes));
    expect(Array.from(read[1]!.bytes)).toEqual(Array.from(ENTRIES[1]!.bytes));
  });

  it("stores every entry uncompressed at its declared size", async () => {
    const zipFile = await openZipFromBuffer(
      Buffer.from(buildStoredZipArchiveBytes(ENTRIES)),
    );
    const entry = await new Promise<yauzl.Entry>((resolve) => {
      zipFile.on("entry", resolve);
      zipFile.readEntry();
    });
    expect(entry.compressionMethod).toBe(0);
    expect(entry.compressedSize).toBe(ENTRIES[0]!.bytes.byteLength);
    expect(entry.uncompressedSize).toBe(ENTRIES[0]!.bytes.byteLength);
  });

  it("keeps a non-ASCII name intact through the UTF-8 flag", async () => {
    const named = [{ name: "Papyrus ünter.png", bytes: Uint8Array.from([1, 2]) }];
    const read = await readZipEntriesWithYauzl(buildStoredZipArchiveBytes(named));
    expect(read.map((entry) => entry.name)).toEqual(["Papyrus ünter.png"]);
  });

  it("reads back an empty entry and an empty archive", async () => {
    expect(await readZipEntriesWithYauzl(buildStoredZipArchiveBytes([]))).toEqual([]);
    const read = await readZipEntriesWithYauzl(
      buildStoredZipArchiveBytes([{ name: "empty.png", bytes: new Uint8Array(0) }]),
    );
    expect(read).toEqual([{ name: "empty.png", bytes: new Uint8Array(0) }]);
  });

  it("writes the same bytes for the same entries", () => {
    expect(Array.from(buildStoredZipArchiveBytes(ENTRIES))).toEqual(
      Array.from(buildStoredZipArchiveBytes(ENTRIES)),
    );
  });
});
